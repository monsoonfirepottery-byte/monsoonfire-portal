/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash, randomBytes } from "crypto";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { z } from "zod";

import {
  FieldValue,
  Timestamp,
  applyCors,
  asInt,
  db,
  enforceRateLimit,
  isAdminFromDecoded,
  isStaffFromDecoded,
  makeIdempotencyId,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthUid,
  safeString,
  type RequestLike,
  type ResponseLike,
} from "./shared";
import {
  STRIPE_SECRET_PARAMS,
  type StripeMode,
} from "./stripeSecrets";
import {
  getStripeClient,
  loadStripeConfig,
  readStripeIdempotencyKey,
  STRIPE_FIRING_BILLING_WEBHOOK_EVENTS,
  type StripeConfigInput,
} from "./stripeRuntime";
import {
  requireActiveStripeWebhookWriteReadiness,
  StripeWebhookAttestationError,
} from "./stripeWebhookReadiness";
import { getFiringEmailInlineAsset } from "./firingEmailTemplates";
import { firingTicketLockId, hasExistingFiringTicket, manualFiringKey, staffCreateFiringTicketSchema, staffTicketInitialState, type StaffCreateFiringTicketInput } from "./staffFiringTicket";
import { calculateFiringPrice, newFiringPricingVersion } from "./firingPricing";
import { addFiringLedgerEntry, type FiringPricingLedger } from "./firingPricingLedger";
import { reservationFiringRequests } from "./reservationFiringBridge";

export { STRIPE_FIRING_BILLING_WEBHOOK_EVENTS } from "./stripeRuntime";

const REGION = "us-central1";
const SUPPORT_EMAIL = "support@monsoonfire.com";
const POLICIES_URL = "https://monsoonfire.com/policies/";
const PRIVACY_URL = "https://monsoonfire.com/privacy/";
const TERMS_URL = "https://monsoonfire.com/terms/";
const ACCESSIBILITY_URL = "https://monsoonfire.com/accessibility/";
const STUDIO_POSTAL_ADDRESS = "17926 West Montebello Ave., Litchfield Park, AZ 85340";
const SERVICE_POLICY_VERSION = "2026-07-19";
const FIRING_TICKETS_COLLECTION = "firingTickets";
const BILLING_OPERATIONS_COLLECTION = "firingBillingOperations";
const CUSTOMER_LINKS_COLLECTION = "firingBillingCustomerLinks";
const MAIL_COLLECTION = "mail";
const USERS_COLLECTION = "users";
const LEGACY_USERS_COLLECTION = "legacyUsers";
const PICKUP_DETAILS_TOKENS_COLLECTION = "firingPickupDetailsTokens";
const MAX_MANUAL_FIRING_CHARGE_CENTS = 1_000_000;
const BILLING_OPERATION_LEASE_MS = 2 * 60 * 1000;
const PICKUP_DETAILS_TOKEN_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const PICKUP_DETAILS_RESEND_WINDOW_MS = 15 * 60 * 1000;
const PICKUP_DETAILS_ENDPOINT = "https://us-central1-monsoonfire-portal.cloudfunctions.net/requestFiringPickupDetails/v1";
const FIRING_MAIL_SOURCES = new Set([
  "firing-pickup-ready",
  "firing-pickup-ready-resend",
  "firing-pickup-directions-resend",
  "firing-billing-adjustment",
  "firing-paid-receipt-resend",
]);

const billableOutcomeSchema = z.enum(["normal_billable", "maker_risk_billable"]);
const firingOutcomeSchema = z.enum([
  "normal_billable",
  "maker_risk_billable",
  "studio_fault_no_charge",
  "hold_for_review",
]);
const actualSpaceSchema = z.object({
  billingUnit: z.enum(["half_shelf", "whole_kiln", "custom"]),
  quantity: z.number().int().positive().max(20),
}).strict();

export const staffFinalizeFiringPickupSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  expectedVersion: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  outcome: firingOutcomeSchema,
  actualSpace: actualSpaceSchema,
  rateKey: z.string().trim().min(1).max(80).nullable().optional().default(null),
  finalChargeCents: z.number().int().min(0).max(MAX_MANUAL_FIRING_CHARGE_CENTS),
  privateFulfilled: z.boolean().optional(),
  rushFulfilled: z.boolean().optional(),
  customBaseChargeCents: z.number().int().min(0).max(MAX_MANUAL_FIRING_CHARGE_CENTS).optional(),
  currency: z.literal("usd").default("usd"),
  overrideReason: z.string().trim().max(500).nullable().optional().default(null),
  artistVisibleFiringNote: z.string().trim().max(1200).nullable().optional().default(null),
  privateStaffNote: z.string().trim().max(2000).nullable().optional().default(null),
  artistContact: z.object({
    displayName: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(320),
  }).strict().nullable().optional().default(null),
  confirmedReady: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.outcome !== "hold_for_review" && value.confirmedReady !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedReady"],
      message: "Confirm that the fired work is ready for pickup",
    });
  }
});

export const staffLookupFiringArtistContactSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
}).strict();

export const staffAdjustFiringBillingSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  expectedVersion: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  action: z.enum(["void_invoice", "credit_open_invoice", "refund_paid_invoice"]),
  amountCents: z.number().int().min(0).max(MAX_MANUAL_FIRING_CHARGE_CENTS).default(0),
  reason: z.string().trim().min(4).max(500),
  artistVisibleNote: z.string().trim().max(1200).nullable().optional().default(null),
  privateStaffNote: z.string().trim().max(2000).nullable().optional().default(null),
}).strict().superRefine((value, context) => {
  if (value.action !== "void_invoice" && value.amountCents <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "A positive adjustment amount is required",
    });
  }
});

export const staffPrepareFiringPickupReviewSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  expectedVersion: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  action: z.enum(["link_batch", "confirm_unloaded"]).default("confirm_unloaded"),
  batchId: z.string().trim().min(1).max(160).nullable().optional().default(null),
  confirmedUnloaded: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.action === "link_batch" && !value.batchId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["batchId"],
      message: "A portal batch is required before linking",
    });
  }
  if (value.action === "confirm_unloaded" && value.confirmedUnloaded !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedUnloaded"],
      message: "Confirm that the kiln is unloaded",
    });
  }
});

export const staffMarkFiringPickedUpSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  expectedVersion: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  confirmedPickedUp: z.literal(true),
}).strict();

export type StaffFinalizeFiringPickupInput = z.infer<typeof staffFinalizeFiringPickupSchema>;
export type StaffAdjustFiringBillingInput = z.infer<typeof staffAdjustFiringBillingSchema>;
export type StaffPrepareFiringPickupReviewInput = z.infer<typeof staffPrepareFiringPickupReviewSchema>;
export type StaffMarkFiringPickedUpInput = z.infer<typeof staffMarkFiringPickedUpSchema>;

type StaffActor = {
  uid: string;
  email: string | null;
  mode: "staff" | "dev";
};

type FiringBillingRuntime = {
  stripeMode: StripeMode;
  invoicesEnabled: boolean;
  firingBillingEnabled: boolean;
  liveWritesEnabled: boolean;
  daysUntilDue: number;
  pickupInstructions: string;
  pickupInstructionsVersion: string;
};

type TicketSnapshot = {
  ticketId: string;
  displayName: string;
  email: string;
  heatId: string;
  heatLabel: string;
  estimatedSpace: string | null;
  status: string;
  billingStatus: string;
  billingVersion: number;
  ownerUid: string | null;
};

type ReservedFinalization = {
  operationId: string;
  duplicate: boolean;
  completed: boolean;
  ticket: TicketSnapshot;
  stripeMode: StripeMode | null;
  stripeCustomerId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceItemId: string | null;
  hostedInvoiceUrl: string | null;
  resultBillingStatus: string | null;
  billedAddOns?: { private: boolean; rush: boolean };
};

type StripeCustomerResolution = {
  customerId: string;
  ownerUid: string | null;
};

type InvoiceStepResult = {
  id: string;
};

type FinalizedInvoiceResult = {
  id: string;
  hostedInvoiceUrl: string;
  invoicePdfUrl: string | null;
  amountDue: number;
  status: string;
};

export type FiringPickupSagaResult = {
  ticketId: string;
  operationId: string;
  outcome: z.infer<typeof firingOutcomeSchema>;
  billingStatus: string;
  noticeStatus: string;
  finalChargeCents: number;
  currency: "usd";
  stripeMode: StripeMode | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  duplicate: boolean;
};

export type FiringPickupSagaDependencies = {
  assertWriteReady: (runtime: FiringBillingRuntime) => Promise<void>;
  reserve: (
    input: StaffFinalizeFiringPickupInput,
    actor: StaffActor,
    runtime: FiringBillingRuntime,
  ) => Promise<ReservedFinalization>;
  resolveCustomer: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    runtime: FiringBillingRuntime,
  ) => Promise<StripeCustomerResolution>;
  createDraftInvoice: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    runtime: FiringBillingRuntime,
    customer: StripeCustomerResolution,
  ) => Promise<InvoiceStepResult>;
  createInvoiceItem: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    runtime: FiringBillingRuntime,
    customer: StripeCustomerResolution,
    invoiceId: string,
  ) => Promise<InvoiceStepResult>;
  finalizeInvoice: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    runtime: FiringBillingRuntime,
    invoiceId: string,
  ) => Promise<FinalizedInvoiceResult>;
  recordStep: (
    operationId: string,
    step: string,
    values: Record<string, unknown>,
  ) => Promise<void>;
  completeHold: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    actor: StaffActor,
  ) => Promise<FiringPickupSagaResult>;
  completeNoCharge: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    actor: StaffActor,
    runtime: FiringBillingRuntime,
  ) => Promise<FiringPickupSagaResult>;
  completeBillable: (
    reserved: ReservedFinalization,
    input: StaffFinalizeFiringPickupInput,
    actor: StaffActor,
    runtime: FiringBillingRuntime,
    customer: StripeCustomerResolution,
    invoice: FinalizedInvoiceResult,
  ) => Promise<FiringPickupSagaResult>;
  markReconciliationRequired: (
    reserved: ReservedFinalization,
    error: unknown,
  ) => Promise<void>;
};

export class FiringBillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "FiringBillingError";
  }
}

function cleanNullable(value: string | null | undefined): string | null {
  const normalized = safeString(value).trim();
  return normalized || null;
}

function normalizeEmail(value: unknown): string {
  return safeString(value).trim().toLowerCase();
}

export function canClaimFiringTicketByVerifiedEmail(input: {
  ticketEmail: unknown;
  ticketOwnerUid: unknown;
  uid: string;
  verifiedEmail: unknown;
  emailVerified: unknown;
}): boolean {
  const uid = safeString(input.uid).trim();
  const verifiedEmail = normalizeEmail(input.verifiedEmail);
  const ticketEmail = normalizeEmail(input.ticketEmail);
  const ticketOwnerUid = cleanNullable(safeString(input.ticketOwnerUid));
  return Boolean(
    uid &&
    input.emailVerified === true &&
    verifiedEmail &&
    ticketEmail === verifiedEmail &&
    (!ticketOwnerUid || ticketOwnerUid === uid),
  );
}

