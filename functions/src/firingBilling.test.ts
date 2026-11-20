import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type Stripe from "stripe";

import {
  deriveFiringRate,
  validateChargeForTicket,
  canAccessFiringTicket,
  canClaimFiringTicketByVerifiedEmail,
  canResendFiringPickupNotice,
  assertWorkSlipPrintActionAllowed,
  deriveFiringCustomerSubject,
  deriveFiringMailDeliveryTransition,
  deriveFiringPickupTransition,
  firingInvoiceCopy,
  firingInvoiceLineDescription,
  getFiringTicketIdFromStripeEvent,
  isFiringBillingStripeEvent,
  isListedFiringTicket,
  isBillingOperationLeaseActive,
  isOpaquePickupDetailsToken,
  makeOpaquePickupDetailsToken,
  nextInvoiceBillingStatus,
  pickupDetailsHandoffHtml,
  pickupDetailsTokenHash,
  queuedWorkSlipPrintState,
  queueTicketDto,
  runFiringPickupBillingSaga,
  selectExactSavedArtistEmail,
  summarizeFiringPlannerTickets,
  staffAdjustFiringBillingSchema,
  staffDeleteFiringTicketSchema,
  staffFinalizeFiringPickupSchema,
  staffPrepareFiringPickupReviewSchema,
  staffMarkFiringPickedUpSchema,
  staffResendFiringInvoiceSchema,
  trustedImportedStripeCustomerId,
  workSlipPrintRequestSchema,
  type FiringPickupSagaDependencies,
  type StaffFinalizeFiringPickupInput,
} from "./firingBilling";

test("staff queue excludes deleted tickets even without a usable deletion timestamp", () => {
  assert.equal(isListedFiringTicket({ status: "deleted", billingStatus: "unbilled" }), false);
  assert.equal(isListedFiringTicket({ status: " deleted ", deletedAt: null }), false);
  assert.equal(isListedFiringTicket({ status: "expected_dropoff", deletedAt: "2026-10-26T19:25:00Z" }), false);
  assert.equal(isListedFiringTicket({ status: "expected_dropoff", deletedAt: { seconds: 123 } }), false);
  assert.equal(isListedFiringTicket({ status: "picked_up", billingStatus: "not_applicable" }), false);
  assert.equal(isListedFiringTicket({ status: "ready_for_pickup", billingStatus: "paid" }), true);
  assert.equal(isListedFiringTicket({ status: "picked_up", billingStatus: "paid" }), true);
  assert.equal(isListedFiringTicket({ status: "expected_dropoff", billingStatus: "unbilled", deletedAt: null }), true);
});

test("staff ticket details include firing type and private note without exposing the note to clients", () => {
  const data = {
    selection: { heatId: "mid", spaceId: "large", firingType: "glaze" },
    firingId: "firing-1",
    privateStaffNote: "Check prior payment",
  };
  const staff = queueTicketDto("MF-EXAMPLE", data, true);
  const client = queueTicketDto("MF-EXAMPLE", data, false);
  assert.equal(staff.firingType, "glaze");
  assert.equal(staff.firingId, "firing-1");
  assert.equal(staff.privateStaffNote, "Check prior payment");
  assert.equal("privateStaffNote" in client, false);
});

