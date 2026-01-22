// web/src/api/portalContracts.ts
// Canonical Portal API + timeline contracts (web + native clients)

export type PortalFnName =
  | "createBatch"
  | "pickedUpAndClose"
  | "continueJourney"
  | "createReservation"
  | "updateReservation"
  | "listMaterialsProducts"
  | "createMaterialsCheckoutSession"
  | "seedMaterialsCatalog"
  | "listEvents"
  | "listEventSignups"
  | "getEvent"
  | "createEvent"
  | "publishEvent"
  | "signupForEvent"
  | "cancelEventSignup"
  | "claimEventOffer"
  | "checkInEvent"
  | "createEventCheckoutSession"
  | "listBillingSummary"
  // add more function names here as you ship them
  | (string & {});

/**
 * Shared error envelope (client-side)
 * - We keep this flexible because Functions errors can come in different shapes.
 */
export type PortalApiErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FAILED_PRECONDITION"
  | "INTERNAL"
  | "UNKNOWN"
  | (string & {});

export type PortalApiErrorEnvelope = {
  ok?: false;
  error?: string;
  message?: string;
  code?: PortalApiErrorCode;
  details?: unknown;
};

/**
 * Shared success envelope (most functions)
 */
export type PortalApiOkEnvelope = {
  ok: true;
};

/**
 * Utility: narrow an unknown response into "ok: true"
 */
export function isOkEnvelope(x: unknown): x is PortalApiOkEnvelope {
  return !!x && typeof x === "object" && (x as any).ok === true;
}

/**
 * Utility: extract a human-friendly message from unknown error responses
 */
export function getErrorMessage(x: unknown): string {
  if (!x) return "Request failed";
  if (typeof x === "string") return x;
  if (typeof x !== "object") return String(x);

  const o = x as any;
  return (
    o.message ||
    o.error ||
    (o.details && typeof o.details === "string" ? o.details : undefined) ||
    "Request failed"
  );
}

/**
 * Utility: extract an error code if present
 */
export function getErrorCode(x: unknown): PortalApiErrorCode | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as any;
  return o.code as PortalApiErrorCode | undefined;
}

/* =========================
   Requests
   ========================= */

export type CreateBatchRequest = {
  ownerUid: string;
  ownerDisplayName: string;
  title: string;

  // Important: Firestore rejects undefined; omit fields or use null if needed.
  kilnName?: string | null;

  // "STAFF_HANDOFF" is the current web UI default; keep it stringly for forward compatibility.
  intakeMode: string;

  estimatedCostCents: number;

  // Notes (prefer estimateNotes; notes is legacy alias)
  estimateNotes?: string | null;
  notes?: string | null;
};

export type ReservationPreferredWindow = {
  earliestDate?: string | null;
  latestDate?: string | null;
};

export type CreateReservationRequest = {
  firingType: "bisque" | "glaze" | "other";
  shelfEquivalent: number;
  preferredWindow?: ReservationPreferredWindow;
  linkedBatchId?: string | null;
};

export type PickedUpAndCloseRequest = {
  uid: string;
  batchId: string;
};

export type ContinueJourneyRequest = {
  uid: string;
  fromBatchId: string;
};

export type UpdateReservationRequest = {
  reservationId: string;
  status: "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED";
  staffNotes?: string | null;
};

export type MaterialsCartItemRequest = {
  productId: string;
  quantity: number;
};

export type ListMaterialsProductsRequest = {
  includeInactive?: boolean;
};

export type CreateMaterialsCheckoutSessionRequest = {
  items: MaterialsCartItemRequest[];
  pickupNotes?: string | null;
};

export type SeedMaterialsCatalogRequest = {
  force?: boolean;
};

export type ListEventsRequest = {
  includeDrafts?: boolean;
  includeCancelled?: boolean;
};

export type GetEventRequest = {
  eventId: string;
};

export type ListEventSignupsRequest = {
  eventId: string;
  includeCancelled?: boolean;
  includeExpired?: boolean;
  limit?: number;
};

export type ListBillingSummaryRequest = {
  limit?: number;
  from?: string | null;
  to?: string | null;
};

export type EventAddOnInput = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