export function canAccessFiringTicket(input: {
  ticketEmail: unknown;
  ticketOwnerUid: unknown;
  uid: string;
  verifiedEmail: unknown;
  emailVerified: unknown;
}): boolean {
  return cleanNullable(safeString(input.ticketOwnerUid)) === safeString(input.uid).trim() ||
    canClaimFiringTicketByVerifiedEmail(input);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableCommandHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

export function isBillingOperationLeaseActive(params: {
  status: string;
  updatedAtMs: number;
  nowMs?: number;
}): boolean {
  if (params.status !== "in_progress") return false;
  const nowMs = params.nowMs ?? Date.now();
  return params.updatedAtMs > 0 && nowMs - params.updatedAtMs < BILLING_OPERATION_LEASE_MS;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function htmlWithBreaks(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export type FiringMailDeliveryTransition = {
  noticeStatus: "sent" | "failed";
  deliveryState: "SUCCESS" | "ERROR";
};

export function deriveFiringMailDeliveryTransition(params: {
  source: unknown;
  beforeState: unknown;
  afterState: unknown;
}): FiringMailDeliveryTransition | null {
  const source = safeString(params.source).trim();
  if (!FIRING_MAIL_SOURCES.has(source)) return null;

  const beforeState = safeString(params.beforeState).trim().toUpperCase();
  const afterState = safeString(params.afterState).trim().toUpperCase();
  if (!afterState || beforeState === afterState) return null;
  if (afterState === "SUCCESS") return { noticeStatus: "sent", deliveryState: "SUCCESS" };
  if (afterState === "ERROR") return { noticeStatus: "failed", deliveryState: "ERROR" };
  return null;
}

export type FiringPickupTransition = {
  status: "picked_up";
  billingStatus: string;
  billingVersion: number;
  duplicate: boolean;
};

export function deriveFiringPickupTransition(params: {
  status: string;
  billingStatus: string;
  billingVersion: number;
  expectedVersion: number;
}): FiringPickupTransition {
  const status = params.status.trim() || "expected_dropoff";
  const billingStatus = params.billingStatus.trim() || "unbilled";
  const billingVersion = Math.max(params.billingVersion, 0);

  if (status === "picked_up") {
    return { status: "picked_up", billingStatus, billingVersion, duplicate: true };
  }
  if (status !== "ready_for_pickup") {
    throw new FiringBillingError(
      "TICKET_NOT_READY_FOR_PICKUP",
      "This firing ticket is not ready to be marked picked up.",
      409,
    );
  }
  if (billingVersion !== params.expectedVersion) {
    throw new FiringBillingError(
      "TICKET_VERSION_CONFLICT",
      "This ticket changed after you opened it. Refresh before marking it picked up.",
      409,
    );
  }

  return {
    status: "picked_up",
    billingStatus,
    billingVersion: billingVersion + 1,
    duplicate: false,
  };
}

export function canResendFiringPickupNotice(params: {
  status: unknown;
  pickupMailId: unknown;
}): boolean {
  return safeString(params.status).trim() === "ready_for_pickup" &&
    Boolean(cleanNullable(safeString(params.pickupMailId)));
}

function readTicketHeat(ticket: Record<string, unknown>): { id: string; label: string } {
  const selection = asRecord(ticket.selection);
  const artifact = asRecord(ticket.artifact);
  const id = safeString(selection.heatId).trim().toLowerCase() || "unknown";
  const label = safeString(artifact.heat).trim() ||
    (id === "low" ? "Low fire" : id === "mid" ? "Mid fire" : id === "custom" ? "Custom firing" : "Firing");
  return { id, label };
}

export function deriveFiringRate(params: {
  heatId: string;
  actualSpace: StaffFinalizeFiringPickupInput["actualSpace"];
  pricingVersion?: number | null;
  privateFulfilled?: boolean;
  rushFulfilled?: boolean;
}): { rateKey: string | null; chargeCents: number | null } {
  return calculateFiringPrice({ version: params.pricingVersion, heatId: params.heatId, ...params.actualSpace,
    privateFulfilled: params.privateFulfilled, rushFulfilled: params.rushFulfilled });
}

function spaceDescription(actualSpace: StaffFinalizeFiringPickupInput["actualSpace"]): string {
  if (actualSpace.billingUnit === "whole_kiln") return "whole kiln";
  if (actualSpace.billingUnit === "custom") return "custom kiln load";
  return `${actualSpace.quantity} half ${actualSpace.quantity === 1 ? "shelf" : "shelves"}`;
}

export function firingInvoiceCopy(params: {
  ticketId: string;
  heatLabel: string;
  actualSpace: StaffFinalizeFiringPickupInput["actualSpace"];
}) {
  return {
    description: "Firing service",
    customField: { name: "Firing ticket", value: params.ticketId },
    footer: "Final charges reflect the kiln space actually used.",
    lineDescription:
      `Firing service — ${params.heatLabel} — ${spaceDescription(params.actualSpace)} · Ticket ${params.ticketId}`,
  };
}

export function firingInvoiceLineDescription(params: {
  ticketId: string;
  heatLabel: string;
  actualSpace: StaffFinalizeFiringPickupInput["actualSpace"];
  privateFulfilled?: boolean;
  rushFulfilled?: boolean;
}): string {
  return `${firingInvoiceCopy(params).lineDescription}${params.privateFulfilled ? " · Private firing +$20" : ""}${params.rushFulfilled ? " · Same-night rush +$20" : ""}`;
}

export function validateChargeForTicket(
  input: StaffFinalizeFiringPickupInput,
  heatId: string,
  ticketData: Record<string, unknown>,
  aggregateRate?: { rateKey: string; chargeCents: number },
): { rateMatched: boolean; expectedChargeCents: number | null } {
  if (input.outcome === "studio_fault_no_charge" || input.outcome === "hold_for_review") {
    if (input.finalChargeCents !== 0) {
      throw new FiringBillingError(
        "NON_BILLABLE_AMOUNT_MUST_BE_ZERO",
        "No-charge and hold decisions must have a zero final charge.",
      );
    }
    return { rateMatched: true, expectedChargeCents: 0 };
  }
  if (!billableOutcomeSchema.safeParse(input.outcome).success || (input.finalChargeCents <= 0 && aggregateRate?.chargeCents !== 0)) {
    throw new FiringBillingError("BILLABLE_AMOUNT_REQUIRED", "A billable firing needs a positive final charge.");
  }
  const requests = asRecord(ticketData.addOnRequests);
  if (Array.isArray(ticketData.otherRequestedServices) && ticketData.otherRequestedServices.length > 0 && !cleanNullable(input.overrideReason)) {
    throw new FiringBillingError("ADDITIONAL_SERVICES_REVIEW_REQUIRED", "Review the other requested services and record how they were handled before billing.");
  }
  if ((input.privateFulfilled && requests.private !== true) || (input.rushFulfilled && requests.rush !== true)) {
    throw new FiringBillingError("ADD_ON_NOT_REQUESTED", "Only requested add-ons can be marked fulfilled.");
  }
  const version = ticketData.pricingVersion;
  const customQuote = (version === 2 || version === 3) && (heatId === "custom" || input.actualSpace.billingUnit === "custom");
  if (version === 3 && !customQuote && !aggregateRate) {
    throw new FiringBillingError("FIRING_AGGREGATION_REQUIRED", "Version 3 billing requires customer-and-firing aggregation.", 409);
  }
  if (customQuote && input.customBaseChargeCents == null) throw new FiringBillingError("CUSTOM_QUOTE_REQUIRED", "Enter the custom firing quote before adding fulfilled services.");
  const standard = aggregateRate ?? (customQuote ? { rateKey: `custom_quote_v${version}`, chargeCents: (input.customBaseChargeCents ?? 0) + (input.privateFulfilled ? 2000 : 0) + (input.rushFulfilled ? 2000 : 0) } : deriveFiringRate({ heatId, actualSpace: input.actualSpace, pricingVersion: typeof ticketData.pricingVersion === "number" ? ticketData.pricingVersion : null,
    privateFulfilled: input.privateFulfilled, rushFulfilled: input.rushFulfilled }));
  const rateMatched = standard.rateKey !== null &&
    standard.chargeCents === input.finalChargeCents &&
    standard.rateKey === input.rateKey;
  if (!rateMatched && aggregateRate) {
    throw new FiringBillingError("FIRING_AGGREGATE_PRICE_CHANGED", `The remaining firing charge is ${formatMoney(aggregateRate.chargeCents)}. Review the customer’s other tickets before retrying.`, 409);
  }
  if (!rateMatched && !cleanNullable(input.overrideReason)) {
    throw new FiringBillingError(
      "RATE_OVERRIDE_REASON_REQUIRED",
      "The final charge does not match the standard firing rate. Add the reason for the override.",
    );
  }
  return { rateMatched, expectedChargeCents: standard.chargeCents };
}

function runtimeFromConfig(config: StripeConfigInput): FiringBillingRuntime {
  return {
    stripeMode: config.mode,
    invoicesEnabled: config.enabledFeatures.invoices,
    firingBillingEnabled: config.firingBilling.enabled,
    liveWritesEnabled: config.firingBilling.liveWritesEnabled,
    daysUntilDue: config.firingBilling.daysUntilDue,
    pickupInstructions: config.firingBilling.pickupInstructions,
    pickupInstructionsVersion: config.firingBilling.pickupInstructionsVersion,
  };
}

function assertBillableRuntime(runtime: FiringBillingRuntime) {
  if (!runtime.invoicesEnabled || !runtime.firingBillingEnabled) {
    throw new FiringBillingError(
      "FIRING_INVOICES_DISABLED",
      "Firing invoices are disabled in Stripe settings.",
      409,
    );
  }
  if (runtime.stripeMode === "live" && !runtime.liveWritesEnabled) {
    throw new FiringBillingError(
      "LIVE_FIRING_WRITES_LOCKED",
      "Live firing charges are locked. Complete test-mode proof before enabling live writes.",
      409,
    );
  }
}

async function assertStripeWebhookWriteReady(runtime: FiringBillingRuntime): Promise<void> {
  try {
    await requireActiveStripeWebhookWriteReadiness(runtime.stripeMode);
  } catch (error) {
    if (error instanceof StripeWebhookAttestationError) {
      throw new FiringBillingError(error.code, error.message, error.httpStatus);
    }
    throw new FiringBillingError(
      "STRIPE_WEBHOOK_VALIDATION_FAILED",
      "Stripe webhook readiness could not be verified. No billing write was attempted.",
      502,
    );
  }
}

function billingMetadata(params: {
  ticketId: string;
  operationId: string;
  ownerUid: string | null;
  rateKey: string | null;
}): Stripe.MetadataParam {
  return {
    source: "firing",
    firing_ticket_id: params.ticketId,
    billing_operation_id: params.operationId,
    firebase_uid: params.ownerUid ?? "",
    rate_key: params.rateKey ?? "manual_override",
  };
}

export function makeOpaquePickupDetailsToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isOpaquePickupDetailsToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function pickupDetailsTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function pickupDetailsActionUrl(token: string): string {
  if (!isOpaquePickupDetailsToken(token)) throw new Error("A valid pickup-details token is required");
  return `${PICKUP_DETAILS_ENDPOINT}/${token}`;
}

function isLowFireTicket(ticket: TicketSnapshot): boolean {
  return ticket.heatId.trim().toLowerCase().startsWith("low") ||
    ticket.heatLabel.trim().toLowerCase().startsWith("low");
}

function serviceFooterText(): string[] {
  return [
    "This is a service message about your current or recently completed Monsoon Fire firing request. It is not a promotional email.",
    `Privacy: ${PRIVACY_URL}`,
    `Terms: ${TERMS_URL}`,
    `Studio Policies: ${POLICIES_URL}`,
    `Accessibility: ${ACCESSIBILITY_URL}`,
    "",
    "Monsoon Fire Pottery Studio",
    STUDIO_POSTAL_ADDRESS,
    SUPPORT_EMAIL,
    `Policy version: ${SERVICE_POLICY_VERSION}`,
    "© 2026 Monsoon Fire Pottery Studio. All rights reserved.",
  ];
}

function serviceFooterHtml(): string {
  return `<tr><td style="padding:20px 28px;border-top:1px solid #d8c9b7;color:#66594f;font:12px/1.55 Arial,sans-serif;">
    <p style="margin:0 0 10px;">This is a service message about your current or recently completed Monsoon Fire firing request. It is not a promotional email.</p>
    <p style="margin:0 0 10px;"><a href="${PRIVACY_URL}" style="color:#8a3f2b;">Privacy</a> · <a href="${TERMS_URL}" style="color:#8a3f2b;">Terms</a> · <a href="${POLICIES_URL}" style="color:#8a3f2b;">Studio Policies</a> · <a href="${ACCESSIBILITY_URL}" style="color:#8a3f2b;">Accessibility</a></p>
    <p style="margin:0;">Monsoon Fire Pottery Studio<br>${STUDIO_POSTAL_ADDRESS}<br><a href="mailto:${SUPPORT_EMAIL}" style="color:#8a3f2b;">${SUPPORT_EMAIL}</a><br>Policy version: ${SERVICE_POLICY_VERSION}<br>© 2026 Monsoon Fire Pottery Studio. All rights reserved.</p>
  </td></tr>`;
}

function makePickupMail(params: {
  ticket: TicketSnapshot;
  input: StaffFinalizeFiringPickupInput;
  runtime: FiringBillingRuntime;
  operationId: string;
  hostedInvoiceUrl: string | null;
  pickupDetailsUrl: string;
}): Record<string, unknown> {
  const { ticket, input, runtime } = params;
  const hero = getFiringEmailInlineAsset("firing_complete");
  const noCharge = input.finalChargeCents === 0;
  const noChargeText = input.outcome === "studio_fault_no_charge"
    ? "There is no charge for this firing."
    : "There is no additional charge for this ticket.";
  const amount = formatMoney(input.finalChargeCents);
  const publicNote = cleanNullable(input.artistVisibleFiringNote);
  const paymentText = noCharge
    ? noChargeText
    : `The final firing charge is ${amount}. Pay securely with Stripe before or around pickup: ${params.hostedInvoiceUrl}`;
  const paymentHtml = noCharge
    ? `<p style="margin:0;color:#35512d;font:700 18px/1.4 Georgia,serif;">${noChargeText}</p>`
    : `<p style="margin:0 0 14px;color:#271d17;font:700 18px/1.4 Georgia,serif;">Final firing charge: ${escapeHtml(amount)}</p>
       <a href="${escapeHtml(params.hostedInvoiceUrl ?? "")}" style="display:inline-block;padding:12px 18px;background:#95472f;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">Pay securely with Stripe</a>`;
  const noteText = publicNote ? `\nFiring note from the studio:\n${publicNote}\n` : "";
  const noteHtml = publicNote
    ? `<div style="margin:18px 0;padding:14px 16px;border-left:4px solid #c45f3b;background:#fffaf4;"><strong>Firing note</strong><br>${htmlWithBreaks(publicNote)}</div>`
    : "";
  const lowFireNoteText = isLowFireTicket(ticket)
    ? "Low-fired work can still be fragile. A little padding on the way home goes a long way."
    : "";
  const lowFireNoteHtml = lowFireNoteText
    ? `<div style="margin:18px 0;padding:16px 18px;border:1px solid #dfd0bd;background:#fffaf4;"><p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">For low-fired work</p><p style="margin:0;color:#271d17;font:14px/1.55 Arial,sans-serif;">${lowFireNoteText}</p></div>`
    : "";
  const subject = `Your firing is ready — ${ticket.ticketId}`;
  const text = [
    `Hi ${ticket.displayName || "there"},`,
    "",
    `Your firing is finished and ticket ${ticket.ticketId} is ready for pickup.`,
    paymentText,
    noteText,
    "Pickup details",
    runtime.pickupInstructions,
    "",
    "Need payment or pickup details later?",
    `Open your private pickup page: ${params.pickupDetailsUrl}`,
    "",
    "A small kiln note",
    "Firing always has a little uncertainty in it—clay, glaze, and heat can surprise everyone. If we find a studio-caused problem, we’ll make it right on the firing charge. Otherwise, the finished firing remains the service you paid for. If something looks off, reply and we’ll take a look with you.",
    ...(lowFireNoteText ? ["", "For low-fired work", lowFireNoteText] : []),
    "",
    `Ticket: ${ticket.ticketId}`,
    "Questions? Reply to this email.",
    "",
    ...serviceFooterText(),
  ].join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#15110e;color:#271d17;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-collapse:collapse;background:#f8f0e5;">
        <tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;">
          <p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p>
          <h1 style="margin:0;color:#f5ede2;font:600 28px/1.15 Georgia,serif;">Your firing is ready</h1>
        </td></tr>
        <tr><td><img src="cid:${hero.cid}" width="680" alt="Firing complete. Your work is ready; pickup details are in this message from Monsoon Fire." style="display:block;width:100%;max-width:680px;height:auto;border:0;"></td></tr>
        <tr><td style="padding:26px 28px;">
          <p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(ticket.displayName || "there")}, your firing is finished and ticket <strong>${escapeHtml(ticket.ticketId)}</strong> is ready for pickup.</p>
          <div style="margin:0 0 18px;padding:18px;background:#efe2cf;border:1px solid #dfd0bd;">${paymentHtml}</div>
          ${noteHtml}
          <div style="margin:18px 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;">
            <p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Pickup details</p>
            <p style="margin:0;color:#271d17;font:15px/1.55 Georgia,serif;">${htmlWithBreaks(runtime.pickupInstructions)}</p>
            <p style="margin:16px 0 0;"><a href="${escapeHtml(params.pickupDetailsUrl)}" style="display:inline-block;padding:12px 18px;background:#4f5e32;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">View payment &amp; pickup details</a></p>
            <p style="margin:10px 0 0;color:#695a4e;font:13px/1.5 Arial,sans-serif;">This private page keeps your current pickup details and Stripe payment link together, and can email the directions again if needed.</p>
          </div>
          <div style="margin:18px 0;padding:16px 18px;background:#fff4df;border:1px solid #dfc18e;">
            <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">A small kiln note</p>
            <p style="margin:0;color:#271d17;font:14px/1.55 Arial,sans-serif;">Firing always has a little uncertainty in it—clay, glaze, and heat can surprise everyone. If we find a studio-caused problem, we’ll make it right on the firing charge. Otherwise, the finished firing remains the service you paid for. If something looks off, reply and we’ll take a look with you.</p>
          </div>
          ${lowFireNoteHtml}
          <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(ticket.ticketId)}<br>Questions? Reply to this email.</p>
        </td></tr>
        ${serviceFooterHtml()}
      </table>
    </td></tr>
  </table>
</body></html>`;
  return {
    to: ticket.email,
    replyTo: SUPPORT_EMAIL,
    message: { subject, text, html, attachments: [hero] },
    source: "firing-pickup-ready",
    ticketId: ticket.ticketId,
    billingOperationId: params.operationId,
    createdAt: nowTs(),
  };
}

function makePickupDirectionsMail(params: {
  ticketId: string;
  displayName: string;
  email: string;
  runtime: FiringBillingRuntime;
  requestedAt: ReturnType<typeof nowTs>;
}): Record<string, unknown> {
  const text = [
    `Hi ${params.displayName || "there"},`,
    "",
    "Here are the current pickup details for your fired work.",
    "",
    "Pickup details",
    params.runtime.pickupInstructions,
    "",
    `Ticket: ${params.ticketId}`,
    "Questions or accessibility needs? Reply to this email or contact support@monsoonfire.com.",
    "",
    ...serviceFooterText(),
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#15110e;color:#271d17;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-collapse:collapse;background:#f8f0e5;"><tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;"><p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p><h1 style="margin:0;color:#f5ede2;font:600 28px/1.15 Georgia,serif;">Your pickup details</h1></td></tr><tr><td style="padding:26px 28px;"><p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(params.displayName || "there")},</p><p style="margin:0 0 18px;color:#271d17;font:16px/1.55 Georgia,serif;">Here are the current pickup details for your fired work.</p><div style="margin:18px 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;"><p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Pickup details</p><p style="margin:0;color:#271d17;font:15px/1.55 Georgia,serif;">${htmlWithBreaks(params.runtime.pickupInstructions)}</p></div><p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(params.ticketId)}<br>Questions or accessibility needs? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#8a3f2b;">${SUPPORT_EMAIL}</a>.</p></td></tr>${serviceFooterHtml()}</table></td></tr></table></body></html>`;
  return {
    to: params.email,
    replyTo: SUPPORT_EMAIL,
    message: { subject: `Your pickup details — ${params.ticketId}`, text, html },
    source: "firing-pickup-directions-resend",
    ticketId: params.ticketId,
    pickupInstructionsVersion: params.runtime.pickupInstructionsVersion,
    requestedAt: params.requestedAt,
    createdAt: params.requestedAt,
  };
}

function makePaidReceiptMail(params: {
  ticketId: string;
  displayName: string;
  email: string;
  amountCents: number;
  hostedInvoiceUrl: string;
  requestedAt: ReturnType<typeof nowTs>;
}): Record<string, unknown> {
  const amount = formatMoney(params.amountCents);
  const text = [
    `Hi ${params.displayName || "there"},`,
    "",
    `Your ${amount} firing payment for ticket ${params.ticketId} is complete.`,
    "Stripe keeps the current paid invoice and any later refund details together here:",
    params.hostedInvoiceUrl,
    "",
    "Questions? Reply to this email.",
    "",
    ...serviceFooterText(),
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#15110e;color:#271d17;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-collapse:collapse;background:#f8f0e5;"><tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;"><p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p><h1 style="margin:0;color:#f5ede2;font:600 28px/1.15 Georgia,serif;">Your firing payment is complete</h1></td></tr><tr><td style="padding:26px 28px;"><p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(params.displayName || "there")}, your <strong>${escapeHtml(amount)}</strong> firing payment for ticket <strong>${escapeHtml(params.ticketId)}</strong> is complete.</p><p style="margin:0 0 18px;color:#271d17;font:15px/1.55 Georgia,serif;">Stripe keeps the current paid invoice and any later refund details together in one place.</p><p style="margin:18px 0;"><a href="${escapeHtml(params.hostedInvoiceUrl)}" style="display:inline-block;padding:12px 18px;background:#95472f;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">Open paid invoice</a></p><p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(params.ticketId)}<br>Questions? Reply to this email.</p></td></tr>${serviceFooterHtml()}</table></td></tr></table></body></html>`;
  return {
    to: params.email,
    replyTo: SUPPORT_EMAIL,
    message: { subject: `Your firing payment receipt — ${params.ticketId}`, text, html },
    source: "firing-paid-receipt-resend",
    ticketId: params.ticketId,
    requestedAt: params.requestedAt,
    createdAt: params.requestedAt,
  };
}

function makeFiringInvoiceMail(params: {
  ticketId: string;
  displayName: string;
  email: string;
  amountCents: number;
  hostedInvoiceUrl: string;
  paid: boolean;
  requestedAt: ReturnType<typeof nowTs>;
}): Record<string, unknown> {
  const amount = formatMoney(params.amountCents);
  const subject = params.paid
    ? `Your firing invoice — ${params.ticketId}`
    : `Your Monsoon Fire firing invoice — ${params.ticketId}`;
  const intro = params.paid
    ? `Your ${amount} firing payment for ticket ${params.ticketId} is complete. You can open the invoice and receipt here:`
    : `Your final ${amount} firing invoice for ticket ${params.ticketId} is ready. Open it here to review and pay securely:`;
  const button = params.paid ? "Open paid invoice" : "Open firing invoice";
  const text = [
    `Hi ${params.displayName || "there"},`,
    "",
    intro,
    params.hostedInvoiceUrl,
    "",
    "Questions? Reply to this email.",
    "",
    ...serviceFooterText(),
  ].join("\\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#15110e;color:#271d17;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-collapse:collapse;background:#f8f0e5;"><tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;"><p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p><h1 style="margin:0;color:#f5ede2;font:600 28px/1.15 Georgia,serif;">${params.paid ? "Your firing payment is complete" : "Your firing invoice is ready"}</h1></td></tr><tr><td style="padding:26px 28px;"><p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(params.displayName || "there")},</p><p style="margin:0 0 18px;color:#271d17;font:16px/1.55 Georgia,serif;">${escapeHtml(intro)}</p><p style="margin:18px 0;"><a href="${escapeHtml(params.hostedInvoiceUrl)}" style="display:inline-block;padding:12px 18px;background:#95472f;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">${button}</a></p><p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(params.ticketId)}<br>Questions? Reply to this email.</p></td></tr>${serviceFooterHtml()}</table></td></tr></table></body></html>`;
  return {
    to: params.email,
    replyTo: SUPPORT_EMAIL,
    message: { subject, text, html },
    source: "firing-invoice-resend",
    ticketId: params.ticketId,
    requestedAt: params.requestedAt,
    createdAt: params.requestedAt,
  };
}

function setPublicPickupDetailsHeaders(res: ResponseLike): void {
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function pickupDetailsTokenFromPath(path: string | undefined): string | null {
  const parts = (path ?? "").split("/").filter(Boolean);
  return parts.length === 2 && parts[0] === "v1" && isOpaquePickupDetailsToken(parts[1]) ? parts[1] : null;
}

function safeStripeHostedUrl(value: unknown): string | null {
  const candidate = cleanNullable(safeString(value));
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "stripe.com" || host.endsWith(".stripe.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function pickupDetailsHandoffHtml(params: {
  token: string;
  ticketId: string;
  billingStatus: string;
  finalChargeCents: number;
  hostedInvoiceUrl: string | null;
  pickupInstructions: string;
  isLowFire: boolean;
}): string {
  const action = escapeHtml(pickupDetailsActionUrl(params.token));
  const amount = Math.max(params.finalChargeCents, 0);
  const invoiceUrl = safeStripeHostedUrl(params.hostedInvoiceUrl);
  const billingStatus = params.billingStatus.trim();
  const payment = billingStatus === "no_charge"
    ? `<p style="margin:0;color:#35512d;font:700 17px/1.45 Georgia,serif;">There is no charge for this firing.</p>`
    : billingStatus === "paid"
      ? `<p style="margin:0 0 10px;color:#35512d;font:700 17px/1.45 Georgia,serif;">Payment received${amount ? ` · ${escapeHtml(formatMoney(amount))}` : ""}</p>${invoiceUrl ? `<a href="${escapeHtml(invoiceUrl)}" style="color:#8a3f2b;font:700 14px Arial,sans-serif;">View your Stripe receipt</a>` : ""}`
      : (billingStatus === "invoice_open" || billingStatus === "payment_failed") && invoiceUrl
        ? `<p style="margin:0 0 12px;color:#271d17;font:700 17px/1.45 Georgia,serif;">Final firing charge: ${escapeHtml(formatMoney(amount))}</p><a href="${escapeHtml(invoiceUrl)}" style="display:inline-block;padding:12px 18px;background:#95472f;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">Pay securely with Stripe</a>`
        : `<p style="margin:0;color:#271d17;font:16px/1.5 Georgia,serif;">The studio is finishing the final details. There is nothing you need to do right now.</p>`;
  const lowFireNote = params.isLowFire ? " · Low-fired work can still be fragile, so a little padding on the way home helps." : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your firing is ready | Monsoon Fire</title></head><body style="margin:0;padding:24px 12px;background:#15110e;color:#271d17;font:16px/1.55 Georgia,serif;"><main style="max-width:620px;margin:24px auto;background:#f8f0e5;border-top:5px solid #c45f3b;"><header style="padding:24px 28px 20px;background:#211a16;color:#f5ede2;"><p style="margin:0 0 8px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;">Monsoon Fire · Firing care</p><h1 style="margin:0;font:600 30px/1.15 Georgia,serif;">Your firing is ready</h1></header><section style="padding:26px 28px;"><p style="margin:0 0 18px;">Everything you need for pickup is here. No account or app is needed.</p><div style="margin:18px 0;padding:18px;background:#efe2cf;border:1px solid #dfd0bd;"><p style="margin:0 0 8px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Payment</p>${payment}</div><div style="margin:18px 0;padding:18px;background:#e8eadb;border:1px solid #c6cdaa;"><p style="margin:0 0 8px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Pickup</p><p style="margin:0;">${htmlWithBreaks(params.pickupInstructions)}</p><p style="margin:16px 0 0;color:#695a4e;font:13px/1.5 Arial,sans-serif;">Need a fresh copy in your inbox? We can send the current directions again.</p><form method="post" action="${action}" style="margin-top:12px;"><button type="submit" style="padding:12px 18px;border:0;background:#4f5e32;color:#fff;font:700 15px Arial,sans-serif;cursor:pointer;">Email me these pickup details</button></form></div><div style="margin:18px 0;padding:16px 18px;background:#fffaf4;border:1px solid #dfd0bd;"><p style="margin:0 0 6px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Need a hand?</p><p style="margin:0;">Reply to the ready email or <a href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Pickup help — ${params.ticketId}`)}" style="color:#8a3f2b;">email the studio</a>. We’ll help sort it out.</p></div><p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Firing ticket ${escapeHtml(params.ticketId)}${lowFireNote}</p></section></main></body></html>`;
}

function pickupDetailsResultHtml(sent: boolean): string {
  const heading = sent ? "Pickup details are on their way." : "We couldn’t send those pickup details.";
  const body = sent
    ? "Check the email used for this firing in a few minutes. If it does not arrive, reply to your ready email and we’ll help."
    : "This link may have expired, or the work may no longer be awaiting pickup. Reply to your ready email and we’ll help.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monsoon Fire pickup details</title></head><body style="margin:0;background:#15110e;color:#271d17;font:16px/1.55 Georgia,serif;"><main style="max-width:620px;margin:48px auto;padding:28px;background:#f8f0e5;border-top:5px solid #c45f3b;"><p style="margin:0 0 8px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Monsoon Fire</p><h1 style="margin:0 0 16px;font:600 30px/1.15 Georgia,serif;">${heading}</h1><p>${body}</p><p><a href="mailto:${SUPPORT_EMAIL}" style="color:#8a3f2b;">Email support</a></p></main></body></html>`;
}

async function quoteFiringLedger(
  transaction: FirebaseFirestore.Transaction,
  ticket: Record<string, unknown>,
  input: Pick<StaffFinalizeFiringPickupInput, "actualSpace" | "privateFulfilled" | "rushFulfilled">,
  operationId: string,
) {
  const firingId = safeString(ticket.firingId).trim();
  const ownerUid = safeString(ticket.ownerUid).trim();
  if (!ownerUid || !firingId || firingId.includes("/")) {
    throw new FiringBillingError("FIRING_AGGREGATION_IDENTITY_REQUIRED", "Link this ticket to a client account and the recorded kiln firing before billing.", 409);
  }
  const heatId = readTicketHeat(ticket).id;
  if ((heatId !== "low" && heatId !== "mid" && heatId !== "high") || input.actualSpace.billingUnit === "custom") {
    throw new FiringBillingError("FIRING_RANGE_REQUIRED", "Confirm the standard firing range and billing unit before calculating the remaining charge.", 409);
  }
  const requests = asRecord(ticket.addOnRequests);
  if ((input.privateFulfilled && requests.private !== true) || (input.rushFulfilled && requests.rush !== true)) {
    throw new FiringBillingError("ADD_ON_NOT_REQUESTED", "Only requested add-ons can be marked fulfilled.");
  }
  const ref = db.collection("firingPricingLedgers").doc(sha256(JSON.stringify([firingId, ownerUid])));
  const [snapshot, firing] = await Promise.all([
    transaction.get(ref),
    transaction.get(db.collection("kilnFirings").doc(firingId)),
  ]);
  if (!firing.exists || !firing.data()?.unloadedAt) {
    throw new FiringBillingError("FIRING_NOT_UNLOADED", "Link the ticket to a recorded, unloaded kiln firing before billing.", 409);
  }
  const recordedRange = safeString(firing.data()?.firingRange).trim();
  if (recordedRange && recordedRange !== heatId) {
    throw new FiringBillingError("FIRING_RANGE_CONFLICT", "The ticket range differs from the recorded kiln firing.", 409);
  }
  const previous = snapshot.exists ? snapshot.data() as FiringPricingLedger : null;
  if (previous && previous.heatId !== heatId) {
    throw new FiringBillingError("FIRING_RANGE_CONFLICT", "The firing range differs from the customer's other tickets in this firing.", 409);
  }
  const next = addFiringLedgerEntry(previous, {
    operationId, heatId, billingUnit: input.actualSpace.billingUnit, quantity: input.actualSpace.quantity,
    privateFulfilled: input.privateFulfilled === true, rushFulfilled: input.rushFulfilled === true,
  });
  return {
    ref, ledger: next.ledger, firingId, priorCents: previous?.totalCents ?? 0,
    rate: { rateKey: `${heatId}_shared_v3`, chargeCents: next.chargeCents },
    billedAddOns: {
      private: next.ledger.privateFulfilled && !previous?.privateFulfilled,
      rush: next.ledger.rushFulfilled && !previous?.rushFulfilled,
    },
  };
}

async function reserveFinalization(
  input: StaffFinalizeFiringPickupInput,
  actor: StaffActor,
  runtime: FiringBillingRuntime,
): Promise<ReservedFinalization> {
  const operationId = makeIdempotencyId("firing-billing", input.ticketId, input.clientRequestId);
  const commandHash = stableCommandHash(input);
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId);
  return db.runTransaction(async (transaction) => {
    const [ticketSnap, operationSnap] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(operationRef),
    ]);
    if (!ticketSnap.exists) {
      throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
    }
    const ticketData = asRecord(ticketSnap.data());
    const heat = readTicketHeat(ticketData);
    const ticket: TicketSnapshot = {
      ticketId: input.ticketId,
      displayName: input.artistContact?.displayName ?? safeString(ticketData.displayName).trim(),
      email: normalizeEmail(input.artistContact?.email ?? ticketData.email),
      heatId: heat.id,
      heatLabel: heat.label,
      estimatedSpace: cleanNullable(safeString(ticketData.estimatedSpace)),
      status: safeString(ticketData.status).trim() || "expected_dropoff",
      billingStatus: safeString(ticketData.billingStatus).trim() || "unbilled",
      billingVersion: Math.max(asInt(ticketData.billingVersion, 0), 0),
      ownerUid: cleanNullable(safeString(ticketData.ownerUid)),
    };
    if (operationSnap.exists) {
      const operation = asRecord(operationSnap.data());
      if (safeString(operation.commandHash) !== commandHash) {
        throw new FiringBillingError(
          "IDEMPOTENCY_CONFLICT",
          "This request ID was already used for a different billing decision.",
          409,
        );
      }
      const operationStatus = safeString(operation.status);
      if (operationStatus !== "completed") {
        if (isBillingOperationLeaseActive({
          status: operationStatus,
          updatedAtMs: toMillis(operation.updatedAt),
        })) {
          throw new FiringBillingError(
            "BILLING_OPERATION_IN_PROGRESS",
            "This firing billing request is still processing. Refresh in a moment before retrying.",
            409,
          );
        }
        const resumedAt = nowTs();
        transaction.set(operationRef, {
          status: "in_progress",
          resumedAt,
          updatedAt: resumedAt,
          resumeCount: FieldValue.increment(1),
        }, { merge: true });
      }
      return {
        operationId,
        duplicate: true,
        completed: operationStatus === "completed",
        ticket,
        stripeMode: safeString(operation.stripeMode) === "live" ? "live" :
          safeString(operation.stripeMode) === "test" ? "test" : null,
        stripeCustomerId: cleanNullable(safeString(operation.stripeCustomerId)),
        stripeInvoiceId: cleanNullable(safeString(operation.stripeInvoiceId)),
        stripeInvoiceItemId: cleanNullable(safeString(operation.stripeInvoiceItemId)),
        hostedInvoiceUrl: cleanNullable(safeString(operation.hostedInvoiceUrl)),
        resultBillingStatus: cleanNullable(safeString(operation.result)),
        billedAddOns: operation.billedAddOns as ReservedFinalization["billedAddOns"],
      };
    }
    const activeOperationId = cleanNullable(safeString(ticketData.billingOperationId));
    if (
      activeOperationId &&
      activeOperationId !== operationId &&
      ["billing_preparing", "reconciliation_required"].includes(ticket.billingStatus)
    ) {
      throw new FiringBillingError(
        "BILLING_OPERATION_REQUIRES_RESUME",
        "This ticket already has a billing operation that must be resumed or reconciled.",
        409,
      );
    }
    if (ticket.billingVersion !== input.expectedVersion) {
      throw new FiringBillingError(
        "TICKET_VERSION_CONFLICT",
        "This ticket changed after you opened it. Refresh before finalizing.",
        409,
      );
    }
    const allowedStatuses = new Set(["awaiting_pickup_review"]);
    if (!allowedStatuses.has(ticket.status)) {
      throw new FiringBillingError(
        "TICKET_NOT_READY_FOR_REVIEW",
        "This ticket is not in a state that can be finalized for pickup.",
        409,
      );
    }
    const terminalBillingStatuses = new Set([
      "invoice_open",
      "paid",
      "no_charge",
      "partially_refunded",
      "refunded",
      "void",
    ]);
    if (terminalBillingStatuses.has(ticket.billingStatus) || cleanNullable(safeString(ticketData.stripeInvoiceId))) {
      throw new FiringBillingError(
        "TICKET_ALREADY_FINALIZED",
        "This ticket already has a final billing result.",
        409,
      );
    }
    if (input.outcome !== "hold_for_review" && !ticket.email) {
      throw new FiringBillingError(
        "ARTIST_EMAIL_REQUIRED",
        "Add an artist email before marking this firing ready.",
        409,
      );
    }
    let aggregateRate: { rateKey: string; chargeCents: number } | undefined;
    let billedAddOns: ReservedFinalization["billedAddOns"];
    if (ticketData.pricingVersion === 3 && billableOutcomeSchema.safeParse(input.outcome).success &&
        ticket.heatId !== "custom" && input.actualSpace.billingUnit !== "custom") {
      const quote = await quoteFiringLedger(transaction, ticketData, input, operationId);
      aggregateRate = quote.rate;
      billedAddOns = quote.billedAddOns;
      transaction.set(quote.ref, quote.ledger);
    }
    const rateValidation = validateChargeForTicket(input, ticket.heatId, ticketData, aggregateRate);
    const stripeMode = billableOutcomeSchema.safeParse(input.outcome).success && input.finalChargeCents > 0 ? runtime.stripeMode : null;
    const reservedAt = nowTs();
    const nextBillingStatus = input.outcome === "hold_for_review" ? "hold_for_review" : "billing_preparing";
    transaction.create(operationRef, {
      operationId,
      operationType: "pickup_finalization",
      ticketId: input.ticketId,
      ticketVersion: ticket.billingVersion,
      commandHash,
      command: input,
      status: "in_progress",
      stripeMode,
      ...(billedAddOns ? { billedAddOns } : {}),
      rateMatched: rateValidation.rateMatched,
      expectedChargeCents: rateValidation.expectedChargeCents,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorMode: actor.mode,
      createdAt: reservedAt,
      updatedAt: reservedAt,
      steps: {
        reserve: { status: "succeeded", at: reservedAt },
      },
    });
    transaction.set(ticketRef, {
      status: input.outcome === "hold_for_review" ? "awaiting_pickup_review" : ticket.status,
      billingStatus: nextBillingStatus,
      billingVersion: ticket.billingVersion + 1,
      billingOperationId: operationId,
      billingDecision: input.outcome,
      actualSpace: input.actualSpace,
      rateKey: input.rateKey,
      finalChargeCents: input.finalChargeCents,
      addOnsFulfilled: { private: input.privateFulfilled === true, rush: input.rushFulfilled === true },
      ...(input.customBaseChargeCents != null ? { customBaseChargeCents: input.customBaseChargeCents } : {}),
      currency: input.currency,
      artistVisibleFiringNote: cleanNullable(input.artistVisibleFiringNote),
      privateStaffNote: cleanNullable(input.privateStaffNote),
      ...(input.artistContact ? {
        displayName: input.artistContact.displayName,
        email: normalizeEmail(input.artistContact.email),
      } : {}),
      billingFinalizedByUid: actor.uid,
      updatedAt: reservedAt,
    }, { merge: true });
    transaction.create(ticketRef.collection("events").doc(`${operationId}-reserved`), {
      type: "pickup_billing_reserved",
      operationId,
      outcome: input.outcome,
      actorUid: actor.uid,
      at: reservedAt,
    });
    return {
      operationId,
      duplicate: false,
      completed: false,
      ticket,
      stripeMode,
      billedAddOns,
      stripeCustomerId: null,
      stripeInvoiceId: null,
      stripeInvoiceItemId: null,
      hostedInvoiceUrl: null,
      resultBillingStatus: null,
    };
  });
}

async function validateCustomerEmail(stripe: Stripe, customerId: string, expectedEmail: string): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId);
  if ((customer as Stripe.DeletedCustomer).deleted === true) {
    throw new FiringBillingError("STRIPE_CUSTOMER_DELETED", "The linked Stripe customer was deleted.", 409);
  }
  const actualEmail = normalizeEmail((customer as Stripe.Customer).email);
  if (actualEmail !== expectedEmail) {
    throw new FiringBillingError(
      "STRIPE_CUSTOMER_EMAIL_MISMATCH",
      "The linked Stripe customer email does not match this ticket.",
      409,
    );
  }
}