test("ticket deletion and invoice resend requests require the exact idempotent contract", () => {
  const valid = {
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(staffDeleteFiringTicketSchema.parse(valid), valid);
  assert.deepEqual(staffResendFiringInvoiceSchema.parse(valid), valid);
  assert.throws(() => staffDeleteFiringTicketSchema.parse({ ...valid, extra: true }));
  assert.throws(() => staffResendFiringInvoiceSchema.parse({ ...valid, clientRequestId: "nope" }));
});

test("firing invoice copy stays short, human, and ticket-specific", () => {
  assert.deepEqual(firingInvoiceCopy({
    ticketId: "MF-1596-4702-D3EF",
    heatLabel: "Mid fire",
    actualSpace: { billingUnit: "half_shelf", quantity: 1 },
  }), {
    description: "Firing service",
    customField: { name: "Firing ticket", value: "MF-1596-4702-D3EF" },
    footer: "Final charges reflect the kiln space actually used.",
    lineDescription: "Firing service — Mid fire — 1 half shelf · Ticket MF-1596-4702-D3EF",
  });
});

test("work slip print queue accepts only the strict original and reprint contract", () => {
  assert.deepEqual(workSlipPrintRequestSchema.parse({
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "original",
  }), {
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "original",
  });
  assert.equal(workSlipPrintRequestSchema.parse({
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "reprint",
  }).action, "reprint");
  assert.throws(() => workSlipPrintRequestSchema.parse({
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "retry",
  }));
  assert.throws(() => workSlipPrintRequestSchema.parse({
    ticketId: "MF-1234-ABCD",
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "original",
    extra: true,
  }));
});

test("work slip print queue prevents duplicate originals and requires a completed original for reprints", () => {
  assert.doesNotThrow(() => assertWorkSlipPrintActionAllowed("original", ""));
  assert.doesNotThrow(() => assertWorkSlipPrintActionAllowed("original", "needs_review"));
  assert.doesNotThrow(() => assertWorkSlipPrintActionAllowed("reprint", "printed"));
  assert.throws(
    () => assertWorkSlipPrintActionAllowed("original", "queued"),
    { code: "WORK_SLIP_ALREADY_QUEUED" },
  );
  assert.throws(
    () => assertWorkSlipPrintActionAllowed("reprint", "queued"),
    { code: "WORK_SLIP_NOT_PRINTED" },
  );
  assert.throws(
    () => assertWorkSlipPrintActionAllowed("original", "printed"),
    { code: "WORK_SLIP_REPRINT_REQUIRED" },
  );
});

test("work slip queue state is a privacy-minimized, resettable thermal job handoff", () => {
  const state = queuedWorkSlipPrintState({
    current: {
      status: "printed",
      cupsJobId: "Star_TSP143IIIU-44",
      reprintCount: 2,
    },
    action: "reprint",
    actorUid: "staff-1",
    queuedAt: "server-time",
  });
  assert.deepEqual(state, {
    status: "queued",
    cupsJobId: null,
    reprintCount: 3,
    queuedAt: "server-time",
    queuedByUid: "staff-1",
    queueReason: "reprint",
    attempts: 0,
    lastError: null,
  });
  assert.equal(JSON.stringify(state).includes("email"), false);
  assert.equal(JSON.stringify(state).includes("stripe"), false);
});

test("planner snapshot counts submitted tickets without collecting browsing behavior", () => {
  const summary = summarizeFiringPlannerTickets([
    { status: "expected_dropoff", billingStatus: "unbilled" },
    { status: "awaiting_pickup_review", billingStatus: "unbilled" },
    { status: "ready_for_pickup", billingStatus: "invoice_open" },
    { status: "picked_up", billingStatus: "paid" },
    { status: "picked_up", billingStatus: "not_applicable" },
  ], {
    periodDays: 30,
    windowStart: "2026-07-05T00:00:00.000Z",
    generatedAt: "2026-08-04T00:00:00.000Z",
  });

  assert.deepEqual(summary, {
    periodDays: 30,
    windowStart: "2026-07-05T00:00:00.000Z",
    generatedAt: "2026-08-04T00:00:00.000Z",
    ticketsSubmitted: 4,
    expectedDropoff: 1,
    awaitingPickupReview: 1,
    readyForPickup: 1,
    pickedUp: 1,
  });
});

test("saved artist lookup only returns one unambiguous email", () => {
  assert.equal(selectExactSavedArtistEmail([{ email: "artist@example.com" }, { email: "ARTIST@example.com" }]), "artist@example.com");
  assert.equal(selectExactSavedArtistEmail([{ email: "first@example.com" }, { email: "second@example.com" }]), null);
  assert.equal(selectExactSavedArtistEmail([{ email: "not-an-email" }]), null);
});

test("a Pathfinder ticket can be claimed only by its verified matching email", () => {
  const matching = {
    ticketEmail: "Artist@Example.com",
    ticketOwnerUid: null,
    uid: "artist-1",
    verifiedEmail: "artist@example.com",
    emailVerified: true,
  };
  assert.equal(canClaimFiringTicketByVerifiedEmail(matching), true);
  assert.equal(canAccessFiringTicket(matching), true);
  assert.equal(canClaimFiringTicketByVerifiedEmail({ ...matching, emailVerified: false }), false);
  assert.equal(canClaimFiringTicketByVerifiedEmail({ ...matching, verifiedEmail: "other@example.com" }), false);
  assert.equal(canClaimFiringTicketByVerifiedEmail({ ...matching, ticketOwnerUid: "someone-else" }), false);
  assert.equal(canAccessFiringTicket({ ...matching, ticketOwnerUid: "someone-else" }), false);
  assert.equal(canAccessFiringTicket({ ...matching, ticketOwnerUid: "artist-1", emailVerified: false }), true);
});

test("pickup-detail links use opaque, non-PII tokens", () => {
  const token = makeOpaquePickupDetailsToken();
  assert.equal(isOpaquePickupDetailsToken(token), true);
  assert.equal(token.length, 43);
  assert.notEqual(pickupDetailsTokenHash(token), token);
  assert.equal(isOpaquePickupDetailsToken("artist@example.com"), false);
  assert.equal(isOpaquePickupDetailsToken("RXY3"), false);
});

test("pickup directions can only be resent while work is awaiting pickup", () => {
  assert.equal(canResendFiringPickupNotice({ status: "ready_for_pickup", pickupMailId: "pickup-mail" }), true);
  assert.equal(canResendFiringPickupNotice({ status: "picked_up", pickupMailId: "pickup-mail" }), false);
  assert.equal(canResendFiringPickupNotice({ status: "ready_for_pickup", pickupMailId: null }), false);
});

test("pickup-detail handoff stays private to the opaque link and uses Stripe for payment", () => {
  const token = makeOpaquePickupDetailsToken();
  const html = pickupDetailsHandoffHtml({
    token,
    ticketId: "RXY3",
    billingStatus: "invoice_open",
    finalChargeCents: 1500,
    hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/invoice_test",
    pickupInstructions: "Use the side gate.\nYour shelf is by the kiln room.",
    isLowFire: true,
  });
  assert.match(html, /No account or app is needed/);
  assert.match(html, /Pay securely with Stripe/);
  assert.match(html, /Use the side gate/);
  assert.match(html, /Email me these pickup details/);
  assert.match(html, /Firing ticket RXY3/);
  assert.match(html, /requestFiringPickupDetails\/v1\//);
  assert.ok(!html.includes("artist@example.com"));
  assert.ok(!html.includes("displayName"));
});

test("pickup-detail handoff refuses non-Stripe payment destinations", () => {
  const html = pickupDetailsHandoffHtml({
    token: makeOpaquePickupDetailsToken(),
    ticketId: "RXY3",
    billingStatus: "invoice_open",
    finalChargeCents: 1500,
    hostedInvoiceUrl: "https://example.com/not-stripe",
    pickupInstructions: "Use the side gate.",
    isLowFire: false,
  });
  assert.ok(!html.includes("Pay securely with Stripe"));
  assert.ok(!html.includes("example.com/not-stripe"));
});

test("firing mail delivery maps only terminal extension states for owned mail sources", () => {
  assert.deepEqual(
    deriveFiringMailDeliveryTransition({
      source: "firing-pickup-ready",
      beforeState: "PROCESSING",
      afterState: "SUCCESS",
    }),
    { noticeStatus: "sent", deliveryState: "SUCCESS" },
  );
  assert.deepEqual(
    deriveFiringMailDeliveryTransition({
      source: "firing-billing-adjustment",
      beforeState: "PROCESSING",
      afterState: "ERROR",
    }),
    { noticeStatus: "failed", deliveryState: "ERROR" },
  );
  assert.equal(deriveFiringMailDeliveryTransition({
    source: "firing-pickup-ready-resend",
    beforeState: "PENDING",
    afterState: "PROCESSING",
  }), null);
  assert.equal(deriveFiringMailDeliveryTransition({
    source: "unrelated-mail",
    beforeState: "PROCESSING",
    afterState: "SUCCESS",
  }), null);
  assert.equal(deriveFiringMailDeliveryTransition({
    source: "firing-pickup-ready",
    beforeState: "SUCCESS",
    afterState: "SUCCESS",
  }), null);
});

const actor = {
  uid: "staff-1",
  email: "studio@monsoonfire.com",
  mode: "staff",
} as const;

const runtime = {
  stripeMode: "test",
  invoicesEnabled: true,
  firingBillingEnabled: true,
  liveWritesEnabled: false,
  daysUntilDue: 14,
  pickupInstructions: "Pick up at the studio.",
  pickupInstructionsVersion: "pickup-v1",
} as const;

function makeFinalizeInput(
  overrides: Partial<StaffFinalizeFiringPickupInput> = {},
): StaffFinalizeFiringPickupInput {
  return staffFinalizeFiringPickupSchema.parse({
    ticketId: "MF-7K4P",
    expectedVersion: 3,
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    outcome: "normal_billable",
    actualSpace: { billingUnit: "half_shelf", quantity: 2 },
    rateKey: "mid_half_shelf",
    finalChargeCents: 5_000,
    currency: "usd",
    confirmedReady: true,
    ...overrides,
  });
}

test("v2 pickup validation charges fulfilled requests and preserves custom base quotes", () => {
  const ticket = { pricingVersion: 2, addOnRequests: { private: true, rush: true } };
  const shared = makeFinalizeInput({ actualSpace: { billingUnit: "whole_kiln", quantity: 1 }, rateKey: "mid_shared_v2", finalChargeCents: 14000, privateFulfilled: true, rushFulfilled: false });
  assert.deepEqual(validateChargeForTicket(shared, "mid", ticket), { rateMatched: true, expectedChargeCents: 14000 });
  const withOtherService = { ...ticket, otherRequestedServices: ["Studio glaze access"] };
  assert.throws(() => validateChargeForTicket(shared, "mid", withOtherService), /other requested services/i);
  assert.equal(validateChargeForTicket({ ...shared, overrideReason: "Glaze access reviewed" }, "mid", withOtherService).rateMatched, true);
  const line = firingInvoiceLineDescription({ ticketId: shared.ticketId, heatLabel: "Mid fire", actualSpace: shared.actualSpace, privateFulfilled: shared.privateFulfilled, rushFulfilled: shared.rushFulfilled });
  assert.match(line, /Private firing \+\$20/);
  assert.doesNotMatch(line, /rush/i);
  assert.throws(() => validateChargeForTicket({ ...shared, rushFulfilled: true }, "mid", { pricingVersion: 2, addOnRequests: { private: true } }), /requested add-ons/i);
  const custom = makeFinalizeInput({ actualSpace: { billingUnit: "custom", quantity: 1 }, rateKey: "custom_quote_v2", customBaseChargeCents: 18000, finalChargeCents: 22000, privateFulfilled: true, rushFulfilled: true });
  assert.deepEqual(validateChargeForTicket(custom, "custom", ticket), { rateMatched: true, expectedChargeCents: 22000 });
  assert.throws(() => validateChargeForTicket({ ...custom, customBaseChargeCents: undefined }, "custom", ticket), /custom firing quote/i);
});

test("v3 standard billing requires a ledger price, including zero when the cap is reached", () => {
  const input = makeFinalizeInput({ rateKey: "high_shared_v3", finalChargeCents: 9000 });
  const ticket = { pricingVersion: 3 };
  assert.throws(() => validateChargeForTicket(input, "high", ticket), /aggregation/i);
  const rate = { rateKey: "high_shared_v3", chargeCents: 0 };
  assert.throws(() => validateChargeForTicket({ ...input, overrideReason: "manual override" }, "high", ticket, rate), /remaining firing charge/i);
  assert.deepEqual(validateChargeForTicket({ ...input, finalChargeCents: 0 }, "high", ticket, rate), { rateMatched: true, expectedChargeCents: 0 });
});

function makeEvent(
  type: string,
  metadata: Record<string, string> = {
    source: "firing",
    firing_ticket_id: "MF-7K4P",
  },
): Stripe.Event {
  return {
    id: `evt_${type.replace(/\./g, "_")}`,
    type,
    livemode: false,
    data: { object: { id: "stripe_object_1", metadata } },
  } as unknown as Stripe.Event;
}

function makeSagaDependencies(params: {
  completed?: boolean;
  ticketBillingStatus?: string;
} = {}): { calls: string[]; dependencies: FiringPickupSagaDependencies } {
  const calls: string[] = [];
  const dependencies: FiringPickupSagaDependencies = {
    assertWriteReady: async () => {
      calls.push("assertWriteReady");
    },
    reserve: async (input) => {
      calls.push("reserve");
      return {
        operationId: "firing-billing-operation-1",
        duplicate: params.completed ?? false,
        completed: params.completed ?? false,
        ticket: {
          ticketId: input.ticketId,
          displayName: "Test Artist",
          email: "artist@example.com",
          heatId: "mid",
          heatLabel: "Mid fire",
          estimatedSpace: "2 half shelves",
          status: "awaiting_pickup_review",
          billingStatus: params.ticketBillingStatus ?? "billing_preparing",
          billingVersion: input.expectedVersion,
          ownerUid: "artist-1",
        },
        stripeMode: params.completed ? "test" : null,
        stripeCustomerId: null,
        stripeInvoiceId: params.completed ? "in_1" : null,
        stripeInvoiceItemId: null,
        hostedInvoiceUrl: params.completed ? "https://invoice.stripe.test/in_1" : null,
        resultBillingStatus: params.completed ? params.ticketBillingStatus ?? "invoice_open" : null,
      };
    },
    resolveCustomer: async () => {
      calls.push("resolveCustomer");
      return { customerId: "cus_1", ownerUid: "artist-1" };
    },
    createDraftInvoice: async () => {
      calls.push("createDraftInvoice");
      return { id: "in_1" };
    },
    createInvoiceItem: async () => {
      calls.push("createInvoiceItem");
      return { id: "ii_1" };
    },
    finalizeInvoice: async () => {
      calls.push("finalizeInvoice");
      return {
        id: "in_1",
        hostedInvoiceUrl: "https://invoice.stripe.test/in_1",
        invoicePdfUrl: null,
        amountDue: 5_000,
        status: "open",
      };
    },
    recordStep: async () => {
      calls.push("recordStep");
    },
    completeHold: async (reserved, input) => {
      calls.push("completeHold");
      return {
        ticketId: input.ticketId,
        operationId: reserved.operationId,
        outcome: input.outcome,
        billingStatus: "hold_for_review",
        noticeStatus: "not_queued",
        finalChargeCents: 0,
        currency: "usd",
        stripeMode: null,
        stripeInvoiceId: null,
        hostedInvoiceUrl: null,
        duplicate: reserved.duplicate,
      };
    },
    completeNoCharge: async (reserved, input) => {
      calls.push("completeNoCharge");
      return {
        ticketId: input.ticketId,
        operationId: reserved.operationId,
        outcome: input.outcome,
        billingStatus: "no_charge",
        noticeStatus: "queued",
        finalChargeCents: 0,
        currency: "usd",
        stripeMode: null,
        stripeInvoiceId: null,
        hostedInvoiceUrl: null,
        duplicate: reserved.duplicate,
      };
    },
    completeBillable: async (reserved, input, _actor, activeRuntime, _customer, invoice) => {
      calls.push("completeBillable");
      return {
        ticketId: input.ticketId,
        operationId: reserved.operationId,
        outcome: input.outcome,
        billingStatus: invoice.status === "paid" ? "paid" : "invoice_open",
        noticeStatus: "queued",
        finalChargeCents: input.finalChargeCents,
        currency: "usd",
        stripeMode: activeRuntime.stripeMode,
        stripeInvoiceId: invoice.id,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        duplicate: reserved.duplicate,
      };
    },
    markReconciliationRequired: async () => {
      calls.push("markReconciliationRequired");
    },
  };
  return { calls, dependencies };
}

test("staff finalization schema accepts the canonical command and applies safe defaults", () => {
  const parsed = staffFinalizeFiringPickupSchema.parse({
    ticketId: "  MF-7K4P  ",
    expectedVersion: 0,
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    outcome: "hold_for_review",
    actualSpace: { billingUnit: "half_shelf", quantity: 1 },
    finalChargeCents: 0,
  });

  assert.equal(parsed.ticketId, "MF-7K4P");
  assert.equal(parsed.currency, "usd");
  assert.equal(parsed.rateKey, null);
  assert.equal(parsed.overrideReason, null);
  assert.equal(parsed.artistVisibleFiringNote, null);
  assert.equal(parsed.privateStaffNote, null);
  assert.equal(parsed.artistContact, null);
  assert.equal(parsed.confirmedReady, false);
});

test("staff finalization schema rejects malformed or over-limit commands", () => {
  const valid = makeFinalizeInput();

  assert.equal(staffFinalizeFiringPickupSchema.safeParse({ ...valid, clientRequestId: "retry-1" }).success, false);
  assert.equal(staffFinalizeFiringPickupSchema.safeParse({ ...valid, finalChargeCents: 1_000_001 }).success, false);
  assert.equal(staffFinalizeFiringPickupSchema.safeParse({ ...valid, currency: "cad" }).success, false);
  assert.equal(staffFinalizeFiringPickupSchema.safeParse({ ...valid, unexpected: true }).success, false);
  assert.equal(
    staffFinalizeFiringPickupSchema.safeParse({ ...valid, privateStaffNote: "x".repeat(2_001) }).success,
    false,
  );
});

test("staff finalization schema rejects fractional half-shelf counts", () => {
  const valid = makeFinalizeInput();
  const parsed = staffFinalizeFiringPickupSchema.safeParse({
    ...valid,
    actualSpace: { billingUnit: "half_shelf", quantity: 1.5 },
  });

  assert.equal(parsed.success, false);
});

test("staff finalization schema requires a ready-for-pickup confirmation before sending", () => {
  const valid = makeFinalizeInput();
  assert.equal(
    staffFinalizeFiringPickupSchema.safeParse({ ...valid, confirmedReady: false }).success,
    false,
  );
  assert.equal(
    staffFinalizeFiringPickupSchema.safeParse({
      ...valid,
      confirmedReady: true,
      artistContact: { displayName: "Test Artist", email: "artist@example.com" },
    }).success,
    true,
  );
});

test("staff adjustment schema requires money for credits and refunds, but not voids", () => {
  const base = {
    ticketId: "MF-7K4P",
    expectedVersion: 3,
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    reason: "Studio correction",
  };

  assert.equal(staffAdjustFiringBillingSchema.safeParse({ ...base, action: "void_invoice" }).success, true);
  assert.equal(
    staffAdjustFiringBillingSchema.safeParse({ ...base, action: "credit_open_invoice", amountCents: 0 }).success,
    false,
  );
  assert.equal(
    staffAdjustFiringBillingSchema.safeParse({ ...base, action: "refund_paid_invoice", amountCents: 2_000 }).success,
    true,
  );
});

test("firing linkage requires a client and unloaded firing ID on the dedicated action", () => {
  const request = {
    ticketId: "MF-TEST", expectedVersion: 0, clientRequestId: "11111111-1111-4111-8111-111111111111",
    action: "link_firing", ownerUid: "artist-1", firingId: "run-1",
  };
  assert.equal(staffPrepareFiringPickupReviewSchema.safeParse(request).success, true);
  assert.equal(staffPrepareFiringPickupReviewSchema.safeParse({ ...request, ownerUid: undefined }).success, false);
  assert.equal(staffPrepareFiringPickupReviewSchema.safeParse({ ...request, firingId: "firings/run-1" }).success, false);
  assert.equal(staffPrepareFiringPickupReviewSchema.safeParse({ ...request, action: "confirm_unloaded", confirmedUnloaded: true }).success, false);
});

test("pickup review separates pre-unload batch linking from manual unload confirmation", () => {
  const base = {
    ticketId: "MF-7K4P",
    expectedVersion: 0,
    clientRequestId: "33333333-3333-4333-8333-333333333333",
  };
  assert.equal(
    staffPrepareFiringPickupReviewSchema.safeParse({ ...base, confirmedUnloaded: false }).success,
    false,
  );
  assert.equal(
    staffPrepareFiringPickupReviewSchema.safeParse({
      ...base,
      action: "link_batch",
      confirmedUnloaded: false,
    }).success,
    false,
  );
  const linked = staffPrepareFiringPickupReviewSchema.parse({
    ...base,
    action: "link_batch",
    batchId: "batch-123",
    confirmedUnloaded: false,
  });
  assert.equal(linked.action, "link_batch");
  assert.equal(linked.batchId, "batch-123");
  assert.equal(linked.confirmedUnloaded, false);

  const manual = staffPrepareFiringPickupReviewSchema.parse({
    ...base,
    confirmedUnloaded: true,
  });
  assert.equal(manual.action, "confirm_unloaded");
  assert.equal(manual.confirmedUnloaded, true);
});

test("physical pickup requires an explicit confirmation", () => {
  const command = {
    ticketId: "MF-7K4P",
    expectedVersion: 4,
    clientRequestId: "44444444-4444-4444-8444-444444444444",
  };
  assert.equal(staffMarkFiringPickedUpSchema.safeParse({
    ...command,
    confirmedPickedUp: false,
  }).success, false);
  assert.equal(staffMarkFiringPickedUpSchema.safeParse({
    ...command,
    confirmedPickedUp: true,
  }).success, true);
});

test("physical pickup advances custody without changing or waiting on billing", () => {
  for (const billingStatus of [
    "invoice_open",
    "payment_failed",
    "paid",
    "no_charge",
    "partially_refunded",
    "refunded",
  ]) {
    assert.deepEqual(deriveFiringPickupTransition({
      status: "ready_for_pickup",
      billingStatus,
      billingVersion: 4,
      expectedVersion: 4,
    }), {
      status: "picked_up",
      billingStatus,
      billingVersion: 5,
      duplicate: false,
    });
  }
});

test("physical pickup is idempotent and rejects stale or premature transitions", () => {
  assert.deepEqual(deriveFiringPickupTransition({
    status: "picked_up",
    billingStatus: "invoice_open",
    billingVersion: 5,
    expectedVersion: 4,
  }), {
    status: "picked_up",
    billingStatus: "invoice_open",
    billingVersion: 5,
    duplicate: true,
  });
  assert.throws(() => deriveFiringPickupTransition({
    status: "ready_for_pickup",
    billingStatus: "paid",
    billingVersion: 5,
    expectedVersion: 4,
  }), /changed after you opened it/i);
  assert.throws(() => deriveFiringPickupTransition({
    status: "awaiting_pickup_review",
    billingStatus: "unbilled",
    billingVersion: 4,
    expectedVersion: 4,
  }), /not ready/i);
});

test("deriveFiringRate applies the published shelf prices and whole-kiln cap", () => {
  const cases = [
    { heatId: "low", quantity: 1, rateKey: "low_half_shelf", chargeCents: 1_500 },
    { heatId: "low", quantity: 2, rateKey: "low_half_shelf", chargeCents: 3_000 },
    { heatId: "low", quantity: 3, rateKey: "low_half_shelf", chargeCents: 4_500 },
    { heatId: "mid", quantity: 1, rateKey: "mid_half_shelf", chargeCents: 2_500 },
    { heatId: "mid", quantity: 2, rateKey: "mid_half_shelf", chargeCents: 5_000 },
    { heatId: "mid", quantity: 3, rateKey: "mid_half_shelf", chargeCents: 6_500 },
    { heatId: "high", quantity: 2, rateKey: "mid_half_shelf", chargeCents: 5_000 },
  ];

  for (const row of cases) {
    assert.deepEqual(
      deriveFiringRate({
        heatId: row.heatId,
        actualSpace: { billingUnit: "half_shelf", quantity: row.quantity },
      }),
      { rateKey: row.rateKey, chargeCents: row.chargeCents },
      `${row.heatId} fire, ${row.quantity} half shelf count`,
    );
  }

  assert.deepEqual(
    deriveFiringRate({ heatId: "low", actualSpace: { billingUnit: "whole_kiln", quantity: 1 } }),
    { rateKey: "whole_kiln", chargeCents: 6_500 },
  );
  assert.deepEqual(
    deriveFiringRate({ heatId: "custom", actualSpace: { billingUnit: "custom", quantity: 1 } }),
    { rateKey: "custom_whole_kiln", chargeCents: 6_500 },
  );
});

test("deriveFiringRate requires whole-kiln selection beyond three half shelves", () => {
  assert.deepEqual(
    deriveFiringRate({ heatId: "mid", actualSpace: { billingUnit: "half_shelf", quantity: 4 } }),
    { rateKey: null, chargeCents: null },
  );
  assert.deepEqual(
    deriveFiringRate({ heatId: "unknown", actualSpace: { billingUnit: "half_shelf", quantity: 1 } }),
    { rateKey: null, chargeCents: null },
  );
});

test("firing customer subjects are stable by verified uid or anonymous ticket, never email", () => {
  const firstUid = deriveFiringCustomerSubject({ ownerUid: "artist-1", ticketId: "MF-ONE" });
  const sameUidOtherTicket = deriveFiringCustomerSubject({ ownerUid: "artist-1", ticketId: "MF-TWO" });
  const otherUid = deriveFiringCustomerSubject({ ownerUid: "artist-2", ticketId: "MF-ONE" });
  const firstAnonymous = deriveFiringCustomerSubject({ ownerUid: null, ticketId: "MF-ONE" });
  const secondAnonymous = deriveFiringCustomerSubject({ ownerUid: null, ticketId: "MF-TWO" });

  assert.equal(firstUid.linkId, sameUidOtherTicket.linkId);
  assert.notEqual(firstUid.linkId, otherUid.linkId);
  assert.notEqual(firstAnonymous.linkId, secondAnonymous.linkId);
  assert.equal(firstUid.type, "firebase_uid");
  assert.equal(firstAnonymous.type, "firing_ticket");
});

test("imported live customer reuse requires the complete verified migration chain", () => {
  const billingAccount = {
    stripeCustomerId: "cus_verified",
    legacyKilnfireUserId: "kf_1",
    linkStatus: "linked",
    linkEvidence: {
      type: "customer_id_email_and_kilnfire_metadata",
      sourceRowFingerprint: "row_hash",
    },
    sourceRunId: "run_1",
  };
  const legacyUser = {
    stripeCustomerId: "cus_verified",
    legacyKilnfireUserId: "kf_1",
    stripeLinkEvidence: "customer_id_email_and_kilnfire_metadata",
    sourceRowFingerprint: "row_hash",
    sourceRunId: "run_1",
  };
  const migrationRun = {
    kind: "kilnfire_user_import",
    mode: "live",
    status: "complete",
  };

  assert.equal(
    trustedImportedStripeCustomerId({ billingAccount, legacyUser, migrationRun }),
    "cus_verified",
  );
  assert.throws(
    () => trustedImportedStripeCustomerId({
      billingAccount,
      legacyUser: { ...legacyUser, sourceRowFingerprint: "wrong" },
      migrationRun,
    }),
    /migration evidence check/i,
  );
  assert.throws(
    () => trustedImportedStripeCustomerId({
      billingAccount,
      legacyUser,
      migrationRun: { ...migrationRun, status: "applied_pending_verification" },
    }),
    /migration evidence check/i,
  );
});

test("runtime customer resolution contains no email-only Stripe adoption path", () => {
  const source = readFileSync(join(__dirname, "../src/firingBilling.ts"), "utf8");
  assert.equal(source.includes("stripe.customers.list({ email"), false);
  assert.equal(source.includes("collection(\"users\").where(\"email\""), false);
});

for (const outcome of ["hold_for_review", "studio_fault_no_charge"] as const) {
  test(`${outcome} completes without touching any Stripe dependency`, async () => {
    const input = makeFinalizeInput({
      outcome,
      rateKey: null,
      finalChargeCents: 0,
      privateStaffNote: "PRIVATE-NOTE-SENTINEL",
    });
    const { calls, dependencies } = makeSagaDependencies();

    const result = await runFiringPickupBillingSaga(input, actor, runtime, dependencies);

    const expectedCompletion = outcome === "hold_for_review" ? "completeHold" : "completeNoCharge";
    assert.deepEqual(calls, ["reserve", expectedCompletion]);
    assert.equal(result.stripeMode, null);
    assert.equal(result.stripeInvoiceId, null);
    assert.equal(result.hostedInvoiceUrl, null);
    assert.equal(JSON.stringify(result).includes("PRIVATE-NOTE-SENTINEL"), false);
  });
}

test("a covered ticket finishes pickup without opening a Stripe invoice", async () => {
  const input = makeFinalizeInput({ rateKey: "high_shared_v3", finalChargeCents: 0 });
  const { calls, dependencies } = makeSagaDependencies();
  const result = await runFiringPickupBillingSaga(input, actor, runtime, dependencies);
  assert.deepEqual(calls, ["reserve", "completeNoCharge"]);
  assert.equal(result.billingStatus, "no_charge");
  assert.equal(result.stripeInvoiceId, null);
});

test("completed duplicate returns the stored billing result without re-running side effects", async () => {
  const input = makeFinalizeInput({ privateStaffNote: "PRIVATE-NOTE-SENTINEL" });
  const { calls, dependencies } = makeSagaDependencies({
    completed: true,
    ticketBillingStatus: "paid",
  });

  const result = await runFiringPickupBillingSaga(input, actor, runtime, dependencies);

  assert.deepEqual(calls, ["assertWriteReady", "reserve"]);
  assert.equal(result.duplicate, true);
  assert.equal(result.billingStatus, "paid");
  assert.equal(JSON.stringify(result).includes("PRIVATE-NOTE-SENTINEL"), false);
});

test("billable finalization fails closed before reservation when webhook readiness fails", async () => {
  const input = makeFinalizeInput();
  const { calls, dependencies } = makeSagaDependencies();
  dependencies.assertWriteReady = async () => {
    calls.push("assertWriteReady");
    throw new Error("webhook not ready");
  };

  await assert.rejects(
    runFiringPickupBillingSaga(input, actor, runtime, dependencies),
    /webhook not ready/,
  );
  assert.deepEqual(calls, ["assertWriteReady"]);
});

test("billable finalization checks readiness before the idempotent Stripe saga", async () => {
  const input = makeFinalizeInput();
  const { calls, dependencies } = makeSagaDependencies();

  const result = await runFiringPickupBillingSaga(input, actor, runtime, dependencies);

  assert.deepEqual(calls, [
    "assertWriteReady",
    "reserve",
    "resolveCustomer",
    "recordStep",
    "createDraftInvoice",
    "recordStep",
    "createInvoiceItem",
    "recordStep",
    "finalizeInvoice",
    "recordStep",
    "completeBillable",
  ]);
  assert.equal(result.billingStatus, "invoice_open");
  assert.equal(result.hostedInvoiceUrl, "https://invoice.stripe.test/in_1");
});

test("the approved v2 total reaches the invoice item and final billing result", async () => {
  const input = makeFinalizeInput({ actualSpace: { billingUnit: "whole_kiln", quantity: 1 }, rateKey: "mid_shared_v2", finalChargeCents: 14000, privateFulfilled: true, rushFulfilled: false });
  const { dependencies } = makeSagaDependencies();
  let sentAmount = 0;
  dependencies.createInvoiceItem = async (_reserved, command) => { sentAmount = command.finalChargeCents; return { id: "ii_1" }; };
  dependencies.finalizeInvoice = async () => ({ id: "in_1", hostedInvoiceUrl: "https://invoice.stripe.test/in_1", invoicePdfUrl: null, amountDue: 14000, status: "open" });
  const result = await runFiringPickupBillingSaga(input, actor, runtime, dependencies);
  assert.equal(sentAmount, 14000);
  assert.equal(result.finalChargeCents, 14000);
});

test("asynchronous pickup completion failure records reconciliation after invoice finalization", async () => {
  const { calls, dependencies } = makeSagaDependencies();
  dependencies.completeBillable = async () => {
    calls.push("completeBillable");
    await Promise.resolve();
    throw new Error("pickup email asset missing");
  };
  await assert.rejects(
    runFiringPickupBillingSaga(makeFinalizeInput(), actor, runtime, dependencies),
    /held for reconciliation/,
  );
  assert.equal(calls.filter((step) => step === "createDraftInvoice").length, 1);
  assert.equal(calls[calls.length - 1], "markReconciliationRequired");
});

test("successfully sent pickup notices do not advertise unfinished billing recovery", () => {
  const ticket = {
    status: "ready_for_pickup",
    billingStatus: "invoice_open",
    billingOperationId: "saved-operation",
  };
  for (const noticeStatus of ["queued", "sent"]) {
    assert.equal(queueTicketDto("MF-TEST", { ...ticket, noticeStatus }, true).canResumeBilling, false);
  }
  assert.equal(queueTicketDto("MF-TEST", { ...ticket, noticeStatus: "not_queued" }, true).canResumeBilling, true);
  assert.equal(queueTicketDto("MF-TEST", {
    ...ticket, billingStatus: "reconciliation_required", noticeStatus: "sent",
  }, true).canResumeBilling, true);
});

test("billing operation leases block concurrent work but expire for recovery", () => {
  const nowMs = Date.parse("2026-07-15T20:00:00.000Z");
  assert.equal(isBillingOperationLeaseActive({
    status: "in_progress",
    updatedAtMs: nowMs - 30_000,
    nowMs,
  }), true);
  assert.equal(isBillingOperationLeaseActive({
    status: "in_progress",
    updatedAtMs: nowMs - 121_000,
    nowMs,
  }), false);
  assert.equal(isBillingOperationLeaseActive({
    status: "reconciliation_required",
    updatedAtMs: nowMs - 1_000,
    nowMs,
  }), false);
});

test("firing webhook helpers recognize the supported invoice, credit-note, and refund events", () => {
  const eventTypes = [
    "invoice.finalization_failed",
    "invoice.finalized",
    "invoice.marked_uncollectible",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
    "credit_note.created",
    "credit_note.updated",
    "credit_note.voided",
    "refund.created",
    "refund.updated",
    "refund.failed",
  ];

  for (const eventType of eventTypes) {
    const event = makeEvent(eventType);
    assert.equal(getFiringTicketIdFromStripeEvent(event), "MF-7K4P", eventType);
    assert.equal(isFiringBillingStripeEvent(event), true, eventType);
  }
});

test("firing webhook helpers reject unrelated or unbound Stripe events", () => {
  assert.equal(getFiringTicketIdFromStripeEvent(makeEvent("customer.created")), null);
  assert.equal(
    getFiringTicketIdFromStripeEvent(makeEvent("invoice.paid", {
      source: "checkout",
      firing_ticket_id: "MF-7K4P",
    })),
    null,
  );
  assert.equal(
    getFiringTicketIdFromStripeEvent(makeEvent("invoice.paid", { source: "firing" })),
    null,
  );
});

test("invoice webhook status mapping is monotonic across delayed events", () => {
  assert.equal(nextInvoiceBillingStatus("unbilled", "invoice.finalized"), "invoice_open");
  assert.equal(nextInvoiceBillingStatus("invoice_open", "invoice.payment_failed"), "payment_failed");
  assert.equal(nextInvoiceBillingStatus("invoice_open", "invoice.marked_uncollectible"), "uncollectible");
  assert.equal(nextInvoiceBillingStatus("invoice_open", "invoice.voided"), "void");
  assert.equal(nextInvoiceBillingStatus("invoice_open", "invoice.paid"), "paid");

  assert.equal(nextInvoiceBillingStatus("paid", "invoice.payment_failed"), "paid");
  assert.equal(nextInvoiceBillingStatus("paid", "invoice.finalization_failed"), "paid");
  assert.equal(nextInvoiceBillingStatus("partially_refunded", "invoice.finalized"), "partially_refunded");
  assert.equal(nextInvoiceBillingStatus("refunded", "invoice.voided"), "refunded");
  assert.equal(nextInvoiceBillingStatus("void", "credit_note.updated"), "void");
});

test("firing webhook recognizes charge.refunded as the documented aggregate compatibility signal", () => {
  const event = makeEvent("charge.refunded");

  assert.equal(getFiringTicketIdFromStripeEvent(event), "MF-7K4P");
  assert.equal(isFiringBillingStripeEvent(event), true);
});