export type CreateEventRequest = {
  templateId?: string | null;
  title: string;
  summary: string;
  description: string;
  location: string;
  timezone: string;
  startAt: string;
  endAt: string;
  capacity: number;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  policyCopy?: string | null;
  addOns?: EventAddOnInput[];
  waitlistEnabled?: boolean;
  offerClaimWindowHours?: number;
  cancelCutoffHours?: number;
};

export type PublishEventRequest = {
  eventId: string;
};

export type SignupForEventRequest = {
  eventId: string;
};

export type CancelEventSignupRequest = {
  signupId: string;
};

export type ClaimEventOfferRequest = {
  signupId: string;
};

export type CheckInEventRequest = {
  signupId: string;
  method: "staff" | "self";
};

export type CreateEventCheckoutSessionRequest = {
  eventId: string;
  signupId: string;
  addOnIds?: string[];
};

/* =========================
   Responses
   ========================= */

export type CreateBatchResponse = PortalApiOkEnvelope & {
  batchId?: string;
  newBatchId?: string;
  existingBatchId?: string;
};

export type PickedUpAndCloseResponse = PortalApiOkEnvelope;

export type ContinueJourneyResponse = PortalApiOkEnvelope & {
  // We accept multiple variants because we've seen different naming patterns across iterations.
  batchId?: string;
  newBatchId?: string;
  existingBatchId?: string;

  // Useful linkage / provenance (optional)
  rootId?: string;
  fromBatchId?: string;

  // Some versions may add messages even on ok
  message?: string;
};

export type CreateReservationResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  status?: string;
};

export type UpdateReservationResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  status?: string;
};

export type MaterialProduct = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  priceCents: number;
  currency: string;
  stripePriceId?: string | null;
  imageUrl?: string | null;
  trackInventory: boolean;
  inventoryOnHand?: number | null;
  inventoryReserved?: number | null;
  inventoryAvailable?: number | null;
  active: boolean;
};

export type ListMaterialsProductsResponse = PortalApiOkEnvelope & {
  products: MaterialProduct[];
};

export type CreateMaterialsCheckoutSessionResponse = PortalApiOkEnvelope & {
  orderId: string;
  checkoutUrl?: string | null;
};

export type SeedMaterialsCatalogResponse = PortalApiOkEnvelope & {
  created: number;
  updated: number;
  total: number;
};

export type EventStatus = "draft" | "published" | "cancelled" | (string & {});

export type EventSignupStatus =
  | "ticketed"
  | "waitlisted"
  | "offered"
  | "checked_in"
  | "cancelled"
  | "expired"
  | (string & {});

export type EventPaymentStatus = "unpaid" | "paid" | "checkout_pending" | "waived" | (string & {});

export type EventAddOn = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

export type EventSummary = {
  id: string;
  title: string;
  summary: string;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  capacity: number;
  waitlistEnabled: boolean;
  status: EventStatus;
  remainingCapacity?: number | null;
};

export type EventDetail = {
  id: string;
  title: string;
  summary: string;
  description: string;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  policyCopy?: string | null;
  addOns?: EventAddOn[];
  capacity: number;
  waitlistEnabled: boolean;
  offerClaimWindowHours?: number | null;
  cancelCutoffHours?: number | null;
  status: EventStatus;
};

export type EventSignupSummary = {
  id: string;
  status: EventSignupStatus;
  paymentStatus?: EventPaymentStatus | null;
};

export type EventSignupRosterEntry = {
  id: string;
  uid?: string | null;
  displayName?: string | null;
  email?: string | null;
  status: EventSignupStatus;
  paymentStatus?: EventPaymentStatus | null;
  createdAt?: string | null;
  offerExpiresAt?: string | null;
  checkedInAt?: string | null;
  checkInMethod?: string | null;
};

export type ListEventsResponse = PortalApiOkEnvelope & {
  events: EventSummary[];
};

export type ListEventSignupsResponse = PortalApiOkEnvelope & {
  signups: EventSignupRosterEntry[];
};

export type GetEventResponse = PortalApiOkEnvelope & {
  event: EventDetail;
  signup?: EventSignupSummary | null;
};

export type CreateEventResponse = PortalApiOkEnvelope & {
  eventId: string;
};