type FiringCustomerSubject = {
  type: "firebase_uid" | "firing_ticket";
  stableId: string;
  hash: string;
  linkId: string;
  ownerUid: string | null;
  ticketId: string | null;
};

export function deriveFiringCustomerSubject(input: {
  ownerUid: string | null;
  ticketId: string;
}): FiringCustomerSubject {
  const ownerUid = cleanNullable(input.ownerUid);
  const type = ownerUid ? "firebase_uid" : "firing_ticket";
  const stableId = ownerUid ?? input.ticketId;
  const hash = sha256(`${type}:${stableId}`);
  return {
    type,
    stableId,
    hash,
    linkId: `${type}_${hash}`,
    ownerUid,
    ticketId: ownerUid ? null : input.ticketId,
  };
}

export function trustedImportedStripeCustomerId(input: {
  billingAccount: Record<string, unknown>;
  legacyUser: Record<string, unknown>;
  migrationRun: Record<string, unknown>;
}): string | null {
  const billing = input.billingAccount;
  const legacy = input.legacyUser;
  const run = input.migrationRun;
  const customerId = cleanNullable(safeString(billing.stripeCustomerId));
  if (!customerId) return null;

  const evidence = asRecord(billing.linkEvidence);
  const valid =
    safeString(billing.linkStatus) === "linked" &&
    safeString(evidence.type) === "customer_id_email_and_kilnfire_metadata" &&
    safeString(legacy.stripeCustomerId) === customerId &&
    safeString(legacy.stripeLinkEvidence) === "customer_id_email_and_kilnfire_metadata" &&
    safeString(evidence.sourceRowFingerprint) !== "" &&
    safeString(evidence.sourceRowFingerprint) === safeString(legacy.sourceRowFingerprint) &&
    safeString(billing.sourceRunId) !== "" &&
    safeString(billing.sourceRunId) === safeString(legacy.sourceRunId) &&
    safeString(billing.legacyKilnfireUserId) !== "" &&
    safeString(billing.legacyKilnfireUserId) === safeString(legacy.legacyKilnfireUserId) &&
    safeString(run.kind) === "kilnfire_user_import" &&
    safeString(run.mode) === "live" &&
    safeString(run.status) === "complete";
  if (!valid) {
    throw new FiringBillingError(
      "IMPORTED_STRIPE_IDENTITY_INVALID",
      "This imported Stripe customer link failed its migration evidence check.",
      409,
    );
  }
  return customerId;
}

function assertRuntimeCustomerLink(
  link: Record<string, unknown>,
  subject: FiringCustomerSubject,
): void {
  const valid =
    link.schemaVersion === 2 &&
    safeString(link.subjectType) === subject.type &&
    safeString(link.subjectHash) === subject.hash &&
    cleanNullable(safeString(link.ownerUid)) === subject.ownerUid &&
    cleanNullable(safeString(link.ticketId)) === subject.ticketId &&
    safeString(link.source) === "firing_runtime_created";
  if (!valid) {
    throw new FiringBillingError(
      "FIRING_CUSTOMER_LINK_MISMATCH",
      "The stored firing customer identity does not match this ticket.",
      409,
    );
  }
}

async function validateRuntimeCustomer(
  stripe: Stripe,
  customerId: string,
  expectedEmail: string,
  subject: FiringCustomerSubject,
): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId);
  if ((customer as Stripe.DeletedCustomer).deleted === true) {
    throw new FiringBillingError("STRIPE_CUSTOMER_DELETED", "The linked Stripe customer was deleted.", 409);
  }
  const active = customer as Stripe.Customer;
  const metadata = active.metadata ?? {};
  const subjectField = subject.type === "firebase_uid" ? "firebase_uid" : "firing_ticket_id";
  if (
    normalizeEmail(active.email) !== expectedEmail ||
    metadata.source !== "firing" ||
    metadata.identity_subject_hash !== subject.hash ||
    metadata[subjectField] !== subject.stableId
  ) {
    throw new FiringBillingError(
      "FIRING_CUSTOMER_LINK_MISMATCH",
      "The linked Stripe customer does not match this firing identity.",
      409,
    );
  }
}

async function resolveStripeCustomer(
  reserved: ReservedFinalization,
  _input: StaffFinalizeFiringPickupInput,
  runtime: FiringBillingRuntime,
): Promise<StripeCustomerResolution> {
  const stripe = getStripeClient(runtime.stripeMode);
  const email = reserved.ticket.email;
  const ownerUid = reserved.ticket.ownerUid;
  const subject = deriveFiringCustomerSubject({
    ownerUid,
    ticketId: reserved.ticket.ticketId,
  });

  if (runtime.stripeMode === "live" && ownerUid) {
    const [billingSnap, legacySnap] = await Promise.all([
      db.collection("billingAccounts").doc(ownerUid).get(),
      db.collection("legacyUserRecords").doc(ownerUid).get(),
    ]);
    const billing = asRecord(billingSnap.data());
    const importedCustomerId = cleanNullable(safeString(billing.stripeCustomerId));
    if (importedCustomerId) {
      const runId = cleanNullable(safeString(billing.sourceRunId));
      const runSnap = runId
        ? await db.collection("migrationRuns").doc(runId).get()
        : null;
      const trustedCustomerId = trustedImportedStripeCustomerId({
        billingAccount: billing,
        legacyUser: asRecord(legacySnap.data()),
        migrationRun: asRecord(runSnap?.data()),
      });
      if (!trustedCustomerId) {
        throw new FiringBillingError(
          "IMPORTED_STRIPE_IDENTITY_INVALID",
          "The imported billing account is missing its Stripe customer.",
          409,
        );
      }
      await validateCustomerEmail(stripe, trustedCustomerId, email);
      return { customerId: trustedCustomerId, ownerUid };
    }
    if (
      billingSnap.exists &&
      (
        safeString(billing.linkStatus) !== "unlinked" ||
        safeString(asRecord(billing.linkEvidence).type) !== "none"
      )
    ) {
      throw new FiringBillingError(
        "IMPORTED_STRIPE_IDENTITY_INVALID",
        "The imported billing account has contradictory Stripe linkage evidence.",
        409,
      );
    }
  }

  const linkRef = db.collection(CUSTOMER_LINKS_COLLECTION).doc(subject.linkId);
  const linkSnap = await linkRef.get();
  const linkData = asRecord(linkSnap.data());
  if (linkSnap.exists) assertRuntimeCustomerLink(linkData, subject);
  const linkedByMode = asRecord(linkData.stripeCustomerIds);
  const cachedCustomerId = cleanNullable(safeString(linkedByMode[runtime.stripeMode]));
  if (cachedCustomerId) {
    await validateRuntimeCustomer(stripe, cachedCustomerId, email, subject);
    return { customerId: cachedCustomerId, ownerUid };
  }

  const created = await stripe.customers.create({
    email,
    name: reserved.ticket.displayName || undefined,
    metadata: {
      source: "firing",
      identity_subject_hash: subject.hash,
      identity_subject_type: subject.type,
      ...(subject.type === "firebase_uid"
        ? { firebase_uid: subject.stableId }
        : { firing_ticket_id: subject.stableId }),
    },
  }, { idempotencyKey: `firing-customer:${runtime.stripeMode}:${subject.hash}:v2` });
  const customerId = created.id;

  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(linkRef);
    const latest = asRecord(latestSnap.data());
    if (latestSnap.exists) assertRuntimeCustomerLink(latest, subject);
    const currentIds = asRecord(latest.stripeCustomerIds);
    const existingCustomerId = cleanNullable(safeString(currentIds[runtime.stripeMode]));
    if (existingCustomerId && existingCustomerId !== customerId) {
      throw new FiringBillingError(
        "FIRING_CUSTOMER_LINK_CONFLICT",
        "Another Stripe customer is already linked to this firing identity.",
        409,
      );
    }
    const now = nowTs();
    transaction.set(linkRef, {
      schemaVersion: 2,
      subjectType: subject.type,
      subjectHash: subject.hash,
      ownerUid: subject.ownerUid,
      ticketId: subject.ticketId,
      contactEmailHash: sha256(email),
      source: "firing_runtime_created",
      stripeCustomerIds: {
        ...currentIds,
        [runtime.stripeMode]: customerId,
      },
      updatedAt: now,
      createdAt: latestSnap.exists ? latest.createdAt ?? now : now,
    }, { merge: true });
  });
  return { customerId, ownerUid };
}

async function createDraftFiringInvoice(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  runtime: FiringBillingRuntime,
  customer: StripeCustomerResolution,
): Promise<InvoiceStepResult> {
  const stripe = getStripeClient(runtime.stripeMode);
  const copy = firingInvoiceCopy({ ticketId: input.ticketId, heatLabel: reserved.ticket.heatLabel, actualSpace: input.actualSpace });
  const metadata = billingMetadata({
    ticketId: input.ticketId,
    operationId: reserved.operationId,
    ownerUid: customer.ownerUid,
    rateKey: input.rateKey,
  });
  const invoice = await stripe.invoices.create({
    customer: customer.customerId,
    currency: "usd",
    collection_method: "send_invoice",
    days_until_due: runtime.daysUntilDue,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    automatic_tax: { enabled: false },
    default_tax_rates: [],
    discounts: [],
    description: copy.description,
    custom_fields: [copy.customField],
    footer: copy.footer,
    payment_settings: { payment_method_types: ["card", "link"] },
    metadata,
  }, { idempotencyKey: `firing-ticket:${input.ticketId}:invoice:${reserved.operationId}` });
  return { id: invoice.id };
}

async function createFiringInvoiceItem(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  runtime: FiringBillingRuntime,
  customer: StripeCustomerResolution,
  invoiceId: string,
): Promise<InvoiceStepResult> {
  const stripe = getStripeClient(runtime.stripeMode);
  const metadata = billingMetadata({
    ticketId: input.ticketId,
    operationId: reserved.operationId,
    ownerUid: customer.ownerUid,
    rateKey: input.rateKey,
  });
  const item = await stripe.invoiceItems.create({
    customer: customer.customerId,
    invoice: invoiceId,
    amount: input.finalChargeCents,
    currency: "usd",
    description: firingInvoiceLineDescription({ ticketId: input.ticketId, heatLabel: reserved.ticket.heatLabel,
      actualSpace: input.actualSpace, privateFulfilled: reserved.billedAddOns?.private ?? input.privateFulfilled,
      rushFulfilled: reserved.billedAddOns?.rush ?? input.rushFulfilled }),
    discountable: false,
    tax_rates: [],
    metadata,
  }, { idempotencyKey: `firing-ticket:${input.ticketId}:line:${reserved.operationId}` });
  return { id: item.id };
}

async function finalizeFiringInvoice(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  runtime: FiringBillingRuntime,
  invoiceId: string,
): Promise<FinalizedInvoiceResult> {
  const stripe = getStripeClient(runtime.stripeMode);
  const invoice = await stripe.invoices.finalizeInvoice(
    invoiceId,
    { auto_advance: false },
    { idempotencyKey: `firing-ticket:${input.ticketId}:finalize:${reserved.operationId}` },
  );
  const hostedInvoiceUrl = safeString(invoice.hosted_invoice_url).trim();
  if (!hostedInvoiceUrl || invoice.automatic_tax?.enabled === true || invoice.amount_due !== input.finalChargeCents) {
    throw new FiringBillingError(
      "INVOICE_FINALIZATION_MISMATCH",
      "Stripe finalized an invoice that does not match the approved firing charge.",
      502,
    );
  }
  return {
    id: invoice.id,
    hostedInvoiceUrl,
    invoicePdfUrl: cleanNullable(safeString(invoice.invoice_pdf)),
    amountDue: invoice.amount_due,
    status: safeString(invoice.status),
  };
}

async function recordOperationStep(
  operationId: string,
  step: string,
  values: Record<string, unknown>,
): Promise<void> {
  await db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId).update({
    [`steps.${step}`]: { status: "succeeded", at: nowTs(), ...values },
    ...values,
    status: "in_progress",
    updatedAt: nowTs(),
  });
}

