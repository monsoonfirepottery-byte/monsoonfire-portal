/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionsClient } from "../../api/functionsClient";
import FiringPickupBillingModule from "./FiringPickupBillingModule";
import { missingArtistContactMessage } from "./staffContactValidation";
import { sortFiringTickets } from "./staffTicketSorting";

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: "MF-7K4P",
    displayName: "Test Artist",
    email: "artist@example.com",
    status: "awaiting_pickup_review",
    billingStatus: "unbilled",
    noticeStatus: "not_queued",
    billingVersion: 0,
    heatId: "mid",
    heatLabel: "Mid fire",
    estimatedSpace: "Two half shelves",
    estimatedPrice: "$50 example",
    requestedSpaceId: "double",
    artistNote: null,
    artistVisibleFiringNote: null,
    finalChargeCents: null,
    currency: "usd",
    stripeMode: null,
    stripeInvoiceId: null,
    hasPaymentLink: false,
    refundedAmountCents: 0,
    createdAt: "2026-07-15T19:00:00.000Z",
    updatedAt: "2026-07-15T19:00:00.000Z",
    ...overrides,
  };
}

function createClient(
  inputTicket: ReturnType<typeof ticket> | ReturnType<typeof ticket>[] = ticket(),
  options: {
    runtime?: {
      stripeMode: "test" | "live";
      invoicesEnabled: boolean;
      firingBillingEnabled: boolean;
      liveWritesEnabled: boolean;
      daysUntilDue: number;
      pickupInstructionsVersion: string;
    };
  } = {},
) {
  const tickets = Array.isArray(inputTicket) ? inputTicket : [inputTicket];
  const postJson = vi.fn(async (fn: string, _body?: unknown, _options?: unknown) => {
    if (fn === "staffListFiringPickupReviews") {
      return {
        ok: true,
        data: {
          tickets,
          runtime: options.runtime ?? {
            stripeMode: "test",
            invoicesEnabled: true,
            firingBillingEnabled: true,
            liveWritesEnabled: false,
            daysUntilDue: 14,
            pickupInstructionsVersion: "pickup-v1",
          },
        },
      };
    }
    return { ok: true, data: {} };
  });
  return {
    client: {
      postJson,
      getLastRequest: () => null,
      getLastCurl: () => "",
    } as FunctionsClient,
    postJson,
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("FiringPickupBillingModule", () => {
  it("keeps pickup and history outside the default work list without hiding payment failures", async () => {
    const { client } = createClient([
      ticket({ ticketId: "MF-001-NEW", displayName: "Incoming Artist", status: "expected_dropoff" }),
      ticket({ ticketId: "MF-002-DUE", displayName: "Pickup Artist", status: "ready_for_pickup", billingStatus: "invoice_open" }),
      ticket({ ticketId: "MF-003-DONE", displayName: "Past Artist", status: "picked_up", billingStatus: "paid" }),
      ticket({ ticketId: "MF-004-FAIL", displayName: "Problem Artist", status: "picked_up", billingStatus: "payment_failed" }),
    ]);
    render(<FiringPickupBillingModule client={client} isStaff view="tickets" />);
    const list = () => within(screen.getByRole("navigation", { name: "Firing tickets" }));
    await screen.findByRole("button", { name: "Needs work · 2" });
    expect(list().getByRole("button", { name: /Incoming Artist.*Expected drop-off/ })).toBeTruthy();
    expect(list().getByRole("button", { name: /Problem Artist.*Payment failed/ })).toBeTruthy();
    expect(list().queryByRole("button", { name: /Pickup Artist|Past Artist/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Awaiting pickup · 1" }));
    expect(list().getByRole("button", { name: /Pickup Artist.*payment due/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History · 1" }));
    expect(list().getByRole("button", { name: /Past Artist.*Picked up · paid/ })).toBeTruthy();
  });
  it("charges requested add-ons only when staff confirms fulfillment", async () => {
    const { client, postJson } = createClient(ticket({ pricingVersion: 2, requestedSpaceId: "large", addOnRequests: { private: true, rush: true } }));
    render(<FiringPickupBillingModule client={client} isStaff />);
    await screen.findByDisplayValue("120.00");
    fireEvent.click(screen.getByRole("checkbox", { name: /Private firing fulfilled/i }));
    await screen.findByDisplayValue("140.00");
    fireEvent.click(screen.getByRole("button", { name: /Mark ready & send pickup email/i }));
    await waitFor(() => expect(postJson.mock.calls.some(([fn, body]) => fn === "staffFinalizeFiringPickup" &&
      (body as { finalChargeCents: number; privateFulfilled: boolean; rushFulfilled: boolean }).finalChargeCents === 14000 &&
      (body as { privateFulfilled: boolean; rushFulfilled: boolean }).privateFulfilled &&
      !(body as { privateFulfilled: boolean; rushFulfilled: boolean }).rushFulfilled)).toBe(true));
  });

  it("adds fulfilled services to an independently entered custom quote", async () => {
    const { client, postJson } = createClient(ticket({ pricingVersion: 2, heatId: "custom", heatLabel: "Custom firing", requestedSpaceId: "large", addOnRequests: { rush: true } }));
    render(<FiringPickupBillingModule client={client} isStaff />);
    const quote = await screen.findByLabelText(/Custom firing quote before add-ons/i);
    fireEvent.change(quote, { target: { value: "180" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Same-night rush fulfilled/i }));
    await screen.findByDisplayValue("200.00");
    fireEvent.click(screen.getByRole("button", { name: /Mark ready & send pickup email/i }));
    await waitFor(() => expect(postJson.mock.calls.some(([fn, body]) => fn === "staffFinalizeFiringPickup" &&
      (body as { finalChargeCents: number; customBaseChargeCents: number }).finalChargeCents === 20000 &&
      (body as { customBaseChargeCents: number }).customBaseChargeCents === 18000)).toBe(true));
  });

  it("requires staff to account for other requested services before billing", async () => {
    const { client, postJson } = createClient(ticket({ pricingVersion: 2, otherRequestedServices: ["Studio glaze access"] }));
    render(<FiringPickupBillingModule client={client} isStaff />);
    await screen.findByText(/Review other requested services before billing: Studio glaze access/i);
    await screen.findByDisplayValue("70.00");
    fireEvent.click(screen.getByRole("button", { name: /Mark ready & send pickup email/i }));
    expect(await screen.findByText(/Record how the other requested services were handled/i)).toBeTruthy();
    expect(postJson.mock.calls.some(([fn]) => fn === "staffFinalizeFiringPickup")).toBe(false);
  });
  it("sorts tickets deterministically without changing the source queue", () => {
    const tickets = [
      ticket({ ticketId: "MF-Z9", displayName: "Zed", updatedAt: "2026-07-20T12:00:00.000Z" }),
      ticket({ ticketId: "MF-A1", displayName: "Ada", updatedAt: "2026-07-20T13:00:00.000Z" }),
    ];
    expect(sortFiringTickets(tickets, "artist", () => 0).map((item) => item.displayName)).toEqual(["Ada", "Zed"]);
    expect(sortFiringTickets(tickets, "updated_desc", () => 0).map((item) => item.ticketId)).toEqual(["MF-A1", "MF-Z9"]);
    expect(tickets.map((item) => item.ticketId)).toEqual(["MF-Z9", "MF-A1"]);
  });

  it("reports only the contact field that is actually missing", () => {
    expect(missingArtistContactMessage("Codex QA - width and compact ID", "")).toBe(
      "Add artist email before marking the work ready.",
    );
    expect(missingArtistContactMessage("", "")).toBe(
      "Add artist name and artist email before marking the work ready.",
    );
    expect(missingArtistContactMessage("Artist", "artist@example.com")).toBeNull();
  });

  it("guides missing artist email beside the field instead of raising a page alert", async () => {
    const { client, postJson } = createClient(ticket({ email: null }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    await screen.findByDisplayValue("Test Artist");
    fireEvent.click(screen.getByRole("button", { name: /Mark ready & send pickup email/i }));

    const email = screen.getByRole("textbox", { name: /Email/ });
    expect(await screen.findByText("Add the artist email to send the pickup note.")).toBeTruthy();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(postJson.mock.calls.some(([fn]) => fn === "staffFinalizeFiringPickup")).toBe(false);

    fireEvent.change(email, { target: { value: "artist@example.com" } });
    expect(screen.queryByText("Add the artist email to send the pickup note.")).toBeNull();
  });

  it("offers recent artist matches instead of silently guessing an email", async () => {
    const { client } = createClient([
      ticket({ ticketId: "MF-NEW", displayName: "New ticket", email: null, updatedAt: "2026-07-20T14:00:00.000Z" }),
      ticket({ ticketId: "MF-OLD", displayName: "Known Artist", email: "known@example.com", updatedAt: "2026-07-19T14:00:00.000Z" }),
    ]);
    render(<FiringPickupBillingModule client={client} isStaff />);

    const name = await screen.findByRole("textbox", { name: /Name or nickname/i });
    fireEvent.change(name, { target: { value: "Known Artist" } });

    const suggestion = await screen.findByRole("button", { name: /Use Known Artist · known@example\.com/i });
    expect(screen.getByText("Choose one only if it is the same person.")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    fireEvent.click(suggestion);
    const email = await screen.findByDisplayValue("known@example.com");

    fireEvent.change(email, { target: { value: "manual@example.com" } });
    expect((email as HTMLInputElement).value).toBe("manual@example.com");
  });

  it("finds a partial recent-name match without changing contact data until chosen", async () => {
    const { client } = createClient([
      ticket({ ticketId: "MF-NEW", displayName: "New ticket", email: null, updatedAt: "2026-07-20T14:00:00.000Z" }),
      ticket({ ticketId: "MF-OLD", displayName: "Micha Wynne", email: "micah@example.com", updatedAt: "2026-07-19T14:00:00.000Z" }),
    ]);
    render(<FiringPickupBillingModule client={client} isStaff />);

    const name = await screen.findByRole("textbox", { name: /Name or nickname/i });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("New ticket"));
    fireEvent.change(name, { target: { value: "Micha" } });
    expect(await screen.findByRole("button", { name: /Use Micha Wynne · micah@example\.com/i })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
  });

  it("keeps ticket details collapsed below the ready action", async () => {
    const { client } = createClient();
    render(<FiringPickupBillingModule client={client} isStaff />);

    const ready = await screen.findByRole("button", { name: /Mark ready & send pickup email/i });
    const details = screen.getByText("Ticket details").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(ready.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("uses the actual shelf selection and sends one confirmed test-mode finalization", async () => {
    const { client, postJson } = createClient();
    render(<FiringPickupBillingModule client={client} isStaff />);

    await screen.findByDisplayValue("Test Artist");
    expect(screen.getByDisplayValue("50.00")).toBeTruthy();
    const submit = screen.getByRole("button", { name: /Mark ready & send pickup email/i });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(postJson.mock.calls.filter(([fn]) => fn === "staffFinalizeFiringPickup")).toHaveLength(1);
    });
    const call = postJson.mock.calls.find(([fn]) => fn === "staffFinalizeFiringPickup");
    expect(call?.[1]).toMatchObject({
      ticketId: "MF-7K4P",
      expectedVersion: 0,
      outcome: "normal_billable",
      actualSpace: { billingUnit: "half_shelf", quantity: 2 },
      rateKey: "mid_half_shelf",
      finalChargeCents: 5_000,
      confirmedReady: true,
      artistContact: { displayName: "Test Artist", email: "artist@example.com" },
    });
  });

  it("makes a locked live billing action visibly unavailable", async () => {
    const { client, postJson } = createClient(ticket(), {
      runtime: {
        stripeMode: "live",
        invoicesEnabled: true,
        firingBillingEnabled: true,
        liveWritesEnabled: false,
        daysUntilDue: 14,
        pickupInstructionsVersion: "pickup-v1",
      },
    });
    render(<FiringPickupBillingModule client={client} isStaff />);

    const submit = await screen.findByRole("button", { name: /Live billing locked · use Settings/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(postJson.mock.calls.some(([fn]) => fn === "staffFinalizeFiringPickup")).toBe(false);
  });

  it("saves a hold without confirmation, invoice, or pickup email language", async () => {
    const { client, postJson } = createClient();
    render(<FiringPickupBillingModule client={client} isStaff />);

    await screen.findByDisplayValue("Test Artist");
    fireEvent.click(screen.getByLabelText(/Hold · send nothing yet/i));
    fireEvent.click(screen.getByRole("button", { name: /Save hold · send nothing/i }));

    await waitFor(() => {
      expect(postJson.mock.calls.some(([fn]) => fn === "staffFinalizeFiringPickup")).toBe(true);
    });
    const call = postJson.mock.calls.find(([fn]) => fn === "staffFinalizeFiringPickup");
    expect(call?.[1]).toMatchObject({
      outcome: "hold_for_review",
      finalChargeCents: 0,
      artistContact: null,
      confirmedReady: false,
    });
  });

  it("opens an unloaded firing directly without exposing batch wiring", async () => {
    const { client, postJson } = createClient(ticket({ status: "expected_dropoff" }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    await screen.findByRole("button", { name: /Review this unloaded firing/i });
    expect(screen.queryByLabelText(/Firing batch ID/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Review this unloaded firing/i }));

    await waitFor(() => {
      expect(postJson.mock.calls.some(([fn]) => fn === "staffPrepareFiringPickupReview")).toBe(true);
    });
    const call = postJson.mock.calls.find(([fn]) => fn === "staffPrepareFiringPickupReview");
    expect(call?.[1]).toMatchObject({
      ticketId: "MF-7K4P",
      expectedVersion: 0,
      action: "confirm_unloaded",
      batchId: null,
      confirmedUnloaded: true,
    });
    const options = call?.[2] as { headers?: Record<string, string> } | undefined;
    expect(typeof options?.headers?.["Idempotency-Key"]).toBe("string");
  });

  it("offers server-side recovery instead of starting a second invoice", async () => {
    const { client, postJson } = createClient(ticket({
      billingStatus: "reconciliation_required",
      canResumeBilling: true,
      billingOperationId: "firing-billing-operation-1",
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    const resume = await screen.findByRole("button", { name: /Continue saved billing update/i });
    expect(screen.queryByRole("button", { name: /Mark ready/i })).toBeNull();
    fireEvent.click(resume);

    await waitFor(() => {
      expect(postJson).toHaveBeenCalledWith("staffResumeFiringBillingOperation", {
        ticketId: "MF-7K4P",
        operationId: "firing-billing-operation-1",
      });
    });
  });

  it("records physical pickup immediately while payment is still open", async () => {
    const { client, postJson } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "invoice_open",
      noticeStatus: "sent",
      finalChargeCents: 5_000,
      stripeInvoiceId: "in_test_1",
      hasPaymentLink: true,
      billingVersion: 4,
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    const pickupButton = await screen.findByRole("button", { name: /Mark work picked up/i });
    expect(pickupButton).toBeTruthy();
    expect(screen.getByText("Payment is still open.").closest(".staff-note")?.classList.contains("staff-note-warn"))
      .toBe(true);
    expect(screen.getByText("Pickup does not collect payment automatically.")).toBeTruthy();
    expect(screen.queryByLabelText(/artist or their helper has the work/i)).toBeNull();
    fireEvent.click(pickupButton);

    await waitFor(() => {
      expect(postJson.mock.calls.some(([fn]) => fn === "staffMarkFiringPickedUp")).toBe(true);
    });
    const call = postJson.mock.calls.find(([fn]) => fn === "staffMarkFiringPickedUp");
    expect(call?.[1]).toMatchObject({
      ticketId: "MF-7K4P",
      expectedVersion: 4,
      confirmedPickedUp: true,
    });
    const options = call?.[2] as { headers?: Record<string, string> } | undefined;
    expect(typeof options?.headers?.["Idempotency-Key"]).toBe("string");
  });

  it("recovers a failed pickup email without starting finalization again", async () => {
    const { client, postJson } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "invoice_open",
      noticeStatus: "failed",
      finalChargeCents: 5_000,
      stripeInvoiceId: "in_test_1",
      hasPaymentLink: true,
      billingVersion: 4,
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    const resend = await screen.findByRole("button", { name: /Resend pickup details/i });
    fireEvent.click(resend);
    fireEvent.click(resend);

    await waitFor(() => {
      expect(postJson.mock.calls.filter(([fn]) => fn === "staffResendFiringPickupNotice")).toHaveLength(1);
    });
    expect(postJson.mock.calls.some(([fn]) => fn === "staffFinalizeFiringPickup")).toBe(false);
  });

  it("does not offer stale pickup directions after work has left the studio", async () => {
    const { client } = createClient(ticket({
      status: "picked_up",
      billingStatus: "paid",
      noticeStatus: "sent",
      finalChargeCents: 5_000,
      billingVersion: 5,
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    expect(await screen.findByText(/The work has left the studio/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resend pickup details/i })).toBeNull();
  });

  it("shows a completed payment receipt and exposes explicit reprint and email actions", async () => {
    const { client, postJson } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "paid",
      finalChargeCents: 5_000,
      billingVersion: 6,
      stripeReceiptPrint: { status: "printed", cupsJobId: "Star_TSP143IIIU-19" },
      receiptMailStatus: "sent",
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    expect(await screen.findByText(/Printed · Star_TSP143IIIU-19/i)).toBeTruthy();
    const reprint = screen.getByRole("button", { name: /Print another receipt/i });
    const email = screen.getByRole("button", { name: /Email paid invoice again/i });
    fireEvent.click(reprint);
    await waitFor(() => expect(postJson.mock.calls.some(([fn]) => fn === "staffQueueFiringReceiptPrint")).toBe(true));
    const reprintCall = postJson.mock.calls.find(([fn]) => fn === "staffQueueFiringReceiptPrint");
    expect(reprintCall?.[1]).toMatchObject({ ticketId: "MF-7K4P", action: "reprint" });

    fireEvent.click(email);
    await waitFor(() => expect(postJson.mock.calls.some(([fn]) => fn === "staffResendFiringPaidReceipt")).toBe(true));
  });

  it("keeps refund evidence digital and does not offer another paper receipt", async () => {
    const { client } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "partially_refunded",
      finalChargeCents: 5_000,
      refundedAmountCents: 500,
      stripeReceiptPrint: { status: "printed", cupsJobId: "Star_TSP143IIIU-19" },
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    expect(await screen.findByText(/Refunds stay digital in Stripe/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Print another receipt/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /retry receipt/i })).toBeNull();
  });

  it("emails an open invoice again and keeps the delete action available before billing", async () => {
    const { client, postJson } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "invoice_open",
      finalChargeCents: 5_000,
      stripeInvoiceId: "in_test_1",
      hasPaymentLink: true,
      hasInvoiceLink: true,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FiringPickupBillingModule client={client} isStaff />);

    fireEvent.click(await screen.findByRole("button", { name: "Email invoice" }));
    await waitFor(() => expect(postJson.mock.calls.some(([fn]) => fn === "staffResendFiringInvoice")).toBe(true));

    cleanup();
    const deleteClient = createClient(ticket({ status: "expected_dropoff", billingStatus: "unbilled" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FiringPickupBillingModule client={deleteClient.client} isStaff />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete ticket" }));
    await waitFor(() => expect(deleteClient.postJson.mock.calls.some(([fn]) => fn === "staffDeleteFiringTicket")).toBe(true));
  });

  it("does not offer deletion for a ticket with payment history", async () => {
    const { client } = createClient(ticket({
      status: "ready_for_pickup",
      billingStatus: "paid",
      stripeInvoiceId: "in_paid_1",
      hasInvoiceLink: true,
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    expect((await screen.findByRole("button", { name: "Delete ticket" })).disabled).toBe(true);
  });

  it("queues the original work slip for the studio thermal printer without opening a browser print window", async () => {
    const { client, postJson } = createClient(ticket({ status: "expected_dropoff" }));
    const open = vi.spyOn(window, "open");
    render(<FiringPickupBillingModule client={client} isStaff />);

    fireEvent.click(await screen.findByRole("button", { name: "Print work slip" }));

    await waitFor(() => expect(postJson.mock.calls.some(([fn]) => fn === "staffQueueFiringWorkSlipPrint")).toBe(true));
    const queueCall = postJson.mock.calls.find(([fn]) => fn === "staffQueueFiringWorkSlipPrint");
    expect(typeof (queueCall?.[1] as { clientRequestId?: unknown } | undefined)?.clientRequestId).toBe("string");
    expect(queueCall?.[1]).toMatchObject({
      ticketId: "MF-7K4P",
      action: "original",
    });
    expect(typeof (queueCall?.[2] as { headers?: Record<string, unknown> } | undefined)?.headers?.["Idempotency-Key"]).toBe("string");
    expect(open).not.toHaveBeenCalled();
  });

  it("queues a reprint only after the thermal printer reports the original as printed", async () => {
    const { client, postJson } = createClient(ticket({
      status: "expected_dropoff",
      workSlipPrint: { status: "printed", cupsJobId: "Star_TSP143IIIU-22", reprintCount: 0 },
    }));
    render(<FiringPickupBillingModule client={client} isStaff />);

    expect(await screen.findByText(/Printed · Star_TSP143IIIU-22/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reprint work slip" }));

    await waitFor(() => expect(postJson.mock.calls.some(([fn]) => fn === "staffQueueFiringWorkSlipPrint")).toBe(true));
    const queueCall = postJson.mock.calls.find(([fn]) => fn === "staffQueueFiringWorkSlipPrint");
    expect(typeof (queueCall?.[1] as { clientRequestId?: unknown } | undefined)?.clientRequestId).toBe("string");
    expect(queueCall?.[1]).toMatchObject({
      ticketId: "MF-7K4P",
      action: "reprint",
    });
  });
});