export type PublishEventResponse = PortalApiOkEnvelope & {
  status: string;
};

export type SignupForEventResponse = PortalApiOkEnvelope & {
  signupId: string;
  status: string;
};

export type CancelEventSignupResponse = PortalApiOkEnvelope & {
  status: string;
};

export type ClaimEventOfferResponse = PortalApiOkEnvelope & {
  status: string;
};

export type CheckInEventResponse = PortalApiOkEnvelope & {
  status: string;
  paymentStatus?: string;
};

export type CreateEventCheckoutSessionResponse = PortalApiOkEnvelope & {
  checkoutUrl?: string | null;
};

export type MaterialOrderItemSummary = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency: string;
};

export type MaterialOrderSummary = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  pickupNotes?: string | null;
  checkoutUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  items: MaterialOrderItemSummary[];
};

export type BillingReceipt = {
  id: string;
  type: "event" | "materials";
  sourceId?: string | null;
  title: string;
  amountCents: number;
  currency: string;
  paidAt?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type BillingSummaryTotals = {
  unpaidCheckInsCount: number;
  unpaidCheckInsAmountCents: number;
  materialsPendingCount: number;
  materialsPendingAmountCents: number;
  receiptsCount: number;
  receiptsAmountCents: number;
};

export type BillingSummaryResponse = PortalApiOkEnvelope & {
  unpaidCheckIns: EventSignupRosterEntry[];
  materialsOrders: MaterialOrderSummary[];
  receipts: BillingReceipt[];
  summary: BillingSummaryTotals;
};

/**
 * Utility: best-effort extraction of "the batch id created/returned" from create/continue responses
 * (helps keep UI + iOS logic consistent).
 */
export function getResultBatchId(
  resp: CreateBatchResponse | ContinueJourneyResponse | unknown
): string | undefined {
  if (!resp || typeof resp !== "object") return undefined;
  const o = resp as any;
  return o.newBatchId || o.batchId || o.existingBatchId;
}

/* =========================
   Meta / troubleshooting (shape-only)
   ========================= */

export type PortalApiMeta = {
  atIso: string;
  requestId: string;
  fn: PortalFnName;
  url: string;

  payload: unknown;

  curlExample?: string;

  status?: number;
  ok?: boolean;

  response?: unknown;

  // Optional error info when ok === false
  error?: string;
  message?: string;
  code?: PortalApiErrorCode;
};

/* =========================
   Timeline events (shared)
   ========================= */

export const TIMELINE_EVENT_TYPES = [
  "CREATE_BATCH",
  "SUBMIT_DRAFT",
  "SHELVED",
  "KILN_LOAD",
  "KILN_UNLOAD",
  "ASSIGNED_FIRING",
  "READY_FOR_PICKUP",
  "PICKED_UP_AND_CLOSE",
  "CONTINUE_JOURNEY",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  CREATE_BATCH: "Batch created",
  SUBMIT_DRAFT: "Draft submitted",
  SHELVED: "Shelved",
  KILN_LOAD: "Loaded into kiln",
  KILN_UNLOAD: "Unloaded from kiln",
  ASSIGNED_FIRING: "Firing assigned",
  READY_FOR_PICKUP: "Ready for pickup",
  PICKED_UP_AND_CLOSE: "Picked up & closed",
  CONTINUE_JOURNEY: "Journey continued",
};

const LEGACY_TIMELINE_EVENT_ALIASES: Record<string, TimelineEventType> = {
  BATCH_CREATED: "CREATE_BATCH",
  SUBMITTED: "SUBMIT_DRAFT",
  PICKED_UP_AND_CLOSED: "PICKED_UP_AND_CLOSE",
};

export function isTimelineEventType(v: unknown): v is TimelineEventType {
  return (
    typeof v === "string" &&
    (TIMELINE_EVENT_TYPES as readonly string[]).includes(v)
  );
}

export function normalizeTimelineEventType(
  v: unknown
): TimelineEventType | undefined {
  if (isTimelineEventType(v)) return v;
  if (typeof v === "string" && v in LEGACY_TIMELINE_EVENT_ALIASES) {
    return LEGACY_TIMELINE_EVENT_ALIASES[v];
  }
  return undefined;
}