async function completeHeldFinalization(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  actor: StaffActor,
): Promise<FiringPickupSagaResult> {
  const now = nowTs();
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId);
  await db.runTransaction(async (transaction) => {
    transaction.set(ticketRef, {
      status: "awaiting_pickup_review",
      billingStatus: "hold_for_review",
      noticeStatus: "not_queued",
      billingFinalizedAt: null,
      updatedAt: now,
    }, { merge: true });
    transaction.set(operationRef, {
      status: "completed",
      result: "hold_for_review",
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.create(ticketRef.collection("events").doc(`${reserved.operationId}-held`), {
      type: "pickup_review_held",
      operationId: reserved.operationId,
      actorUid: actor.uid,
      at: now,
    });
  });
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
}

async function completeNoChargeFinalization(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  actor: StaffActor,
  runtime: FiringBillingRuntime,
): Promise<FiringPickupSagaResult> {
  const now = nowTs();
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId);
  const mailRef = db.collection(MAIL_COLLECTION).doc(`${reserved.operationId}-pickup`);
  const pickupDetailsToken = makeOpaquePickupDetailsToken();
  const pickupDetailsTokenRef = db.collection(PICKUP_DETAILS_TOKENS_COLLECTION).doc(pickupDetailsTokenHash(pickupDetailsToken));
  const mail = makePickupMail({
    ticket: reserved.ticket,
    input,
    runtime,
    operationId: reserved.operationId,
    hostedInvoiceUrl: null,
    pickupDetailsUrl: pickupDetailsActionUrl(pickupDetailsToken),
  });
  await db.runTransaction(async (transaction) => {
    transaction.set(ticketRef, {
      status: "ready_for_pickup",
      billingStatus: "no_charge",
      noticeStatus: "queued",
      pickupMailId: mailRef.id,
      currentNoticeMailId: mailRef.id,
      pickupInstructionsVersion: runtime.pickupInstructionsVersion,
      billingFinalizedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.set(operationRef, {
      status: "completed",
      result: "no_charge",
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.create(pickupDetailsTokenRef, {
      ticketId: input.ticketId,
      recipientEmailHash: pickupDetailsTokenHash(normalizeEmail(reserved.ticket.email)),
      createdAt: now,
      expiresAtMs: Date.now() + PICKUP_DETAILS_TOKEN_TTL_MS,
      requestCount: 0,
    });
    transaction.set(mailRef, mail);
    transaction.create(ticketRef.collection("events").doc(`${reserved.operationId}-ready`), {
      type: "ready_for_pickup_no_charge",
      operationId: reserved.operationId,
      actorUid: actor.uid,
      at: now,
    });
  });
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
}

async function completeBillableFinalization(
  reserved: ReservedFinalization,
  input: StaffFinalizeFiringPickupInput,
  actor: StaffActor,
  runtime: FiringBillingRuntime,
  customer: StripeCustomerResolution,
  invoice: FinalizedInvoiceResult,
): Promise<FiringPickupSagaResult> {
  const now = nowTs();
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId);
  const mailRef = db.collection(MAIL_COLLECTION).doc(`${reserved.operationId}-pickup`);
  const pickupDetailsToken = makeOpaquePickupDetailsToken();
  const pickupDetailsTokenRef = db.collection(PICKUP_DETAILS_TOKENS_COLLECTION).doc(pickupDetailsTokenHash(pickupDetailsToken));
  const mail = makePickupMail({
    ticket: reserved.ticket,
    input,
    runtime,
    operationId: reserved.operationId,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    pickupDetailsUrl: pickupDetailsActionUrl(pickupDetailsToken),
  });
  await db.runTransaction(async (transaction) => {
    transaction.set(ticketRef, {
      status: "ready_for_pickup",
      billingStatus: invoice.status === "paid" ? "paid" : "invoice_open",
      noticeStatus: "queued",
      ownerUid: customer.ownerUid,
      stripeMode: runtime.stripeMode,
      stripeCustomerId: customer.customerId,
      stripeInvoiceId: invoice.id,
      invoiceAmountDueCents: invoice.amountDue,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdfUrl: invoice.invoicePdfUrl,
      pickupMailId: mailRef.id,
      currentNoticeMailId: mailRef.id,
      pickupInstructionsVersion: runtime.pickupInstructionsVersion,
      billingFinalizedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.set(operationRef, {
      status: "completed",
      result: invoice.status === "paid" ? "paid" : "invoice_open",
      stripeCustomerId: customer.customerId,
      stripeInvoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdfUrl: invoice.invoicePdfUrl,
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    transaction.create(pickupDetailsTokenRef, {
      ticketId: input.ticketId,
      recipientEmailHash: pickupDetailsTokenHash(normalizeEmail(reserved.ticket.email)),
      createdAt: now,
      expiresAtMs: Date.now() + PICKUP_DETAILS_TOKEN_TTL_MS,
      requestCount: 0,
    });
    transaction.set(mailRef, mail);
    transaction.create(ticketRef.collection("events").doc(`${reserved.operationId}-ready`), {
      type: "ready_for_pickup_invoiced",
      operationId: reserved.operationId,
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amountDue,
      actorUid: actor.uid,
      at: now,
    });
  });
  return {
    ticketId: input.ticketId,
    operationId: reserved.operationId,
    outcome: input.outcome,
    billingStatus: invoice.status === "paid" ? "paid" : "invoice_open",
    noticeStatus: "queued",
    finalChargeCents: input.finalChargeCents,
    currency: "usd",
    stripeMode: runtime.stripeMode,
    stripeInvoiceId: invoice.id,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    duplicate: reserved.duplicate,
  };
}

async function markFinalizationReconciliationRequired(
  reserved: ReservedFinalization,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const now = nowTs();
  await Promise.all([
    db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId).set({
      status: "reconciliation_required",
      failureMessage: message.slice(0, 1000),
      failedAt: now,
      updatedAt: now,
    }, { merge: true }),
    db.collection(FIRING_TICKETS_COLLECTION).doc(reserved.ticket.ticketId).set({
      billingStatus: "reconciliation_required",
      updatedAt: now,
    }, { merge: true }),
  ]);
}

const defaultPickupSagaDependencies: FiringPickupSagaDependencies = {
  assertWriteReady: assertStripeWebhookWriteReady,
  reserve: reserveFinalization,
  resolveCustomer: resolveStripeCustomer,
  createDraftInvoice: createDraftFiringInvoice,
  createInvoiceItem: createFiringInvoiceItem,
  finalizeInvoice: finalizeFiringInvoice,
  recordStep: recordOperationStep,
  completeHold: completeHeldFinalization,
  completeNoCharge: completeNoChargeFinalization,
  completeBillable: completeBillableFinalization,
  markReconciliationRequired: markFinalizationReconciliationRequired,
};

export async function runFiringPickupBillingSaga(
  input: StaffFinalizeFiringPickupInput,
  actor: StaffActor,
  runtime: FiringBillingRuntime,
  dependencies: FiringPickupSagaDependencies = defaultPickupSagaDependencies,
): Promise<FiringPickupSagaResult> {
  if (billableOutcomeSchema.safeParse(input.outcome).success && input.finalChargeCents > 0) {
    assertBillableRuntime(runtime);
    await dependencies.assertWriteReady(runtime);
  }
  const reserved = await dependencies.reserve(input, actor, runtime);
  if (reserved.completed) {
    return {
      ticketId: input.ticketId,
      operationId: reserved.operationId,
      outcome: input.outcome,
      billingStatus: input.outcome === "studio_fault_no_charge" ? "no_charge" :
        input.outcome === "hold_for_review" ? "hold_for_review" :
          reserved.resultBillingStatus ?? "invoice_open",
      noticeStatus: input.outcome === "hold_for_review" ? "not_queued" : "queued",
      finalChargeCents: input.finalChargeCents,
      currency: "usd",
      stripeMode: reserved.stripeMode,
      stripeInvoiceId: reserved.stripeInvoiceId,
      hostedInvoiceUrl: reserved.hostedInvoiceUrl,
      duplicate: true,
    };
  }
  if (input.outcome === "hold_for_review") {
    return dependencies.completeHold(reserved, input, actor);
  }
  if (input.outcome === "studio_fault_no_charge" || input.finalChargeCents === 0) {
    return dependencies.completeNoCharge(reserved, input, actor, runtime);
  }

  try {
    let customer: StripeCustomerResolution;
    if (reserved.stripeCustomerId) {
      customer = { customerId: reserved.stripeCustomerId, ownerUid: reserved.ticket.ownerUid };
    } else {
      customer = await dependencies.resolveCustomer(reserved, input, runtime);
      await dependencies.recordStep(reserved.operationId, "customer", {
        stripeCustomerId: customer.customerId,
        ownerUid: customer.ownerUid,
      });
    }
    let invoiceId = reserved.stripeInvoiceId;
    if (!invoiceId) {
      const draft = await dependencies.createDraftInvoice(reserved, input, runtime, customer);
      invoiceId = draft.id;
      await dependencies.recordStep(reserved.operationId, "invoice", { stripeInvoiceId: invoiceId });
    }
    if (!reserved.stripeInvoiceItemId) {
      const item = await dependencies.createInvoiceItem(reserved, input, runtime, customer, invoiceId);
      await dependencies.recordStep(reserved.operationId, "line", { stripeInvoiceItemId: item.id });
    }
    const invoice = await dependencies.finalizeInvoice(reserved, input, runtime, invoiceId);
    await dependencies.recordStep(reserved.operationId, "finalize", {
      stripeInvoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      invoicePdfUrl: invoice.invoicePdfUrl,
      amountDue: invoice.amountDue,
      invoiceStatus: invoice.status,
    });
    return await dependencies.completeBillable(reserved, input, actor, runtime, customer, invoice);
  } catch (error) {
    await dependencies.markReconciliationRequired(reserved, error);
    if (error instanceof FiringBillingError) throw error;
    throw new FiringBillingError(
      "FIRING_BILLING_RECONCILIATION_REQUIRED",
      "Stripe returned an incomplete result. This ticket is held for reconciliation; no second invoice will be created.",
      502,
    );
  }
}

async function requireFiringBillingStaff(req: RequestLike): Promise<
  { ok: true; actor: StaffActor } |
  { ok: false; status: number; message: string }
> {
  const auth = await requireAuthUid(req);
  if (!auth.ok) return { ok: false, status: 401, message: auth.message };
  if (isStaffFromDecoded(auth.decoded) || isAdminFromDecoded(auth.decoded)) {
    return {
      ok: true,
      actor: {
        uid: auth.uid,
        email: cleanNullable(safeString(auth.decoded.email)),
        mode: "staff",
      },
    };
  }
  const dev = await requireAdmin(req);
  if (dev.ok) {
    return {
      ok: true,
      actor: {
        uid: auth.uid,
        email: cleanNullable(safeString(auth.decoded.email)),
        mode: dev.mode,
      },
    };
  }
  return { ok: false, status: dev.httpStatus, message: "Staff access required" };
}

// This endpoint only reads records for the staff creation form. Its bounded
// results are explicitly reported so that absence is never treated as proof.
export const staffGetFiringTicketCreationOptions = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, message: "Use POST" }); return; }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) { res.status(staff.status).json({ ok: false, message: staff.message }); return; }
    try {
      const [users, profiles, firings] = await Promise.all([
        db.collection("users").limit(500).get(),
        db.collection("profiles").limit(500).get(),
        db.collection("kilnFirings").orderBy("startAt", "desc").limit(200).get(),
      ]);
      const people = new Map<string, Record<string, unknown>>();
      for (const doc of [...users.docs, ...profiles.docs]) {
        people.set(doc.id, { ...people.get(doc.id), ...doc.data() });
      }
      res.status(200).json({ ok: true, data: {
        people: [...people.entries()].map(([uid, data]) => ({
          uid, displayName: safeString(data.displayName || data.name).trim(),
          email: normalizeEmail(data.email),
        })).filter((person) => person.displayName || person.email),
        firings: firings.docs.map((doc) => {
          const data = asRecord(doc.data());
          return { id: doc.id, title: safeString(data.title || data.name || data.kilnName).trim(),
            startAt: toIso(data.startAt), unloadedAt: toIso(data.unloadedAt), status: safeString(data.status).trim() };
        }),
        limits: { users: users.size, profiles: profiles.size, firings: firings.size },
      } });
    } catch (error) {
      logger.error("staffGetFiringTicketCreationOptions failed", { message: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ ok: false, message: "Unable to load clients, firings, and existing tickets." });
    }
  },
);

export const staffGetFiringTicketClientHistory = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, message: "Use POST" }); return; }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) { res.status(staff.status).json({ ok: false, message: staff.message }); return; }
    const parsed = z.object({ ownerUid: z.string().trim().min(1).max(128).refine((s) => !s.includes("/")) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, message: "Select a valid client." }); return; }
    try {
      const rate = await enforceRateLimit({ req, key: "staffGetFiringTicketClientHistory", max: 60, windowMs: 60_000 });
      if (!rate.ok) { res.status(429).json({ ok: false, message: "Too many ticket history requests." }); return; }
      const uid = parsed.data.ownerUid;
      const [user, profile] = await Promise.all([
        db.collection("users").doc(uid).get(), db.collection("profiles").doc(uid).get(),
      ]);
      if (!user.exists && !profile.exists) { res.status(404).json({ ok: false, message: "Client not found." }); return; }
      const person = { ...asRecord(user.data()), ...asRecord(profile.data()) };
      const email = normalizeEmail(person.email);
      const [byOwner, byEmail, reservations] = await Promise.all([
        db.collection(FIRING_TICKETS_COLLECTION).where("ownerUid", "==", uid).limit(501).get(),
        email ? db.collection(FIRING_TICKETS_COLLECTION).where("email", "==", email).limit(501).get() : Promise.resolve(null),
        db.collection("reservations").where("ownerUid", "==", uid).limit(101).get(),
      ]);
      const results = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const doc of [...byOwner.docs, ...(byEmail?.docs ?? [])]) results.set(doc.id, doc);
      const tickets = [...results.values()].filter((doc) => isListedFiringTicket(asRecord(doc.data())))
        .map((doc) => {
          const data = asRecord(doc.data());
          return { ...queueTicketDto(doc.id, data, true), ownerUid: safeString(data.ownerUid).trim(),
            firingId: safeString(data.firingId).trim() };
        });
      const paidReservations = reservations.docs.map((doc) => {
        const data = asRecord(doc.data());
        const addOns = asRecord(data.addOns);
        return { reservationId: doc.id, status: safeString(data.status), intakeMode: safeString(data.intakeMode),
          firingType: safeString(data.firingType), firingRange: safeString(data.firingRange), estimatedHalfShelves: typeof data.estimatedHalfShelves === "number" ? data.estimatedHalfShelves : null,
          createdAt: toIso(data.createdAt), privateRequested: addOns.privateRequested === true, rushRequested: addOns.rushRequested === true,
          communitySharingAllowed: addOns.communityShelfFillInAllowed === true };
      }).filter((row) => ["SHELF_PURCHASE", "WHOLE_KILN"].includes(row.intakeMode.trim().toUpperCase()) && !["cancelled", "deleted"].includes(row.status.toLowerCase()));
      res.status(200).json({ ok: true, data: { tickets, reservations: paidReservations, reservationsTruncated: reservations.size > 100, truncated: byOwner.size > 500 || (byEmail?.size ?? 0) > 500, emailAvailable: Boolean(email) } });
    } catch (error) {
      logger.error("staffGetFiringTicketClientHistory failed", { message: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ ok: false, message: "Unable to load this client's ticket history." });
    }
  },
);

export async function createStaffFiringTicketRecord(input: StaffCreateFiringTicketInput, actor: StaffActor) {
      const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const ticketId = "MF-" + createHash("sha256").update(input.clientRequestId).digest("hex").slice(0, 12).toUpperCase();
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId);
      const userRef = db.collection("users").doc(input.ownerUid);
      const profileRef = db.collection("profiles").doc(input.ownerUid);
      const firingRef = input.firingId ? db.collection("kilnFirings").doc(input.firingId) : null;
      const reservationRef = input.reservationId ? db.collection("reservations").doc(input.reservationId) : null;
      const reservationLockRef = input.reservationId ? db.collection("staffFiringTicketLinks").doc(firingTicketLockId(`reservation:${input.reservationId}`, "uid", input.ownerUid)) : null;
      const manualKey = input.manualFiring ? manualFiringKey(input.manualFiring) : null;
      const firingKey = input.firingId ? `portal:${input.firingId}` : manualKey ? `manual:${manualKey}` : null;
      const lockRef = firingKey ? db.collection("staffFiringTicketLinks").doc(
        firingTicketLockId(firingKey, "uid", input.ownerUid),
      ) : null;
      return await db.runTransaction(async (tx) => {
        const [existing, user, profile, firing, lock, linked, reservation, reservationLock, linkedReservation] = await Promise.all([
          tx.get(ticketRef), tx.get(userRef), tx.get(profileRef),
          firingRef ? tx.get(firingRef) : Promise.resolve(null),
          lockRef ? tx.get(lockRef) : Promise.resolve(null),
          firingKey ? tx.get(db.collection(FIRING_TICKETS_COLLECTION).where(
            input.firingId ? "firingId" : "manualFiringKey", "==", input.firingId || manualKey,
          )) : Promise.resolve(null),
          reservationRef ? tx.get(reservationRef) : Promise.resolve(null),
          reservationLockRef ? tx.get(reservationLockRef) : Promise.resolve(null),
          input.reservationId ? tx.get(db.collection(FIRING_TICKETS_COLLECTION).where("reservationId", "==", input.reservationId)) : Promise.resolve(null),
        ]);
        if (existing.exists) {
          if (existing.data()?.payloadHash !== payloadHash) throw new FiringBillingError("REQUEST_CONFLICT", "This request was already used with different details.", 409);
          return { ticketId, duplicate: true };
        }
        if (!user.exists && !profile.exists) throw new FiringBillingError("CLIENT_NOT_FOUND", "The selected client no longer exists.", 404);
        const person = { ...asRecord(user.data()), ...asRecord(profile.data()) };
        const displayName = safeString(person.displayName || person.name).trim();
        const email = normalizeEmail(person.email) || null;
        const emailLockRef = firingKey && email
          ? db.collection("staffFiringTicketLinks").doc(firingTicketLockId(firingKey, "email", email))
          : null;
        const emailLock = emailLockRef ? await tx.get(emailLockRef) : null;
        if (!displayName) throw new FiringBillingError("CLIENT_NAME_MISSING", "The selected client has no saved name.", 409);
        let reservationRequests: ReturnType<typeof reservationFiringRequests> | null = null;
        if (input.reservationId) {
          if (!reservation?.exists) throw new FiringBillingError("RESERVATION_NOT_FOUND", "The selected check-in no longer exists.", 404);
          try { reservationRequests = reservationFiringRequests(asRecord(reservation.data()), input.ownerUid); }
          catch { throw new FiringBillingError("RESERVATION_NOT_ELIGIBLE", "The selected check-in is not an active paid check-in for this client.", 409); }
          if (reservationRequests.firingRange && reservationRequests.firingRange !== input.heatId) throw new FiringBillingError("RESERVATION_FIRING_RANGE_MISMATCH", "The ticket firing range must match the check-in; resolve the difference before creating the ticket.", 409);
          if (reservationLock?.exists || linkedReservation?.docs.some((doc) => isListedFiringTicket(asRecord(doc.data())))) throw new FiringBillingError("RESERVATION_TICKET_EXISTS", "A ticket is already linked to this check-in.", 409);
        }
        if (input.firingId && (!firing?.exists || !firing.data()?.unloadedAt)) {
          throw new FiringBillingError("FIRING_NOT_UNLOADED", "Select an existing firing recorded as unloaded.", 409);
        }
        if (firingKey && (lock?.exists || emailLock?.exists || hasExistingFiringTicket(
          linked?.docs.map((doc) => ({ ...asRecord(doc.data()), firingId: firingKey })) ?? [],
          { ownerUid: input.ownerUid, email, firingId: firingKey },
        ))) throw new FiringBillingError("FIRING_TICKET_EXISTS", "A ticket is already linked to this client and firing.", 409);
        const now = nowTs();
        const retroactive = input.stage === "already_unloaded";
        tx.create(ticketRef, {
          ticketId, uid: input.ownerUid, ownerUid: input.ownerUid, displayName, email,
          ...staffTicketInitialState(input.stage), billingVersion: 0, noticeStatus: "not_queued",
          source: "staff_ticket", channel: "staff", selection: {
            intentId: "dropoff", heatId: input.heatId, spaceId: input.spaceId, firingType: input.firingType,
          },
          ...(reservationRequests ? { ...(reservationRequests.pricingVersion != null ? { pricingVersion: reservationRequests.pricingVersion } : {}), addOnRequests: {
            private: reservationRequests.private, rush: reservationRequests.rush, communitySharing: reservationRequests.communitySharing,
          }, otherRequestedServices: reservationRequests.otherRequestedServices, reservationId: input.reservationId } : input.stage === "new_dropoff" ? { pricingVersion: newFiringPricingVersion(), addOnRequests: {
            private: input.privateRequested === true, rush: input.rushRequested === true, communitySharing: input.communitySharingAllowed === true,
          } } : {}),
          artifact: { heat: input.heatId === "low" ? "Low fire" : input.heatId === "mid" ? "Mid fire" : input.heatId === "high" ? "Cone 10 electric oxidation" : "Custom firing" },
          firingId: input.firingId, privateStaffNote: input.note || null, clientRequestId: input.clientRequestId,
          ...(input.manualFiring ? { manualFiring: input.manualFiring, manualFiringKey: manualKey } : {}),
          payloadHash, createdAt: now, updatedAt: now, createdByUid: actor.uid,
          ...(retroactive ? { ...(firing ? { unloadedAt: firing.data()?.unloadedAt } : {}), pickupReviewSource: "staff_retroactive" } : {}),
        });
        tx.create(ticketRef.collection("events").doc("staff-created"), {
          type: "staff_ticket_created", actorUid: actor.uid, firingId: input.firingId,
          stage: input.stage, manualFiring: input.manualFiring ?? null, reviewedExistingTicketsAndPayments: true, at: now,
        });
        if (lockRef) tx.create(lockRef, { ticketId, ownerUid: input.ownerUid, firingId: input.firingId, createdAt: now });
        if (emailLockRef) tx.create(emailLockRef, { ticketId, ownerUid: input.ownerUid, firingId: input.firingId, createdAt: now });
        if (reservationLockRef) tx.create(reservationLockRef, { ticketId, ownerUid: input.ownerUid, reservationId: input.reservationId, createdAt: now });
        return { ticketId, duplicate: false };
      });
}

export const staffCreateFiringTicket = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ ok: false, message: "Use POST" }); return; }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) { res.status(staff.status).json({ ok: false, message: staff.message }); return; }
    const parsed = parseBody(staffCreateFiringTicketSchema, req.body);
    if (!parsed.ok) { res.status(400).json({ ok: false, message: parsed.message }); return; }
    const input = parsed.data;
    try {
      assertClientRequestHeaderMatches(req, input.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffCreateFiringTicket", max: 20, windowMs: 60_000 });
      if (!rate.ok) { res.status(429).json({ ok: false, message: "Too many ticket requests." }); return; }
      const result = await createStaffFiringTicketRecord(input, staff.actor);
      res.status(200).json({ ok: true, data: result });
    } catch (error) {
      const known = error instanceof FiringBillingError ? error : null;
      const firestoreCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code) : "";
      const retryable = ["10", "4", "ABORTED", "DEADLINE_EXCEEDED"].includes(firestoreCode);
      logger.error("staffCreateFiringTicket failed", { code: known?.code, message: error instanceof Error ? error.message : String(error) });
      res.status(known?.httpStatus ?? (retryable ? 503 : 500)).json({
        ok: false, code: known?.code ?? (retryable ? "STAFF_TICKET_RETRY" : "STAFF_TICKET_ERROR"),
        message: known?.message ?? (retryable ? "Ticket creation was interrupted. Retry this same request before changing the details." : "Unable to create the ticket."),
      });
    }
  },
);

function assertClientRequestHeaderMatches(req: RequestLike, clientRequestId: string): void {
  const header = readStripeIdempotencyKey(req.headers);
  if (header && header !== clientRequestId) {
    throw new FiringBillingError(
      "IDEMPOTENCY_HEADER_MISMATCH",
      "The Idempotency-Key header must match clientRequestId.",
      400,
    );
  }
}

export async function prepareFiringPickupReview(
  input: StaffPrepareFiringPickupReviewInput,
  actor: StaffActor,
): Promise<{
  ticketId: string;
  action: "link_batch" | "confirm_unloaded";
  status: string;
  billingVersion: number;
  batchId: string | null;
  duplicate: boolean;
}> {
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const eventId = makeIdempotencyId(
    input.action === "link_batch" ? "firing-batch-link" : "firing-unloaded",
    input.ticketId,
    input.clientRequestId,
  );
  const eventRef = ticketRef.collection("events").doc(eventId);
  const batchRef = input.batchId ? db.collection("batches").doc(input.batchId) : null;

  return db.runTransaction(async (transaction) => {
    const [ticketSnap, eventSnap] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(eventRef),
    ]);
    const batchSnap = batchRef ? await transaction.get(batchRef) : null;
    if (!ticketSnap.exists) {
      throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
    }
    const ticket = asRecord(ticketSnap.data());
    const currentVersion = Math.max(asInt(ticket.billingVersion, 0), 0);
    const currentBatchId = cleanNullable(safeString(ticket.batchId));
    const currentStatus = safeString(ticket.status).trim() || "expected_dropoff";
    if (eventSnap.exists) {
      return {
        ticketId: input.ticketId,
        action: input.action,
        status: safeString(eventSnap.data()?.status).trim() || currentStatus,
        billingVersion: Math.max(asInt(eventSnap.data()?.billingVersion, currentVersion), 0),
        batchId: currentBatchId ?? input.batchId,
        duplicate: true,
      };
    }
    if (currentBatchId && input.batchId && currentBatchId !== input.batchId) {
      throw new FiringBillingError(
        "TICKET_BATCH_MISMATCH",
        "This firing ticket is already linked to another portal batch.",
        409,
      );
    }
    const currentBillingStatus = safeString(ticket.billingStatus).trim() || "unbilled";
    const alreadyAwaitingReview = currentStatus === "awaiting_pickup_review";
    if (
      input.action === "confirm_unloaded" &&
      alreadyAwaitingReview &&
      (!input.batchId || currentBatchId === input.batchId)
    ) {
      return {
        ticketId: input.ticketId,
        action: input.action,
        status: "awaiting_pickup_review",
        billingVersion: currentVersion,
        batchId: currentBatchId,
        duplicate: true,
      };
    }
    if (currentBillingStatus !== "unbilled") {
      throw new FiringBillingError(
        "TICKET_BILLING_ALREADY_STARTED",
        "This ticket already has a billing decision.",
        409,
      );
    }
    const unloadableStatuses = new Set(["issued", "expected_dropoff", "in_studio", "firing", "cooling"]);
    if (!unloadableStatuses.has(currentStatus)) {
      throw new FiringBillingError(
        input.action === "link_batch" ? "TICKET_NOT_LINKABLE" : "TICKET_NOT_UNLOADABLE",
        input.action === "link_batch"
          ? "This ticket cannot be connected to a portal batch from its current studio stage."
          : "This ticket cannot be opened for pickup review from its current studio stage.",
        409,
      );
    }
    if (currentVersion !== input.expectedVersion) {
      throw new FiringBillingError(
        "TICKET_VERSION_CONFLICT",
        "This ticket changed after you opened it. Refresh before opening pickup review.",
        409,
      );
    }

    let ownerUid = cleanNullable(safeString(ticket.ownerUid));
    if (batchRef) {
      if (!batchSnap?.exists) {
        throw new FiringBillingError("BATCH_NOT_FOUND", "Portal batch not found.", 404);
      }
      const batch = asRecord(batchSnap.data());
      if (batch.isClosed === true) {
        throw new FiringBillingError("BATCH_CLOSED", "A closed portal batch cannot be linked.", 409);
      }
      const batchTicketId = cleanNullable(safeString(batch.firingTicketId));
      if (batchTicketId && batchTicketId !== input.ticketId) {
        throw new FiringBillingError(
          "BATCH_TICKET_MISMATCH",
          "This portal batch is already linked to another firing ticket.",
          409,
        );
      }
      const batchOwnerUid = cleanNullable(safeString(batch.ownerUid));
      if (!batchOwnerUid) {
        throw new FiringBillingError("BATCH_OWNER_MISSING", "The portal batch has no owner.", 409);
      }
      if (ownerUid && ownerUid !== batchOwnerUid) {
        throw new FiringBillingError(
          "TICKET_OWNER_MISMATCH",
          "The firing ticket and portal batch belong to different artists.",
          409,
        );
      }
      ownerUid = ownerUid ?? batchOwnerUid;
      if (
        input.action === "link_batch" &&
        currentBatchId === input.batchId &&
        batchTicketId === input.ticketId
      ) {
        return {
          ticketId: input.ticketId,
          action: input.action,
          status: currentStatus,
          billingVersion: currentVersion,
          batchId: currentBatchId,
          duplicate: true,
        };
      }
    }

    const now = nowTs();
    const nextVersion = currentVersion + 1;
    if (input.action === "link_batch") {
      transaction.set(ticketRef, {
        billingVersion: nextVersion,
        batchId: input.batchId,
        ownerUid,
        batchLinkedAt: now,
        batchLinkedByUid: actor.uid,
        updatedAt: now,
      }, { merge: true });
      transaction.set(batchRef as FirebaseFirestore.DocumentReference, {
        firingTicketId: input.ticketId,
        firingTicketLinkedAt: now,
        firingTicketLinkedByUid: actor.uid,
        updatedAt: now,
      }, { merge: true });
      transaction.create(eventRef, {
        type: "portal_batch_linked",
        source: "staff_pre_unload_link",
        status: currentStatus,
        batchId: input.batchId,
        actorUid: actor.uid,
        billingVersion: nextVersion,
        at: now,
      });
      return {
        ticketId: input.ticketId,
        action: input.action,
        status: currentStatus,
        billingVersion: nextVersion,
        batchId: input.batchId,
        duplicate: false,
      };
    }

    transaction.set(ticketRef, {
      status: "awaiting_pickup_review",
      billingVersion: nextVersion,
      batchId: input.batchId ?? currentBatchId,
      ownerUid,
      unloadedAt: now,
      unloadedByUid: actor.uid,
      pickupReviewSource: input.batchId ? "staff_batch_link" : "staff_confirmation",
      updatedAt: now,
    }, { merge: true });
    if (batchRef) {
      transaction.set(batchRef, {
        firingTicketId: input.ticketId,
        firingTicketLinkedAt: now,
        firingTicketLinkedByUid: actor.uid,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.create(eventRef, {
      type: "pickup_review_opened",
      source: input.batchId ? "staff_batch_link" : "staff_confirmation",
      status: "awaiting_pickup_review",
      batchId: input.batchId ?? currentBatchId,
      actorUid: actor.uid,
      billingVersion: nextVersion,
      at: now,
    });
    return {
      ticketId: input.ticketId,
      action: input.action,
      status: "awaiting_pickup_review",
      billingVersion: nextVersion,
      batchId: input.batchId ?? currentBatchId,
      duplicate: false,
    };
  });
}

export const staffPrepareFiringPickupReview = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffPrepareFiringPickupReviewSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({
        req,
        key: "staffPrepareFiringPickupReview",
        max: 30,
        windowMs: 60_000,
      });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many pickup review requests" });
        return;
      }
      const result = await prepareFiringPickupReview(parsed.data, staff.actor);
      res.status(200).json({ ok: true, data: result });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffPrepareFiringPickupReview failed", {
        code: billingError?.code ?? "FIRING_PICKUP_REVIEW_INTERNAL",
        message: error instanceof Error ? error.message : String(error),
        ticketId: parsed.data.ticketId,
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_PICKUP_REVIEW_INTERNAL",
        message: billingError?.message ?? "Unable to open this ticket for pickup review",
      });
    }
  },
);

export async function markFiringPickedUp(
  input: StaffMarkFiringPickedUpInput,
  actor: StaffActor,
): Promise<FiringPickupTransition & { ticketId: string }> {
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const eventId = makeIdempotencyId("firing-picked-up", input.ticketId, input.clientRequestId);
  const eventRef = ticketRef.collection("events").doc(eventId);

  return db.runTransaction(async (transaction) => {
    const [ticketSnap, eventSnap] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(eventRef),
    ]);
    if (!ticketSnap.exists) {
      throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
    }

    const ticket = asRecord(ticketSnap.data());
    const currentStatus = safeString(ticket.status).trim() || "expected_dropoff";
    const currentBillingStatus = safeString(ticket.billingStatus).trim() || "unbilled";
    const currentVersion = Math.max(asInt(ticket.billingVersion, 0), 0);
    if (eventSnap.exists) {
      return {
        ticketId: input.ticketId,
        status: "picked_up" as const,
        billingStatus: safeString(eventSnap.data()?.billingStatus).trim() || currentBillingStatus,
        billingVersion: Math.max(asInt(eventSnap.data()?.billingVersion, currentVersion), 0),
        duplicate: true,
      };
    }

    const transition = deriveFiringPickupTransition({
      status: currentStatus,
      billingStatus: currentBillingStatus,
      billingVersion: currentVersion,
      expectedVersion: input.expectedVersion,
    });
    if (transition.duplicate) {
      return { ticketId: input.ticketId, ...transition };
    }

    const now = nowTs();
    transaction.set(ticketRef, {
      status: transition.status,
      billingVersion: transition.billingVersion,
      pickedUpAt: now,
      pickedUpByUid: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.create(eventRef, {
      type: "firing_picked_up",
      status: transition.status,
      billingStatus: transition.billingStatus,
      actorUid: actor.uid,
      billingVersion: transition.billingVersion,
      at: now,
    });
    return { ticketId: input.ticketId, ...transition };
  });
}

export const staffMarkFiringPickedUp = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffMarkFiringPickedUpSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({
        req,
        key: "staffMarkFiringPickedUp",
        max: 30,
        windowMs: 60_000,
      });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many pickup requests" });
        return;
      }
      const result = await markFiringPickedUp(parsed.data, staff.actor);
      res.status(200).json({ ok: true, data: result });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffMarkFiringPickedUp failed", {
        code: billingError?.code ?? "FIRING_PICKUP_INTERNAL",
        message: error instanceof Error ? error.message : String(error),
        ticketId: parsed.data.ticketId,
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_PICKUP_INTERNAL",
        message: billingError?.message ?? "Unable to mark this firing ticket picked up",
      });
    }
  },
);

function publicFinalizationResult(result: FiringPickupSagaResult) {
  return {
    ticketId: result.ticketId,
    operationId: result.operationId,
    outcome: result.outcome,
    billingStatus: result.billingStatus,
    noticeStatus: result.noticeStatus,
    finalChargeCents: result.finalChargeCents,
    currency: result.currency,
    stripeMode: result.stripeMode,
    stripeInvoiceId: result.stripeInvoiceId,
    hasPaymentLink: Boolean(result.hostedInvoiceUrl),
    duplicate: result.duplicate,
  };
}

export async function handleStaffFinalizeFiringPickup(
  req: RequestLike,
  res: ResponseLike,
  runSaga: typeof runFiringPickupBillingSaga = runFiringPickupBillingSaga,
): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Use POST" });
    return;
  }
  const staff = await requireFiringBillingStaff(req);
  if (!staff.ok) {
    res.status(staff.status).json({ ok: false, message: staff.message });
    return;
  }
  const parsed = parseBody(staffFinalizeFiringPickupSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const rate = await enforceRateLimit({
    req,
    key: "staffFinalizeFiringPickup",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many firing billing requests" });
    return;
  }
  try {
    assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
    const runtime = runtimeFromConfig(await loadStripeConfig());
    const result = await runSaga(parsed.data, staff.actor, runtime);
    res.status(200).json({ ok: true, data: publicFinalizationResult(result) });
  } catch (error) {
    const billingError = error instanceof FiringBillingError ? error : null;
    const message = billingError?.message ?? "Unable to finalize this firing ticket";
    logger.error("staffFinalizeFiringPickup failed", {
      code: billingError?.code ?? "FIRING_BILLING_INTERNAL",
      errorMessage: error instanceof Error ? error.message : String(error),
      ticketId: parsed.data.ticketId,
    });
    res.status(billingError?.httpStatus ?? 500).json({
      ok: false,
      code: billingError?.code ?? "FIRING_BILLING_INTERNAL",
      message,
    });
  }
}

export function queueTicketDto(id: string, data: Record<string, unknown>, includeStaffFields = false) {
  const heat = readTicketHeat(data);
  const artifact = asRecord(data.artifact);
  const selection = asRecord(data.selection);
  return {
    ticketId: id,
    displayName: safeString(data.displayName).trim() || "Artist",
    email: normalizeEmail(data.email) || null,
    status: safeString(data.status).trim() || "expected_dropoff",
    billingStatus: safeString(data.billingStatus).trim() || "unbilled",
    noticeStatus: safeString(data.noticeStatus).trim() || "not_queued",
    billingVersion: Math.max(asInt(data.billingVersion, 0), 0),
    heatId: heat.id,
    heatLabel: heat.label,
    estimatedSpace: cleanNullable(safeString(data.estimatedSpace)),
    estimatedPrice: cleanNullable(safeString(artifact.price)),
    requestedSpaceId: cleanNullable(safeString(selection.spaceId)),
    pricingVersion: typeof data.pricingVersion === "number" ? data.pricingVersion : null,
    addOnRequests: asRecord(data.addOnRequests),
    otherRequestedServices: Array.isArray(data.otherRequestedServices) ? data.otherRequestedServices.filter((value): value is string => typeof value === "string") : [],
    firingType: cleanNullable(safeString(selection.firingType)),
    artistNote: cleanNullable(safeString(data.artistNote)),
    artistVisibleFiringNote: cleanNullable(safeString(data.artistVisibleFiringNote)),
    finalChargeCents: typeof data.finalChargeCents === "number" ? data.finalChargeCents : null,
    currency: safeString(data.currency).trim() || "usd",
    stripeMode: safeString(data.stripeMode) === "live" ? "live" :
      safeString(data.stripeMode) === "test" ? "test" : null,
    stripeInvoiceId: cleanNullable(safeString(data.stripeInvoiceId)),
    hostedInvoiceUrl: includeStaffFields ? cleanNullable(safeString(data.hostedInvoiceUrl)) : undefined,
    invoicePdfUrl: includeStaffFields ? cleanNullable(safeString(data.invoicePdfUrl)) : undefined,
    actualSpace: includeStaffFields ? asRecord(data.actualSpace) : undefined,
    stripeReceiptPrint: includeStaffFields ? asRecord(data.stripeReceiptPrint) : undefined,
    workSlipPrint: includeStaffFields ? asRecord(data.workSlipPrint) : undefined,
    receiptMailStatus: includeStaffFields ? safeString(data.receiptMailStatus).trim() || "not_sent" : undefined,
    invoiceMailStatus: includeStaffFields ? safeString(data.invoiceMailStatus).trim() || "not_sent" : undefined,
    deletedAt: includeStaffFields ? toIso(data.deletedAt) : undefined,
    ...(includeStaffFields ? {
      firingId: cleanNullable(safeString(data.firingId)),
      reservationId: cleanNullable(safeString(data.reservationId)),
      manualFiring: asRecord(data.manualFiring),
      privateStaffNote: cleanNullable(safeString(data.privateStaffNote)),
      batchId: cleanNullable(safeString(data.batchId)),
      billingOperationId: cleanNullable(safeString(data.billingOperationId)),
      activeAdjustmentOperationId: cleanNullable(safeString(data.activeAdjustmentOperationId)),
      canResumeBilling:
        (
          ["billing_preparing", "adjustment_pending", "reconciliation_required"].includes(
            safeString(data.billingStatus).trim(),
          ) || (
            ["invoice_open", "paid", "no_charge"].includes(safeString(data.billingStatus).trim()) &&
            !["queued", "sent"].includes(safeString(data.noticeStatus).trim())
          )
        ) && Boolean(
          cleanNullable(safeString(data.activeAdjustmentOperationId)) ??
          cleanNullable(safeString(data.billingOperationId)),
        ),
    } : {}),
    hasPaymentLink:
      Boolean(cleanNullable(safeString(data.stripeInvoiceId))) &&
      ["invoice_open", "payment_failed"].includes(safeString(data.billingStatus).trim()),
    hasInvoiceLink:
      Boolean(cleanNullable(safeString(data.stripeInvoiceId))) &&
      ["invoice_open", "payment_failed", "paid", "partially_refunded", "refunded"].includes(
        safeString(data.billingStatus).trim(),
      ),
    refundedAmountCents: Math.max(asInt(data.refundedAmountCents, 0), 0),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export function isListedFiringTicket(data: Record<string, unknown>): boolean {
  return safeString(data.status).trim() !== "deleted" &&
    !data.deletedAt &&
    safeString(data.billingStatus).trim() !== "not_applicable";
}

async function listFiringTicketsForStaff() {
  const snapshot = await db
    .collection(FIRING_TICKETS_COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get();
  return snapshot.docs
    .filter((document) => isListedFiringTicket(asRecord(document.data())))
    .map((document) => queueTicketDto(document.id, asRecord(document.data()), true));
}

export type FiringPlannerSnapshot = {
  periodDays: number;
  windowStart: string;
  generatedAt: string;
  ticketsSubmitted: number;
  expectedDropoff: number;
  awaitingPickupReview: number;
  readyForPickup: number;
  pickedUp: number;
};

type FiringPlannerSnapshotTicket = {
  status: string;
  billingStatus: string;
};

export function summarizeFiringPlannerTickets(
  tickets: FiringPlannerSnapshotTicket[],
  options: { periodDays: number; windowStart: string; generatedAt: string },
): FiringPlannerSnapshot {
  const relevant = tickets.filter((ticket) => ticket.billingStatus !== "not_applicable");
  return {
    periodDays: options.periodDays,
    windowStart: options.windowStart,
    generatedAt: options.generatedAt,
    ticketsSubmitted: relevant.length,
    expectedDropoff: relevant.filter((ticket) => ticket.status === "expected_dropoff").length,
    awaitingPickupReview: relevant.filter((ticket) => ticket.status === "awaiting_pickup_review").length,
    readyForPickup: relevant.filter((ticket) => ticket.status === "ready_for_pickup").length,
    pickedUp: relevant.filter((ticket) => ticket.status === "picked_up").length,
  };
}

async function loadFiringPlannerSnapshot(periodDays = 30): Promise<FiringPlannerSnapshot> {
  const generatedAt = new Date();
  const windowStartDate = new Date(generatedAt);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - periodDays);
  const snapshot = await db
    .collection(FIRING_TICKETS_COLLECTION)
    .where("createdAt", ">=", windowStartDate)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  return summarizeFiringPlannerTickets(
    snapshot.docs.map((document) => {
      const data = asRecord(document.data());
      return {
        status: safeString(data.status).trim() || "expected_dropoff",
        billingStatus: safeString(data.billingStatus).trim() || "unbilled",
      };
    }),
    {
      periodDays,
      windowStart: windowStartDate.toISOString(),
      generatedAt: generatedAt.toISOString(),
    },
  );
}

export function selectExactSavedArtistEmail(records: Array<Record<string, unknown>>): string | null {
  const emails = [...new Set(records
    .map((record) => normalizeEmail(record.email))
    .filter((email) => z.string().email().safeParse(email).success)
    .filter(Boolean))];
  return emails.length === 1 ? emails[0] : null;
}

async function lookupSavedArtistEmail(displayName: string): Promise<string | null> {
  const [usersSnapshot, legacyUsersSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).where("displayName", "==", displayName).limit(3).get(),
    db.collection(LEGACY_USERS_COLLECTION).where("displayName", "==", displayName).limit(3).get(),
  ]);
  return selectExactSavedArtistEmail([
    ...usersSnapshot.docs.map((document) => asRecord(document.data())),
    ...legacyUsersSnapshot.docs.map((document) => asRecord(document.data())),
  ]);
}

export const staffLookupFiringArtistContact = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffLookupFiringArtistContactSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    const rate = await enforceRateLimit({
      req,
      key: "staffLookupFiringArtistContact",
      max: 60,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many contact lookups" });
      return;
    }
    try {
      const email = await lookupSavedArtistEmail(parsed.data.displayName);
      res.status(200).json({
        ok: true,
        data: { contact: email ? { email } : null },
      });
    } catch (error) {
      logger.error("staffLookupFiringArtistContact failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ ok: false, message: "Unable to look up the saved artist contact" });
    }
  },
);

export const staffListFiringPickupReviews = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const rate = await enforceRateLimit({
      req,
      key: "staffListFiringPickupReviews",
      max: 60,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }
    try {
      const [tickets, config] = await Promise.all([
        listFiringTicketsForStaff(),
        loadStripeConfig(),
      ]);
      res.status(200).json({
        ok: true,
        data: {
          tickets,
          runtime: {
            stripeMode: config.mode,
            invoicesEnabled: config.enabledFeatures.invoices,
            firingBillingEnabled: config.firingBilling.enabled,
            liveWritesEnabled: config.firingBilling.liveWritesEnabled,
            daysUntilDue: config.firingBilling.daysUntilDue,
            pickupInstructionsVersion: config.firingBilling.pickupInstructionsVersion,
          },
        },
      });
    } catch (error) {
      logger.error("staffListFiringPickupReviews failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ ok: false, message: "Unable to load firing tickets" });
    }
  },
);

export const staffGetFiringPlannerSnapshot = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const rate = await enforceRateLimit({
      req,
      key: "staffGetFiringPlannerSnapshot",
      max: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many snapshot requests" });
      return;
    }
    try {
      const snapshot = await loadFiringPlannerSnapshot();
      res.status(200).json({ ok: true, data: { snapshot } });
    } catch (error) {
      logger.error("staffGetFiringPlannerSnapshot failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ ok: false, message: "Unable to load firing planner snapshot" });
    }
  },
);

const staffPreviewFiringChargeSchema = z.object({
  ticketId: z.string().trim().min(5).max(80).refine((id) => !id.includes("/")),
  expectedVersion: z.number().int().nonnegative(),
  actualSpace: actualSpaceSchema,
  privateFulfilled: z.boolean().optional(),
  rushFulfilled: z.boolean().optional(),
}).strict();

export const staffPreviewFiringCharge = onRequest({ region: REGION, cors: false, timeoutSeconds: 30 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Use POST" });
    return;
  }
  const staff = await requireFiringBillingStaff(req);
  if (!staff.ok) {
    res.status(staff.status).json({ ok: false, message: staff.message });
    return;
  }
  const parsed = parseBody(staffPreviewFiringChargeSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  try {
    const input = parsed.data;
    const data = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId));
      const ticket = asRecord(snapshot.data());
      if (!snapshot.exists || ticket.deletedAt) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
      if (ticket.pricingVersion !== 3 || ticket.status !== "awaiting_pickup_review" ||
          !["unbilled", "hold_for_review", ""].includes(safeString(ticket.billingStatus))) {
        throw new FiringBillingError("FIRING_PREVIEW_UNAVAILABLE", "This ticket is not ready for a version 3 billing preview.", 409);
      }
      if (asInt(ticket.billingVersion, 0) !== input.expectedVersion) {
        throw new FiringBillingError("TICKET_VERSION_CONFLICT", "This ticket changed. Refresh before reviewing the price.", 409);
      }
      const { rate, firingId, priorCents, billedAddOns } = await quoteFiringLedger(transaction, ticket, input, "preview");
      return { ...rate, firingId, priorCents, billedAddOns };
    }, { readOnly: true });
    res.json({ ok: true, data });
  } catch (error) {
    const billingError = error instanceof FiringBillingError ? error : null;
    res.status(billingError?.httpStatus ?? 500).json({
      ok: false, code: billingError?.code ?? "FIRING_PREVIEW_FAILED",
      message: billingError?.message ?? "Unable to preview the firing charge.",
    });
  }
});

export const staffFinalizeFiringPickup = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => handleStaffFinalizeFiringPickup(req, res),
);

async function claimFiringTicketForVerifiedArtist(params: {
  ticketId: string;
  uid: string;
  verifiedEmail: string;
  emailVerified: boolean;
}): Promise<Record<string, unknown> | null> {
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(params.ticketId);
  return db.runTransaction(async (transaction) => {
    const ticketSnap = await transaction.get(ticketRef);
    if (!ticketSnap.exists) return null;
    const ticket = asRecord(ticketSnap.data());
    const alreadyOwned = cleanNullable(safeString(ticket.ownerUid)) === params.uid;
    if (alreadyOwned) return ticket;
    if (!canClaimFiringTicketByVerifiedEmail({
      ticketEmail: ticket.email,
      ticketOwnerUid: ticket.ownerUid,
      uid: params.uid,
      verifiedEmail: params.verifiedEmail,
      emailVerified: params.emailVerified,
    })) {
      return null;
    }
    const claimedAt = nowTs();
    const eventRef = ticketRef.collection("events").doc(
      makeIdempotencyId("firing-ticket-artist-claim", params.ticketId, params.uid),
    );
    transaction.set(ticketRef, {
      ownerUid: params.uid,
      artistPortalClaimedAt: claimedAt,
      artistPortalClaimedByUid: params.uid,
    }, { merge: true });
    transaction.set(eventRef, {
      type: "artist_portal_claimed",
      source: "verified_email_match",
      actorUid: params.uid,
      at: claimedAt,
    }, { merge: true });
    return { ...ticket, ownerUid: params.uid };
  });
}

async function listTicketsForArtist(params: {
  uid: string;
  verifiedEmail: string;
  emailVerified: boolean;
}) {
  const { uid, verifiedEmail, emailVerified } = params;
  const [byOwner, byEmail] = await Promise.all([
    db.collection(FIRING_TICKETS_COLLECTION).where("ownerUid", "==", uid).limit(50).get(),
    emailVerified && verifiedEmail
      ? db.collection(FIRING_TICKETS_COLLECTION).where("email", "==", verifiedEmail).limit(50).get()
      : Promise.resolve(null),
  ]);
  const rows = new Map<string, Record<string, unknown>>();
  for (const document of byOwner.docs) rows.set(document.id, asRecord(document.data()));
  for (const document of byEmail?.docs ?? []) {
    const ticket = asRecord(document.data());
    if (cleanNullable(safeString(ticket.ownerUid)) === uid) {
      rows.set(document.id, ticket);
      continue;
    }
    const claimed = await claimFiringTicketForVerifiedArtist({
      ticketId: document.id,
      uid,
      verifiedEmail,
      emailVerified,
    });
    if (claimed) rows.set(document.id, claimed);
  }
  return [...rows.entries()]
    .map(([ticketId, ticket]) => queueTicketDto(ticketId, ticket))
    .filter((ticket) => ticket.billingStatus !== "not_applicable")
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

export const listMyFiringBilling = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const verifiedEmail = normalizeEmail(auth.decoded.email);
    const emailVerified = auth.decoded.email_verified === true;
    const rate = await enforceRateLimit({ req, key: "listMyFiringBilling", max: 60, windowMs: 60_000 });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }
    try {
      const tickets = await listTicketsForArtist({ uid: auth.uid, verifiedEmail, emailVerified });
      res.status(200).json({ ok: true, data: { tickets } });
    } catch (error) {
      logger.error("listMyFiringBilling failed", {
        uid: auth.uid,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ ok: false, message: "Unable to load firing billing" });
    }
  },
);

const invoiceLinkSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
}).strict();

export const getMyFiringInvoiceLink = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const parsed = parseBody(invoiceLinkSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    const rate = await enforceRateLimit({ req, key: "getMyFiringInvoiceLink", max: 20, windowMs: 60_000 });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }
    const ticketSnap = await db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId).get();
    if (!ticketSnap.exists) {
      res.status(404).json({ ok: false, message: "Firing ticket not found" });
      return;
    }
    const ticket = asRecord(ticketSnap.data());
    const staffAccess = isStaffFromDecoded(auth.decoded) || isAdminFromDecoded(auth.decoded);
    if (!staffAccess && !canAccessFiringTicket({
      ticketEmail: ticket.email,
      ticketOwnerUid: ticket.ownerUid,
      uid: auth.uid,
      verifiedEmail: auth.decoded.email,
      emailVerified: auth.decoded.email_verified === true,
    })) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }
    const billingStatus = safeString(ticket.billingStatus).trim();
    if (!["invoice_open", "payment_failed", "paid", "partially_refunded", "refunded"].includes(billingStatus)) {
      res.status(409).json({ ok: false, message: "This ticket does not currently have an invoice to open" });
      return;
    }
    const operationId = cleanNullable(safeString(ticket.billingOperationId));
    const operationSnap = operationId
      ? await db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId).get()
      : null;
    const operation = asRecord(operationSnap?.data());
    if (
      !operationSnap?.exists ||
      safeString(operation.ticketId) !== parsed.data.ticketId ||
      safeString(operation.stripeInvoiceId) !== safeString(ticket.stripeInvoiceId)
    ) {
      res.status(409).json({ ok: false, message: "This ticket's payment link needs studio review" });
      return;
    }
    const hostedInvoiceUrl = cleanNullable(safeString(operation.hostedInvoiceUrl));
    if (!hostedInvoiceUrl) {
      res.status(409).json({ ok: false, message: "This ticket does not have an open payment link" });
      return;
    }
    res.status(200).json({
      ok: true,
      data: {
        ticketId: parsed.data.ticketId,
        hostedInvoiceUrl,
        purpose: ["invoice_open", "payment_failed"].includes(billingStatus) ? "payment" : "receipt",
      },
    });
  },
);

const FIRING_WEBHOOK_EVENTS = new Set<string>(STRIPE_FIRING_BILLING_WEBHOOK_EVENTS);

function stripeObjectMetadata(event: Stripe.Event): Record<string, unknown> {
  return asRecord(asRecord(event.data.object).metadata);
}

export function getFiringTicketIdFromStripeEvent(event: Stripe.Event): string | null {
  if (!FIRING_WEBHOOK_EVENTS.has(event.type)) return null;
  const metadata = stripeObjectMetadata(event);
  if (safeString(metadata.source) !== "firing") return null;
  return cleanNullable(
    safeString(metadata.firing_ticket_id) || safeString(metadata.ticketId),
  );
}

export function isFiringBillingStripeEvent(event: Stripe.Event): boolean {
  return Boolean(getFiringTicketIdFromStripeEvent(event));
}

export function nextInvoiceBillingStatus(currentStatus: string, eventType: string): string {
  const protectedStatuses = new Set(["paid", "partially_refunded", "refunded"]);
  if (protectedStatuses.has(currentStatus) && eventType !== "refund.failed") return currentStatus;
  if (eventType === "invoice.finalized") return "invoice_open";
  if (eventType === "invoice.finalization_failed") return "reconciliation_required";
  if (eventType === "invoice.paid") return "paid";
  if (eventType === "invoice.payment_failed") return "payment_failed";
  if (eventType === "invoice.voided") return "void";
  if (eventType === "invoice.marked_uncollectible") return "uncollectible";
  if (eventType.startsWith("credit_note.")) return currentStatus;
  return currentStatus;
}

export async function projectFiringBillingStripeEvent(params: {
  event: Stripe.Event;
  mode: StripeMode;
}): Promise<{ ticketId: string; billingStatus: string }> {
  const ticketId = getFiringTicketIdFromStripeEvent(params.event);
  if (!ticketId) {
    throw new FiringBillingError("NOT_FIRING_EVENT", "Stripe event is not a firing billing event.");
  }
  const event = params.event;
  const object = asRecord(event.data.object);
  const metadata = stripeObjectMetadata(event);
  const operationId = cleanNullable(safeString(metadata.billing_operation_id));
  if (!operationId) {
    throw new FiringBillingError("BILLING_OPERATION_BINDING_MISSING", "Stripe event is missing its firing billing operation binding.", 409);
  }
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId);
  const ticketEventRef = ticketRef.collection("events").doc(event.id);
  return db.runTransaction(async (transaction) => {
    const [ticketSnap, operationSnap, ticketEventSnap] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(operationRef),
      transaction.get(ticketEventRef),
    ]);
    if (!ticketSnap.exists) {
      throw new FiringBillingError("TICKET_NOT_FOUND", "Webhook ticket binding was not found.", 404);
    }
    const current = asRecord(ticketSnap.data());
    if (ticketEventSnap.exists) {
      return {
        ticketId,
        billingStatus: safeString(current.billingStatus).trim() || "unbilled",
      };
    }
    if (!operationSnap.exists) {
      throw new FiringBillingError("BILLING_OPERATION_NOT_FOUND", "Webhook billing operation binding was not found.", 404);
    }
    const operation = asRecord(operationSnap.data());
    if (safeString(operation.ticketId) !== ticketId) {
      throw new FiringBillingError("BILLING_OPERATION_TICKET_MISMATCH", "Webhook operation does not belong to this firing ticket.", 409);
    }
    const operationMode = safeString(operation.stripeMode);
    if (operationMode && operationMode !== params.mode) {
      throw new FiringBillingError("STRIPE_MODE_MISMATCH", "Webhook mode does not match the billing operation.", 409);
    }
    const storedMode = safeString(current.stripeMode);
    if (storedMode && storedMode !== params.mode) {
      throw new FiringBillingError("STRIPE_MODE_MISMATCH", "Webhook mode does not match the firing ticket.", 409);
    }
    let billingStatus = safeString(current.billingStatus).trim() || "unbilled";
    const patch: Record<string, unknown> = {
      stripeMode: params.mode,
      lastStripeEventId: event.id,
      lastStripeEventType: event.type,
      updatedAt: nowTs(),
    };
    if (event.type.startsWith("invoice.")) {
      const invoice = object as unknown as Stripe.Invoice;
      const boundInvoiceId = cleanNullable(safeString(operation.stripeInvoiceId));
      if (boundInvoiceId && safeString(object.id) !== boundInvoiceId) {
        throw new FiringBillingError("STRIPE_INVOICE_BINDING_MISMATCH", "Webhook invoice does not match the billing operation.", 409);
      }
      billingStatus = nextInvoiceBillingStatus(billingStatus, event.type);
      patch.stripeInvoiceId = safeString(object.id);
      patch.invoiceAmountDueCents = typeof invoice.amount_due === "number" ? invoice.amount_due :
        current.invoiceAmountDueCents ?? null;
      patch.invoiceAmountPaidCents = typeof invoice.amount_paid === "number" ? invoice.amount_paid :
        current.invoiceAmountPaidCents ?? null;
      patch.hostedInvoiceUrl = cleanNullable(safeString(invoice.hosted_invoice_url)) ??
        current.hostedInvoiceUrl ?? null;
      patch.invoicePdfUrl = cleanNullable(safeString(invoice.invoice_pdf)) ?? current.invoicePdfUrl ?? null;
      if (event.type === "invoice.paid") {
        const paidAt = nowTs();
        patch.paidAt = paidAt;
        patch.stripeReceiptPrint = {
          status: "queued",
          queuedAt: paidAt,
          attempts: 0,
          lastError: null,
        };
      }
    } else if (event.type.startsWith("credit_note.")) {
      const creditNoteId = safeString(object.id);
      billingStatus = nextInvoiceBillingStatus(billingStatus, event.type);
      patch.stripeCreditNoteIds = FieldValue.arrayUnion(creditNoteId);
      patch.lastCreditNoteAmountCents = typeof object.amount === "number" ? object.amount : null;
    } else if (event.type === "charge.refunded") {
      const refundedAmountCents = Math.max(asInt(object.amount_refunded, 0), 0);
      const finalChargeCents = Math.max(asInt(current.finalChargeCents, 0), 0);
      patch.refundedAmountCents = Math.max(
        Math.max(asInt(current.refundedAmountCents, 0), 0),
        refundedAmountCents,
      );
      billingStatus = finalChargeCents > 0 && refundedAmountCents >= finalChargeCents
        ? "refunded"
        : refundedAmountCents > 0 ? "partially_refunded" : billingStatus;
    } else if (event.type.startsWith("refund.")) {
      const refund = object as unknown as Stripe.Refund;
      const refundId = safeString(refund.id);
      const currentLedger = asRecord(current.refundLedger);
      const nextLedger = {
        ...currentLedger,
        [refundId]: {
          amountCents: typeof refund.amount === "number" ? refund.amount : 0,
          status: safeString(refund.status) || (event.type === "refund.failed" ? "failed" : "pending"),
          failureReason: cleanNullable(safeString(refund.failure_reason)),
          eventId: event.id,
          updatedAt: new Date(event.created * 1000).toISOString(),
        },
      };
      const successfulRefundTotal = Object.values(nextLedger).reduce<number>((sum, value) => {
        const row = asRecord(value);
        return safeString(row.status) === "succeeded" ? sum + Math.max(asInt(row.amountCents, 0), 0) : sum;
      }, 0);
      const finalChargeCents = Math.max(asInt(current.finalChargeCents, 0), 0);
      patch.refundLedger = nextLedger;
      patch.refundedAmountCents = successfulRefundTotal;
      patch.stripeRefundIds = FieldValue.arrayUnion(refundId);
      if (finalChargeCents > 0 && successfulRefundTotal >= finalChargeCents) {
        billingStatus = "refunded";
      } else if (event.type === "refund.failed" || refund.status === "failed") {
        billingStatus = "refund_failed";
      } else if (refund.status === "succeeded") {
        billingStatus = "partially_refunded";
      } else {
        billingStatus = "adjustment_pending";
      }
    }
    patch.billingStatus = billingStatus;
    transaction.set(ticketRef, patch, { merge: true });
    transaction.create(ticketEventRef, {
      type: "stripe_billing_event",
      stripeEventType: event.type,
      stripeMode: params.mode,
      operationId,
      billingStatus,
      at: nowTs(),
    });
    return { ticketId, billingStatus };
  });
}

type ReservedAdjustment = {
  operationId: string;
  ticketId: string;
  duplicate: boolean;
  completed: boolean;
  billingVersion: number;
  previousBillingStatus: string;
  stripeMode: StripeMode;
  stripeInvoiceId: string;
  finalChargeCents: number;
  refundedAmountCents: number;
  stripeRefundId: string | null;
  stripeCreditNoteId: string | null;
  resultBillingStatus: string | null;
};

async function reserveAdjustment(
  input: StaffAdjustFiringBillingInput,
  actor: StaffActor,
): Promise<ReservedAdjustment> {
  const operationId = makeIdempotencyId("firing-adjustment", input.ticketId, input.clientRequestId);
  const commandHash = stableCommandHash(input);
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId);
  return db.runTransaction(async (transaction) => {
    const [ticketSnap, operationSnap] = await Promise.all([
      transaction.get(ticketRef),
      transaction.get(operationRef),
    ]);
    if (!ticketSnap.exists) {
      throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
    }
    const ticket = asRecord(ticketSnap.data());
    const billingVersion = Math.max(asInt(ticket.billingVersion, 0), 0);
    const stripeMode = safeString(ticket.stripeMode) === "live" ? "live" :
      safeString(ticket.stripeMode) === "test" ? "test" : null;
    const stripeInvoiceId = cleanNullable(safeString(ticket.stripeInvoiceId));
    const previousBillingStatus = safeString(ticket.billingStatus).trim();
    const finalChargeCents = Math.max(asInt(ticket.finalChargeCents, 0), 0);
    const refundedAmountCents = Math.max(asInt(ticket.refundedAmountCents, 0), 0);
    if (operationSnap.exists) {
      const operation = asRecord(operationSnap.data());
      if (safeString(operation.commandHash) !== commandHash) {
        throw new FiringBillingError(
          "IDEMPOTENCY_CONFLICT",
          "This request ID was already used for another adjustment.",
          409,
        );
      }
      if (!stripeMode || !stripeInvoiceId) {
        throw new FiringBillingError("INVOICE_BINDING_MISSING", "The firing invoice binding is incomplete.", 409);
      }
      const operationStatus = safeString(operation.status);
      if (operationStatus !== "completed") {
        if (isBillingOperationLeaseActive({
          status: operationStatus,
          updatedAtMs: toMillis(operation.updatedAt),
        })) {
          throw new FiringBillingError(
            "BILLING_OPERATION_IN_PROGRESS",
            "This billing adjustment is still processing. Refresh in a moment before retrying.",
            409,
          );
        }
        const resumedAt = nowTs();
        transaction.set(operationRef, {
          status: "in_progress",
          resumedAt,
          updatedAt: resumedAt,
          resumeCount: FieldValue.increment(1),
        }, { merge: true });
      }
      return {
        operationId,
        ticketId: input.ticketId,
        duplicate: true,
        completed: operationStatus === "completed",
        billingVersion,
        previousBillingStatus: safeString(operation.previousBillingStatus) || previousBillingStatus,
        stripeMode,
        stripeInvoiceId,
        finalChargeCents,
        refundedAmountCents,
        stripeRefundId: cleanNullable(safeString(operation.stripeRefundId)),
        stripeCreditNoteId: cleanNullable(safeString(operation.stripeCreditNoteId)),
        resultBillingStatus: cleanNullable(safeString(operation.result)),
      };
    }
    const activeAdjustmentOperationId = cleanNullable(safeString(ticket.activeAdjustmentOperationId));
    if (
      activeAdjustmentOperationId &&
      activeAdjustmentOperationId !== operationId &&
      ["adjustment_pending", "reconciliation_required"].includes(previousBillingStatus)
    ) {
      throw new FiringBillingError(
        "BILLING_OPERATION_REQUIRES_RESUME",
        "This ticket already has an adjustment that must be resumed or reconciled.",
        409,
      );
    }
    if (billingVersion !== input.expectedVersion) {
      throw new FiringBillingError(
        "TICKET_VERSION_CONFLICT",
        "This ticket changed after you opened it. Refresh before adjusting it.",
        409,
      );
    }
    if (!stripeMode || !stripeInvoiceId) {
      throw new FiringBillingError("INVOICE_BINDING_MISSING", "This ticket does not have a Stripe invoice.", 409);
    }
    const openStatuses = new Set(["invoice_open", "payment_failed", "adjustment_pending"]);
    const paidStatuses = new Set(["paid", "partially_refunded", "refund_failed"]);
    if (input.action === "void_invoice" && !openStatuses.has(previousBillingStatus)) {
      throw new FiringBillingError("INVOICE_NOT_VOIDABLE", "Only an open invoice can be voided.", 409);
    }
    if (input.action === "credit_open_invoice" && !openStatuses.has(previousBillingStatus)) {
      throw new FiringBillingError("INVOICE_NOT_CREDITABLE", "Only an open invoice can receive this credit.", 409);
    }
    if (input.action === "refund_paid_invoice" && !paidStatuses.has(previousBillingStatus)) {
      throw new FiringBillingError("INVOICE_NOT_REFUNDABLE", "Only a paid firing can be refunded.", 409);
    }
    if (input.action === "refund_paid_invoice" && input.amountCents > finalChargeCents - refundedAmountCents) {
      throw new FiringBillingError("REFUND_EXCEEDS_NET_PAID", "The refund exceeds the remaining paid amount.", 409);
    }
    const now = nowTs();
    transaction.create(operationRef, {
      operationId,
      operationType: "billing_adjustment",
      ticketId: input.ticketId,
      ticketVersion: billingVersion,
      commandHash,
      command: input,
      previousBillingStatus,
      stripeMode,
      stripeInvoiceId,
      status: "in_progress",
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorMode: actor.mode,
      createdAt: now,
      updatedAt: now,
      steps: { reserve: { status: "succeeded", at: now } },
    });
    transaction.set(ticketRef, {
      billingVersion: billingVersion + 1,
      billingStatus: "adjustment_pending",
      activeAdjustmentOperationId: operationId,
      privateStaffNote: cleanNullable(input.privateStaffNote) ?? ticket.privateStaffNote ?? null,
      updatedAt: now,
    }, { merge: true });
    transaction.create(ticketRef.collection("events").doc(`${operationId}-reserved`), {
      type: "billing_adjustment_reserved",
      operationId,
      action: input.action,
      amountCents: input.amountCents,
      actorUid: actor.uid,
      at: now,
    });
    return {
      operationId,
      ticketId: input.ticketId,
      duplicate: false,
      completed: false,
      billingVersion,
      previousBillingStatus,
      stripeMode,
      stripeInvoiceId,
      finalChargeCents,
      refundedAmountCents,
      stripeRefundId: null,
      stripeCreditNoteId: null,
      resultBillingStatus: null,
    };
  });
}

function adjustmentMetadata(
  reserved: ReservedAdjustment,
  input: StaffAdjustFiringBillingInput,
): Stripe.MetadataParam {
  return {
    source: "firing",
    firing_ticket_id: input.ticketId,
    billing_operation_id: reserved.operationId,
    adjustment_action: input.action,
  };
}

async function findInvoicePaymentSource(
  stripe: Stripe,
  invoiceId: string,
): Promise<{ paymentIntentId: string | null; chargeId: string | null }> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 10 });
  for (const row of payments.data) {
    const paymentIntent = row.payment.payment_intent;
    const charge = row.payment.charge;
    const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null;
    const chargeId = typeof charge === "string" ? charge : charge?.id ?? null;
    if (paymentIntentId || chargeId) return { paymentIntentId, chargeId };
  }
  throw new FiringBillingError(
    "INVOICE_PAYMENT_SOURCE_MISSING",
    "Stripe did not return a refundable payment for this invoice.",
    409,
  );
}

function makeAdjustmentMail(params: {
  ticketId: string;
  displayName: string;
  email: string;
  action: StaffAdjustFiringBillingInput["action"];
  amountCents: number;
  note: string | null;
  operationId: string;
}): Record<string, unknown> {
  const actionText = params.action === "void_invoice"
    ? "The firing invoice was canceled. There is no payment due on it."
    : params.action === "credit_open_invoice"
      ? `We corrected the open firing invoice by ${formatMoney(params.amountCents)}.`
      : `We issued a ${formatMoney(params.amountCents)} refund for this firing. Stripe will show the final refund status and timing.`;
  const noteText = params.note ? `\nStudio note:\n${params.note}\n` : "";
  const noteHtml = params.note
    ? `<div style="margin:18px 0;padding:14px 16px;border-left:4px solid #c45f3b;background:#fffaf4;"><strong>Studio note</strong><br>${htmlWithBreaks(params.note)}</div>`
    : "";
  return {
    to: params.email,
    replyTo: SUPPORT_EMAIL,
    message: {
      subject: `A billing update for firing ${params.ticketId}`,
      text: [
        `Hi ${params.displayName || "there"},`,
        "",
        actionText,
        noteText,
        `Ticket: ${params.ticketId}`,
        "Questions? Reply to this email.",
      ].join("\n"),
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#15110e;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#f8f0e5;"><tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;color:#f5ede2;"><h1 style="margin:0;font:600 26px Georgia,serif;">Firing billing update</h1></td></tr><tr><td style="padding:26px 28px;color:#271d17;font:15px/1.55 Arial,sans-serif;"><p style="font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(params.displayName || "there")},</p><p>${escapeHtml(actionText)}</p>${noteHtml}<p style="margin-top:22px;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font-size:12px;">Ticket: ${escapeHtml(params.ticketId)}<br>Questions? Reply to this email.</p></td></tr></table></td></tr></table></body></html>`,
    },
    source: "firing-billing-adjustment",
    ticketId: params.ticketId,
    billingOperationId: params.operationId,
    createdAt: nowTs(),
  };
}

async function completeAdjustment(params: {
  reserved: ReservedAdjustment;
  input: StaffAdjustFiringBillingInput;
  actor: StaffActor;
  billingStatus: string;
  stripeRefund: Stripe.Refund | null;
  stripeCreditNote: Stripe.CreditNote | null;
}) {
  const { reserved, input, actor } = params;
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId);
  const operationRef = db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId);
  const ticketSnap = await ticketRef.get();
  const ticket = asRecord(ticketSnap.data());
  const email = normalizeEmail(ticket.email);
  const displayName = safeString(ticket.displayName).trim();
  const mailRef = db.collection(MAIL_COLLECTION).doc(`${reserved.operationId}-artist`);
  const mail = email ? makeAdjustmentMail({
    ticketId: input.ticketId,
    displayName,
    email,
    action: input.action,
    amountCents: input.amountCents,
    note: cleanNullable(input.artistVisibleNote),
    operationId: reserved.operationId,
  }) : null;
  const now = nowTs();
  let completedBillingStatus = params.billingStatus;
  await db.runTransaction(async (transaction) => {
    const patch: Record<string, unknown> = {
      billingStatus: params.billingStatus,
      activeAdjustmentOperationId: null,
      lastAdjustmentAction: input.action,
      lastAdjustmentAmountCents: input.amountCents,
      artistVisibleAdjustmentNote: cleanNullable(input.artistVisibleNote),
      noticeStatus: mail ? "queued" : safeString(ticket.noticeStatus) || "not_queued",
      ...(mail ? {
        currentNoticeMailId: mailRef.id,
        lastAdjustmentMailId: mailRef.id,
      } : {}),
      updatedAt: now,
    };
    if (params.stripeRefund) {
      const refund = params.stripeRefund;
      const currentLedger = asRecord(ticket.refundLedger);
      const nextLedger = {
        ...currentLedger,
        [refund.id]: {
          amountCents: refund.amount,
          status: refund.status,
          failureReason: cleanNullable(safeString(refund.failure_reason)),
          operationId: reserved.operationId,
          updatedAt: new Date(refund.created * 1000).toISOString(),
        },
      };
      const refundedAmountCents = Object.values(nextLedger).reduce<number>((sum, value) => {
        const row = asRecord(value);
        return safeString(row.status) === "succeeded" ? sum + Math.max(asInt(row.amountCents, 0), 0) : sum;
      }, 0);
      patch.refundLedger = nextLedger;
      patch.refundedAmountCents = refundedAmountCents;
      patch.stripeRefundIds = FieldValue.arrayUnion(refund.id);
      patch.billingStatus = refund.status === "failed" ? "refund_failed" :
        refund.status === "succeeded" && refundedAmountCents >= reserved.finalChargeCents
          ? "refunded"
          : refund.status === "succeeded" ? "partially_refunded" : "adjustment_pending";
    }
    if (params.stripeCreditNote) {
      patch.stripeCreditNoteIds = FieldValue.arrayUnion(params.stripeCreditNote.id);
    }
    completedBillingStatus = safeString(patch.billingStatus) || params.billingStatus;
    transaction.set(ticketRef, patch, { merge: true });
    transaction.set(operationRef, {
      status: "completed",
      result: patch.billingStatus,
      stripeRefundId: params.stripeRefund?.id ?? null,
      stripeCreditNoteId: params.stripeCreditNote?.id ?? null,
      completedAt: now,
      updatedAt: now,
    }, { merge: true });
    if (mail) transaction.set(mailRef, mail);
    transaction.create(ticketRef.collection("events").doc(`${reserved.operationId}-completed`), {
      type: "billing_adjustment_completed",
      operationId: reserved.operationId,
      action: input.action,
      amountCents: input.amountCents,
      billingStatus: patch.billingStatus,
      actorUid: actor.uid,
      at: now,
    });
  });
  return {
    ticketId: input.ticketId,
    operationId: reserved.operationId,
    action: input.action,
    billingStatus: completedBillingStatus,
    amountCents: input.amountCents,
    stripeRefundId: params.stripeRefund?.id ?? null,
    stripeCreditNoteId: params.stripeCreditNote?.id ?? null,
    noticeQueued: Boolean(mail),
    duplicate: reserved.duplicate,
  };
}

async function runFiringAdjustment(
  input: StaffAdjustFiringBillingInput,
  actor: StaffActor,
  runtime: FiringBillingRuntime,
) {
  assertBillableRuntime(runtime);
  await assertStripeWebhookWriteReady(runtime);
  const reserved = await reserveAdjustment(input, actor);
  if (reserved.stripeMode !== runtime.stripeMode) {
    throw new FiringBillingError(
      "STRIPE_MODE_MISMATCH",
      "The active Stripe mode does not match this invoice.",
      409,
    );
  }
  if (reserved.completed) {
    return {
      ticketId: input.ticketId,
      operationId: reserved.operationId,
      action: input.action,
      billingStatus: reserved.resultBillingStatus ?? reserved.previousBillingStatus,
      amountCents: input.amountCents,
      stripeRefundId: reserved.stripeRefundId,
      stripeCreditNoteId: reserved.stripeCreditNoteId,
      noticeQueued: true,
      duplicate: true,
    };
  }
  const stripe = getStripeClient(reserved.stripeMode);
  const metadata = adjustmentMetadata(reserved, input);
  try {
    if (input.action === "void_invoice") {
      const invoice = await stripe.invoices.voidInvoice(
        reserved.stripeInvoiceId,
        {},
        { idempotencyKey: `firing-ticket:${input.ticketId}:void:${reserved.operationId}` },
      );
      if (invoice.status !== "void") {
        throw new FiringBillingError("INVOICE_VOID_MISMATCH", "Stripe did not return a void invoice.", 502);
      }
      return completeAdjustment({
        reserved,
        input,
        actor,
        billingStatus: "void",
        stripeRefund: null,
        stripeCreditNote: null,
      });
    }

    const invoice = await stripe.invoices.retrieve(reserved.stripeInvoiceId);
    if (input.action === "credit_open_invoice") {
      if (invoice.status !== "open" || input.amountCents > invoice.amount_remaining) {
        throw new FiringBillingError(
          "OPEN_CREDIT_EXCEEDS_BALANCE",
          "The credit exceeds this invoice's open balance.",
          409,
        );
      }
      const creditNote = await stripe.creditNotes.create({
        invoice: reserved.stripeInvoiceId,
        amount: input.amountCents,
        email_type: "none",
        reason: "order_change",
        memo: input.reason,
        metadata,
      }, { idempotencyKey: `firing-ticket:${input.ticketId}:credit:${reserved.operationId}` });
      await recordOperationStep(reserved.operationId, "credit_note", { stripeCreditNoteId: creditNote.id });
      const nextInvoice = await stripe.invoices.retrieve(reserved.stripeInvoiceId);
      return completeAdjustment({
        reserved,
        input,
        actor,
        billingStatus: nextInvoice.status === "paid" ? "paid" : "invoice_open",
        stripeRefund: null,
        stripeCreditNote: creditNote,
      });
    }

    if (invoice.status !== "paid" || input.amountCents > invoice.amount_paid - reserved.refundedAmountCents) {
      throw new FiringBillingError(
        "REFUND_EXCEEDS_STRIPE_PAYMENT",
        "The refund exceeds the invoice's remaining paid amount.",
        409,
      );
    }
    const paymentSource = await findInvoicePaymentSource(stripe, reserved.stripeInvoiceId);
    let refund: Stripe.Refund;
    if (reserved.stripeRefundId) {
      refund = await stripe.refunds.retrieve(reserved.stripeRefundId);
    } else {
      refund = await stripe.refunds.create({
        amount: input.amountCents,
        payment_intent: paymentSource.paymentIntentId ?? undefined,
        charge: paymentSource.paymentIntentId ? undefined : paymentSource.chargeId ?? undefined,
        reason: "requested_by_customer",
        metadata,
      }, { idempotencyKey: `firing-ticket:${input.ticketId}:refund:${reserved.operationId}` });
      await recordOperationStep(reserved.operationId, "refund", { stripeRefundId: refund.id });
    }
    let creditNote: Stripe.CreditNote;
    if (reserved.stripeCreditNoteId) {
      creditNote = await stripe.creditNotes.retrieve(reserved.stripeCreditNoteId);
    } else {
      creditNote = await stripe.creditNotes.create({
        invoice: reserved.stripeInvoiceId,
        amount: input.amountCents,
        refunds: [{ type: "refund", refund: refund.id, amount_refunded: input.amountCents }],
        email_type: "none",
        reason: "order_change",
        memo: input.reason,
        metadata,
      }, { idempotencyKey: `firing-ticket:${input.ticketId}:refund-credit:${reserved.operationId}` });
      await recordOperationStep(reserved.operationId, "credit_note", { stripeCreditNoteId: creditNote.id });
    }
    return completeAdjustment({
      reserved,
      input,
      actor,
      billingStatus: refund.status === "succeeded" ? "partially_refunded" : "adjustment_pending",
      stripeRefund: refund,
      stripeCreditNote: creditNote,
    });
  } catch (error) {
    const now = nowTs();
    await Promise.all([
      db.collection(BILLING_OPERATIONS_COLLECTION).doc(reserved.operationId).set({
        status: "reconciliation_required",
        failureMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        failedAt: now,
        updatedAt: now,
      }, { merge: true }),
      db.collection(FIRING_TICKETS_COLLECTION).doc(input.ticketId).set({
        billingStatus: "reconciliation_required",
        updatedAt: now,
      }, { merge: true }),
    ]);
    if (error instanceof FiringBillingError) throw error;
    throw new FiringBillingError(
      "FIRING_ADJUSTMENT_RECONCILIATION_REQUIRED",
      "The Stripe adjustment needs reconciliation before another attempt.",
      502,
    );
  }
}

export const staffAdjustFiringBilling = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffAdjustFiringBillingSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    const rate = await enforceRateLimit({ req, key: "staffAdjustFiringBilling", max: 12, windowMs: 60_000 });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many adjustment requests" });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const runtime = runtimeFromConfig(await loadStripeConfig());
      const result = await runFiringAdjustment(parsed.data, staff.actor, runtime);
      res.status(200).json({ ok: true, data: result });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffAdjustFiringBilling failed", {
        code: billingError?.code ?? "FIRING_ADJUSTMENT_INTERNAL",
        message: error instanceof Error ? error.message : String(error),
        ticketId: parsed.data.ticketId,
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_ADJUSTMENT_INTERNAL",
        message: billingError?.message ?? "Unable to adjust this firing invoice",
      });
    }
  },
);

const resumeBillingOperationSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  operationId: z.string().trim().min(5).max(180),
}).strict();

export const staffResumeFiringBillingOperation = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 60, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(resumeBillingOperationSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    const rate = await enforceRateLimit({
      req,
      key: "staffResumeFiringBillingOperation",
      max: 12,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many resume requests" });
      return;
    }
    try {
      const operationSnap = await db
        .collection(BILLING_OPERATIONS_COLLECTION)
        .doc(parsed.data.operationId)
        .get();
      if (!operationSnap.exists) {
        res.status(404).json({ ok: false, message: "Billing operation not found" });
        return;
      }
      const operation = asRecord(operationSnap.data());
      if (safeString(operation.ticketId) !== parsed.data.ticketId) {
        res.status(409).json({ ok: false, message: "Billing operation does not match this ticket" });
        return;
      }
      const runtime = runtimeFromConfig(await loadStripeConfig());
      const operationType = safeString(operation.operationType);
      if (operationType === "pickup_finalization") {
        const command = staffFinalizeFiringPickupSchema.parse(operation.command);
        const expectedOperationId = makeIdempotencyId(
          "firing-billing",
          command.ticketId,
          command.clientRequestId,
        );
        if (expectedOperationId !== parsed.data.operationId) {
          throw new FiringBillingError(
            "BILLING_OPERATION_ID_MISMATCH",
            "Stored pickup billing operation failed its idempotency check.",
            409,
          );
        }
        const result = await runFiringPickupBillingSaga(command, staff.actor, runtime);
        res.status(200).json({
          ok: true,
          data: {
            operationType,
            result: publicFinalizationResult(result),
          },
        });
        return;
      }
      if (operationType === "billing_adjustment") {
        const command = staffAdjustFiringBillingSchema.parse(operation.command);
        const expectedOperationId = makeIdempotencyId(
          "firing-adjustment",
          command.ticketId,
          command.clientRequestId,
        );
        if (expectedOperationId !== parsed.data.operationId) {
          throw new FiringBillingError(
            "BILLING_OPERATION_ID_MISMATCH",
            "Stored billing adjustment failed its idempotency check.",
            409,
          );
        }
        const result = await runFiringAdjustment(command, staff.actor, runtime);
        res.status(200).json({ ok: true, data: { operationType, result } });
        return;
      }
      res.status(409).json({ ok: false, message: "Unsupported firing billing operation" });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffResumeFiringBillingOperation failed", {
        code: billingError?.code ?? "FIRING_BILLING_RESUME_INTERNAL",
        message: error instanceof Error ? error.message : String(error),
        ticketId: parsed.data.ticketId,
        operationId: parsed.data.operationId,
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_BILLING_RESUME_INTERNAL",
        message: billingError?.message ?? "Unable to resume this firing billing operation",
      });
    }
  },
);

export const staffDeleteFiringTicket = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffDeleteFiringTicketSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffDeleteFiringTicket", max: 12, windowMs: 60_000 });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many ticket deletion requests" });
        return;
      }
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
      const eventId = makeIdempotencyId("firing-ticket-delete", parsed.data.ticketId, parsed.data.clientRequestId);
      const eventRef = ticketRef.collection("events").doc(eventId);
      const result = await db.runTransaction(async (transaction) => {
        const [ticketSnap, eventSnap] = await Promise.all([
          transaction.get(ticketRef),
          transaction.get(eventRef),
        ]);
        if (!ticketSnap.exists) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
        const ticket = asRecord(ticketSnap.data());
        if (eventSnap.exists || ticket.deletedAt) return { duplicate: true };
        const billingStatus = safeString(ticket.billingStatus).trim();
        if (ticket.stripeInvoiceId || ["invoice_open", "payment_failed", "paid", "partially_refunded", "refunded"].includes(billingStatus)) {
          throw new FiringBillingError(
            "TICKET_HAS_BILLING_HISTORY",
            "This ticket has an invoice or payment history. Cancel or refund the billing record before deleting it.",
            409,
          );
        }
        if (safeString(ticket.status).trim() === "picked_up") {
          throw new FiringBillingError("TICKET_ALREADY_PICKED_UP", "Picked-up tickets stay in the studio history and cannot be deleted.", 409);
        }
        const now = nowTs();
        transaction.set(ticketRef, {
          status: "deleted",
          deletedAt: now,
          deletedByUid: staff.actor.uid,
          updatedAt: now,
        }, { merge: true });
        transaction.create(eventRef, {
          type: "firing_ticket_deleted",
          actorUid: staff.actor.uid,
          at: now,
        });
        return { duplicate: false };
      });
      res.status(200).json({ ok: true, data: { ticketId: parsed.data.ticketId, ...result } });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffDeleteFiringTicket failed", {
        ticketId: parsed.data.ticketId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_TICKET_DELETE_FAILED",
        message: billingError?.message ?? "Unable to delete this firing ticket",
      });
    }
  },
);

const resendNoticeSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  clientRequestId: z.string().uuid(),
}).strict();

export const staffDeleteFiringTicketSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  clientRequestId: z.string().uuid(),
}).strict();

export const staffResendFiringInvoiceSchema = resendNoticeSchema;

const receiptPrintRequestSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  clientRequestId: z.string().uuid(),
  action: z.enum(["retry", "reprint"]),
}).strict();

export const workSlipPrintRequestSchema = z.object({
  ticketId: z.string().trim().min(5).max(80),
  clientRequestId: z.string().uuid(),
  action: z.enum(["original", "reprint"]),
}).strict();

type WorkSlipPrintAction = z.infer<typeof workSlipPrintRequestSchema>["action"];

/**
 * Keep the work-slip queue single-flight. A CUPS result is the only authority
 * that may move a completed original into an eligible reprint.
 */
export function assertWorkSlipPrintActionAllowed(
  action: WorkSlipPrintAction,
  currentStatus: string,
): void {
  if (action === "reprint" && currentStatus !== "printed") {
    throw new FiringBillingError(
      "WORK_SLIP_NOT_PRINTED",
      "This work slip has not completed its first thermal print yet.",
      409,
    );
  }
  if (action === "original" && ["queued", "submitting", "accepted"].includes(currentStatus)) {
    throw new FiringBillingError(
      "WORK_SLIP_ALREADY_QUEUED",
      "This work slip is already queued for the studio thermal printer.",
      409,
    );
  }
  if (action === "original" && currentStatus === "printed") {
    throw new FiringBillingError(
      "WORK_SLIP_REPRINT_REQUIRED",
      "Use reprint after the first thermal work slip has completed.",
      409,
    );
  }
}

export function queuedWorkSlipPrintState(input: {
  current: Record<string, unknown>;
  action: WorkSlipPrintAction;
  actorUid: string;
  queuedAt: unknown;
}) {
  return {
    ...input.current,
    status: "queued",
    queuedAt: input.queuedAt,
    queuedByUid: input.actorUid,
    queueReason: input.action,
    attempts: 0,
    lastError: null,
    // A prior completed CUPS job is not the job now awaiting print.
    cupsJobId: null,
    reprintCount: asInt(input.current.reprintCount, 0) + (input.action === "reprint" ? 1 : 0),
  };
}

export const staffQueueFiringWorkSlipPrint = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(workSlipPrintRequestSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffQueueFiringWorkSlipPrint", max: 20, windowMs: 60_000 });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many work slip print requests" });
        return;
      }
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
      const eventId = makeIdempotencyId("firing-work-slip-print", parsed.data.ticketId, parsed.data.clientRequestId);
      const eventRef = ticketRef.collection("events").doc(eventId);
      const result = await db.runTransaction(async (transaction) => {
        const [ticketSnap, eventSnap] = await Promise.all([transaction.get(ticketRef), transaction.get(eventRef)]);
        if (!ticketSnap.exists) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
        if (eventSnap.exists) return { duplicate: true, status: "queued" };

        const ticket = asRecord(ticketSnap.data());
        const current = asRecord(ticket.workSlipPrint);
        const currentStatus = safeString(current.status).trim();
        assertWorkSlipPrintActionAllowed(parsed.data.action, currentStatus);

        const now = nowTs();
        transaction.set(ticketRef, {
          workSlipPrint: queuedWorkSlipPrintState({
            current,
            action: parsed.data.action,
            actorUid: staff.actor.uid,
            queuedAt: now,
          }),
          updatedAt: now,
        }, { merge: true });
        transaction.create(eventRef, {
          type: parsed.data.action === "reprint" ? "work_slip_reprint_queued" : "work_slip_original_queued",
          actorUid: staff.actor.uid,
          previousStatus: currentStatus || null,
          at: now,
        });
        return { duplicate: false, status: "queued" };
      });
      res.status(200).json({ ok: true, data: { ticketId: parsed.data.ticketId, ...result } });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffQueueFiringWorkSlipPrint failed", {
        ticketId: parsed.data.ticketId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "WORK_SLIP_PRINT_QUEUE_FAILED",
        message: billingError?.message ?? "Unable to queue the thermal work slip",
      });
    }
  },
);

export const staffQueueFiringReceiptPrint = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(receiptPrintRequestSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffQueueFiringReceiptPrint", max: 20, windowMs: 60_000 });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many receipt print requests" });
        return;
      }
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
      const eventId = makeIdempotencyId("firing-receipt-print", parsed.data.ticketId, parsed.data.clientRequestId);
      const eventRef = ticketRef.collection("events").doc(eventId);
      const result = await db.runTransaction(async (transaction) => {
        const [ticketSnap, eventSnap] = await Promise.all([transaction.get(ticketRef), transaction.get(eventRef)]);
        if (!ticketSnap.exists) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
        const ticket = asRecord(ticketSnap.data());
        const billingStatus = safeString(ticket.billingStatus).trim();
        if (billingStatus !== "paid") {
          throw new FiringBillingError(
            "RECEIPT_PRINT_NOT_AVAILABLE",
            "Paper payment receipts are available only for fully paid, non-refunded firings.",
            409,
          );
        }
        if (eventSnap.exists) return { duplicate: true, status: "queued" };
        const current = asRecord(ticket.stripeReceiptPrint);
        const currentStatus = safeString(current.status).trim();
        if (parsed.data.action === "reprint" && currentStatus !== "printed") {
          throw new FiringBillingError("RECEIPT_NOT_PRINTED", "This receipt has not completed its first print yet.", 409);
        }
        if (parsed.data.action === "retry" && !["needs_review", "failed", "submitting", "accepted"].includes(currentStatus)) {
          throw new FiringBillingError("RECEIPT_NOT_RETRYABLE", "This receipt is not waiting for a manual retry.", 409);
        }
        const now = nowTs();
        transaction.set(ticketRef, {
          stripeReceiptPrint: {
            ...current,
            status: "queued",
            queuedAt: now,
            queuedByUid: staff.actor.uid,
            queueReason: parsed.data.action,
            lastError: null,
            reprintCount: asInt(current.reprintCount, 0) + (parsed.data.action === "reprint" ? 1 : 0),
          },
          updatedAt: now,
        }, { merge: true });
        transaction.create(eventRef, {
          type: parsed.data.action === "reprint" ? "payment_receipt_reprint_queued" : "payment_receipt_retry_queued",
          actorUid: staff.actor.uid,
          previousStatus: currentStatus || null,
          at: now,
        });
        return { duplicate: false, status: "queued" };
      });
      res.status(200).json({ ok: true, data: { ticketId: parsed.data.ticketId, ...result } });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffQueueFiringReceiptPrint failed", {
        ticketId: parsed.data.ticketId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "RECEIPT_PRINT_QUEUE_FAILED",
        message: billingError?.message ?? "Unable to queue the payment receipt",
      });
    }
  },
);

export const staffResendFiringPaidReceipt = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(resendNoticeSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffResendFiringPaidReceipt", max: 20, windowMs: 60_000 });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many receipt email requests" });
        return;
      }
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
      const ticketSnap = await ticketRef.get();
      if (!ticketSnap.exists) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
      const ticket = asRecord(ticketSnap.data());
      const billingStatus = safeString(ticket.billingStatus).trim();
      if (!["paid", "partially_refunded", "refunded"].includes(billingStatus)) {
        throw new FiringBillingError("PAID_RECEIPT_NOT_AVAILABLE", "This firing does not have a completed payment yet.", 409);
      }
      const email = normalizeEmail(ticket.email);
      if (!email) throw new FiringBillingError("TICKET_CONTACT_MISSING", "This ticket has no artist email.", 409);
      const operationId = cleanNullable(safeString(ticket.billingOperationId));
      const operationSnap = operationId
        ? await db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId).get()
        : null;
      const operation = asRecord(operationSnap?.data());
      const hostedInvoiceUrl = cleanNullable(safeString(ticket.hostedInvoiceUrl)) ??
        cleanNullable(safeString(operation.hostedInvoiceUrl));
      if (!hostedInvoiceUrl) throw new FiringBillingError("PAID_INVOICE_LINK_MISSING", "Stripe's paid invoice link needs studio review.", 409);
      const mailId = makeIdempotencyId("firing-paid-receipt", parsed.data.ticketId, parsed.data.clientRequestId);
      const mailRef = db.collection(MAIL_COLLECTION).doc(mailId);
      const now = nowTs();
      const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(mailRef);
        if (existing.exists) return { duplicate: true, receiptMailStatus: "queued" };
        transaction.create(mailRef, {
          ...makePaidReceiptMail({
            ticketId: parsed.data.ticketId,
            displayName: safeString(ticket.displayName).trim(),
            email,
            amountCents: Math.max(asInt(ticket.invoiceAmountPaidCents, asInt(ticket.finalChargeCents, 0)), 0),
            hostedInvoiceUrl,
            requestedAt: now,
          }),
          requestedByUid: staff.actor.uid,
        });
        transaction.set(ticketRef, {
          currentReceiptMailId: mailId,
          receiptMailStatus: "queued",
          updatedAt: now,
        }, { merge: true });
        transaction.create(ticketRef.collection("events").doc(mailId), {
          type: "paid_receipt_resent_by_staff",
          mailId,
          actorUid: staff.actor.uid,
          at: now,
        });
        return { duplicate: false, receiptMailStatus: "queued" };
      });
      res.status(200).json({ ok: true, data: { ticketId: parsed.data.ticketId, ...result } });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffResendFiringPaidReceipt failed", {
        ticketId: parsed.data.ticketId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "PAID_RECEIPT_RESEND_FAILED",
        message: billingError?.message ?? "Unable to email the paid invoice",
      });
    }
  },
);

export const staffResendFiringInvoice = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(staffResendFiringInvoiceSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
      const rate = await enforceRateLimit({ req, key: "staffResendFiringInvoice", max: 20, windowMs: 60_000 });
      if (!rate.ok) {
        res.status(429).json({ ok: false, message: "Too many invoice email requests" });
        return;
      }
      const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
      const ticketSnap = await ticketRef.get();
      if (!ticketSnap.exists) throw new FiringBillingError("TICKET_NOT_FOUND", "Firing ticket not found.", 404);
      const ticket = asRecord(ticketSnap.data());
      if (ticket.deletedAt) throw new FiringBillingError("TICKET_DELETED", "Deleted firing tickets cannot send email.", 409);
      const billingStatus = safeString(ticket.billingStatus).trim();
      const allowedStatuses = new Set(["invoice_open", "payment_failed", "paid", "partially_refunded", "refunded"]);
      if (!allowedStatuses.has(billingStatus)) {
        throw new FiringBillingError("INVOICE_NOT_AVAILABLE", "This ticket does not have an invoice that can be resent.", 409);
      }
      const email = normalizeEmail(ticket.email);
      if (!email) throw new FiringBillingError("TICKET_CONTACT_MISSING", "This ticket has no artist email.", 409);
      const operationId = cleanNullable(safeString(ticket.billingOperationId));
      const operationSnap = operationId
        ? await db.collection(BILLING_OPERATIONS_COLLECTION).doc(operationId).get()
        : null;
      const operation = asRecord(operationSnap?.data());
      const hostedInvoiceUrl = safeStripeHostedUrl(ticket.hostedInvoiceUrl) ?? safeStripeHostedUrl(operation.hostedInvoiceUrl);
      if (!hostedInvoiceUrl) throw new FiringBillingError("INVOICE_LINK_MISSING", "Stripe's current invoice link needs studio review.", 409);
      const mailId = makeIdempotencyId("firing-invoice-resend", parsed.data.ticketId, parsed.data.clientRequestId);
      const mailRef = db.collection(MAIL_COLLECTION).doc(mailId);
      const now = nowTs();
      const result = await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(mailRef);
        if (existing.exists) return { duplicate: true, invoiceMailStatus: "queued" };
        transaction.create(mailRef, makeFiringInvoiceMail({
          ticketId: parsed.data.ticketId,
          displayName: safeString(ticket.displayName).trim(),
          email,
          amountCents: Math.max(asInt(ticket.invoiceAmountPaidCents, asInt(ticket.finalChargeCents, 0)), 0),
          hostedInvoiceUrl,
          paid: ["paid", "partially_refunded", "refunded"].includes(billingStatus),
          requestedAt: now,
        }));
        transaction.set(ticketRef, {
          currentInvoiceMailId: mailId,
          invoiceMailStatus: "queued",
          updatedAt: now,
        }, { merge: true });
        transaction.create(ticketRef.collection("events").doc(mailId), {
          type: "firing_invoice_resent_by_staff",
          mailId,
          actorUid: staff.actor.uid,
          at: now,
        });
        return { duplicate: false, invoiceMailStatus: "queued" };
      });
      res.status(200).json({ ok: true, data: { ticketId: parsed.data.ticketId, ...result } });
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      logger.error("staffResendFiringInvoice failed", {
        ticketId: parsed.data.ticketId,
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(billingError?.httpStatus ?? 500).json({
        ok: false,
        code: billingError?.code ?? "FIRING_INVOICE_RESEND_FAILED",
        message: billingError?.message ?? "Unable to email the firing invoice",
      });
    }
  },
);

export async function handleRequestFiringPickupDetails(req: RequestLike, res: ResponseLike): Promise<void> {
  setPublicPickupDetailsHeaders(res);
  const token = pickupDetailsTokenFromPath(req.path);
  if (!token) {
    res.status(404).send("Not Found");
    return;
  }
  const method = (req.method ?? "").toUpperCase();
  if (method === "GET") {
    const tokenHash = pickupDetailsTokenHash(token);
    const tokenRef = db.collection(PICKUP_DETAILS_TOKENS_COLLECTION).doc(tokenHash);
    const tokenSnap = await tokenRef.get();
    const tokenData = asRecord(tokenSnap.data());
    const ticketId = safeString(tokenData.ticketId).trim();
    if (!tokenSnap.exists || !ticketId || asInt(tokenData.expiresAtMs, 0) <= Date.now()) {
      res.status(404).send(pickupDetailsResultHtml(false));
      return;
    }
    let runtime: FiringBillingRuntime;
    try {
      runtime = runtimeFromConfig(await loadStripeConfig());
    } catch {
      res.status(503).send(pickupDetailsResultHtml(false));
      return;
    }
    const ticketSnap = await db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId).get();
    const ticket = asRecord(ticketSnap.data());
    const email = normalizeEmail(ticket.email);
    if (!ticketSnap.exists || safeString(ticket.status).trim() !== "ready_for_pickup" ||
      !email || pickupDetailsTokenHash(email) !== safeString(tokenData.recipientEmailHash)) {
      res.status(404).send(pickupDetailsResultHtml(false));
      return;
    }
    const heat = readTicketHeat(ticket);
    res.status(200).send(pickupDetailsHandoffHtml({
      token,
      ticketId,
      billingStatus: safeString(ticket.billingStatus).trim() || "unbilled",
      finalChargeCents: Math.max(asInt(ticket.finalChargeCents, asInt(ticket.invoiceAmountDueCents, 0)), 0),
      hostedInvoiceUrl: cleanNullable(safeString(ticket.hostedInvoiceUrl)),
      pickupInstructions: runtime.pickupInstructions,
      isLowFire: heat.id.trim().toLowerCase().startsWith("low") || heat.label.trim().toLowerCase().startsWith("low"),
    }));
    return;
  }
  if (method !== "POST") {
    res.set("Allow", "GET, POST");
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rate = await enforceRateLimit({ req, key: "requestFiringPickupDetails", max: 12, windowMs: 60 * 60 * 1000 });
  if (!rate.ok) {
    res.status(429).send(pickupDetailsResultHtml(false));
    return;
  }

  const tokenHash = pickupDetailsTokenHash(token);
  const tokenRef = db.collection(PICKUP_DETAILS_TOKENS_COLLECTION).doc(tokenHash);
  const tokenSnap = await tokenRef.get();
  const tokenData = asRecord(tokenSnap.data());
  const ticketId = safeString(tokenData.ticketId).trim();
  const expiresAtMs = asInt(tokenData.expiresAtMs, 0);
  if (!tokenSnap.exists || !ticketId || expiresAtMs <= Date.now()) {
    res.status(404).send(pickupDetailsResultHtml(false));
    return;
  }

  let runtime: FiringBillingRuntime;
  try {
    runtime = runtimeFromConfig(await loadStripeConfig());
  } catch {
    res.status(503).send(pickupDetailsResultHtml(false));
    return;
  }
  const bucket = Math.floor(Date.now() / PICKUP_DETAILS_RESEND_WINDOW_MS);
  const mailRef = db.collection(MAIL_COLLECTION).doc(`pickup-details-${tokenHash.slice(0, 24)}-${bucket}`);
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId);
  const now = nowTs();
  const result = await db.runTransaction(async (transaction) => {
    const [currentTokenSnap, ticketSnap, mailSnap] = await Promise.all([
      transaction.get(tokenRef),
      transaction.get(ticketRef),
      transaction.get(mailRef),
    ]);
    const currentToken = asRecord(currentTokenSnap.data());
    const ticket = asRecord(ticketSnap.data());
    const email = normalizeEmail(ticket.email);
    if (!currentTokenSnap.exists || !ticketSnap.exists ||
      asInt(currentToken.expiresAtMs, 0) <= Date.now() ||
      safeString(ticket.status).trim() !== "ready_for_pickup" ||
      !email || pickupDetailsTokenHash(email) !== safeString(currentToken.recipientEmailHash)) {
      return false;
    }
    if (!mailSnap.exists) {
      transaction.create(mailRef, makePickupDirectionsMail({
        ticketId,
        displayName: safeString(ticket.displayName).trim(),
        email,
        runtime,
        requestedAt: now,
      }));
      transaction.create(ticketRef.collection("events").doc(mailRef.id), {
        type: "pickup_details_requested_by_artist",
        mailId: mailRef.id,
        pickupInstructionsVersion: runtime.pickupInstructionsVersion,
        at: now,
      });
    }
    transaction.set(tokenRef, {
      requestCount: asInt(currentToken.requestCount, 0) + 1,
      lastRequestedAt: now,
      lastRequestBucket: bucket,
    }, { merge: true });
    return true;
  });
  res.status(result ? 200 : 404).send(pickupDetailsResultHtml(result));
}

export const requestFiringPickupDetails = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (req, res) => handleRequestFiringPickupDetails(req, res),
);

export const staffResendFiringPickupNotice = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const staff = await requireFiringBillingStaff(req);
    if (!staff.ok) {
      res.status(staff.status).json({ ok: false, message: staff.message });
      return;
    }
    const parsed = parseBody(resendNoticeSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    try {
      assertClientRequestHeaderMatches(req, parsed.data.clientRequestId);
    } catch (error) {
      const billingError = error instanceof FiringBillingError ? error : null;
      res.status(billingError?.httpStatus ?? 400).json({
        ok: false,
        code: billingError?.code ?? "IDEMPOTENCY_HEADER_MISMATCH",
        message: billingError?.message ?? "Invalid idempotency header",
      });
      return;
    }
    const rate = await enforceRateLimit({
      req,
      key: "staffResendFiringPickupNotice",
      max: 20,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.status(429).json({ ok: false, message: "Too many pickup email requests" });
      return;
    }
    const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(parsed.data.ticketId);
    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      res.status(404).json({ ok: false, message: "Firing ticket not found" });
      return;
    }
    const ticket = asRecord(ticketSnap.data());
    const originalMailId = cleanNullable(safeString(ticket.pickupMailId));
    if (!canResendFiringPickupNotice({ status: ticket.status, pickupMailId: originalMailId })) {
      res.status(409).json({ ok: false, message: "Pickup details can only be resent while the work is ready for pickup" });
      return;
    }
    let runtime: FiringBillingRuntime;
    try {
      runtime = runtimeFromConfig(await loadStripeConfig());
    } catch {
      res.status(503).json({ ok: false, message: "Current pickup instructions are unavailable" });
      return;
    }
    const resendId = makeIdempotencyId("firing-resend", parsed.data.ticketId, parsed.data.clientRequestId);
    const mailRef = db.collection(MAIL_COLLECTION).doc(resendId);
    const now = nowTs();
    const resendResult = await db.runTransaction(async (transaction) => {
      const [currentTicketSnap, resendSnap] = await Promise.all([
        transaction.get(ticketRef),
        transaction.get(mailRef),
      ]);
      if (resendSnap.exists) {
        return {
          duplicate: true,
          noticeStatus: safeString(currentTicketSnap.data()?.noticeStatus).trim() || "queued",
        };
      }
      const currentTicket = asRecord(currentTicketSnap.data());
      if (!canResendFiringPickupNotice({ status: currentTicket.status, pickupMailId: originalMailId })) {
        throw new FiringBillingError("TICKET_NOT_READY_FOR_PICKUP", "Pickup details can only be resent while the work is ready for pickup", 409);
      }
      const email = normalizeEmail(currentTicket.email);
      if (!email) throw new FiringBillingError("TICKET_CONTACT_MISSING", "This ticket has no email for pickup details", 409);
      transaction.create(mailRef, {
        ...makePickupDirectionsMail({
          ticketId: parsed.data.ticketId,
          displayName: safeString(currentTicket.displayName).trim(),
          email,
          runtime,
          requestedAt: now,
        }),
        originalMailId,
        requestedByUid: staff.actor.uid,
      });
      transaction.set(ticketRef, {
        noticeStatus: "queued",
        pickupMailId: resendId,
        currentNoticeMailId: resendId,
        updatedAt: now,
      }, { merge: true });
      transaction.set(ticketRef.collection("events").doc(resendId), {
        type: "pickup_details_resent_by_staff",
        mailId: resendId,
        actorUid: staff.actor.uid,
        at: now,
      });
      return { duplicate: false, noticeStatus: "queued" };
    });
    res.status(200).json({
      ok: true,
      data: {
        ticketId: parsed.data.ticketId,
        noticeStatus: resendResult.noticeStatus,
        duplicate: resendResult.duplicate,
      },
    });
  },
);

export const onFiringMailDeliveryUpdated = onDocumentWritten(
  { region: REGION, document: "mail/{mailId}" },
  async (event) => {
    const before = asRecord(event.data?.before.data());
    const after = asRecord(event.data?.after.data());
    if (!event.data?.after.exists || Object.keys(after).length === 0) return;

    const beforeDelivery = asRecord(before.delivery);
    const afterDelivery = asRecord(after.delivery);
    const transition = deriveFiringMailDeliveryTransition({
      source: after.source,
      beforeState: beforeDelivery.state,
      afterState: afterDelivery.state,
    });
    if (!transition) return;

    const ticketId = safeString(after.ticketId).trim();
    const mailId = safeString(event.params.mailId).trim();
    if (!ticketId || !mailId) {
      logger.warn("Firing mail delivery ignored: missing ticket or mail binding", {
        mailId: mailId || null,
        source: safeString(after.source).trim() || null,
      });
      return;
    }

    const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId);
    await db.runTransaction(async (transaction) => {
      const ticketSnap = await transaction.get(ticketRef);
      if (!ticketSnap.exists) {
        logger.warn("Firing mail delivery ignored: ticket not found", { ticketId, mailId });
        return;
      }
      const ticket = asRecord(ticketSnap.data());
      if (safeString(after.source).trim() === "firing-paid-receipt-resend") {
        if (safeString(ticket.currentReceiptMailId).trim() !== mailId) {
          logger.info("Paid receipt delivery ignored: a newer receipt email owns the ticket", { ticketId, mailId });
          return;
        }
        const now = nowTs();
        transaction.set(ticketRef, {
          receiptMailStatus: transition.noticeStatus,
          receiptMailDeliveryState: transition.deliveryState,
          receiptMailDeliveredAt: transition.noticeStatus === "sent" ? now : null,
          receiptMailFailedAt: transition.noticeStatus === "failed" ? now : null,
          updatedAt: now,
        }, { merge: true });
        transaction.set(ticketRef.collection("events").doc(`${mailId}-delivery`), {
          type: transition.noticeStatus === "sent" ? "paid_receipt_email_sent" : "paid_receipt_email_failed",
          mailId,
          deliveryState: transition.deliveryState,
          at: now,
        });
        return;
      }
      if (safeString(after.source).trim() === "firing-invoice-resend") {
        if (safeString(ticket.currentInvoiceMailId).trim() !== mailId) {
          logger.info("Invoice delivery ignored: a newer invoice email owns the ticket", { ticketId, mailId });
          return;
        }
        const now = nowTs();
        transaction.set(ticketRef, {
          invoiceMailStatus: transition.noticeStatus,
          invoiceMailDeliveryState: transition.deliveryState,
          invoiceMailDeliveredAt: transition.noticeStatus === "sent" ? now : null,
          invoiceMailFailedAt: transition.noticeStatus === "failed" ? now : null,
          updatedAt: now,
        }, { merge: true });
        transaction.set(ticketRef.collection("events").doc(`${mailId}-delivery`), {
          type: transition.noticeStatus === "sent" ? "firing_invoice_email_sent" : "firing_invoice_email_failed",
          mailId,
          deliveryState: transition.deliveryState,
          at: now,
        });
        return;
      }
      const currentNoticeMailId = safeString(ticket.currentNoticeMailId).trim() ||
        safeString(ticket.pickupMailId).trim() ||
        safeString(ticket.lastAdjustmentMailId).trim();
      if (currentNoticeMailId !== mailId) {
        logger.info("Firing mail delivery ignored: a newer notice owns the ticket", {
          ticketId,
          mailId,
        });
        return;
      }

      const now = nowTs();
      const patch: Record<string, unknown> = {
        noticeStatus: transition.noticeStatus,
        noticeDeliveryState: transition.deliveryState,
        noticeDeliveryMailId: mailId,
        updatedAt: now,
      };
      if (transition.noticeStatus === "sent") {
        patch.noticeDeliveredAt = now;
        patch.noticeFailedAt = null;
      } else {
        patch.noticeFailedAt = now;
      }
      transaction.set(ticketRef, patch, { merge: true });
      transaction.set(ticketRef.collection("events").doc(`${mailId}-delivery`), {
        type: transition.noticeStatus === "sent" ? "pickup_notice_sent" : "pickup_notice_failed",
        mailId,
        source: safeString(after.source).trim(),
        deliveryState: transition.deliveryState,
        at: now,
      });
    });
  },
);
