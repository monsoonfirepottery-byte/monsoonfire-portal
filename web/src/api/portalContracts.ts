// web/src/api/portalContracts.ts
// Canonical Portal API contracts (web + future iOS spec)
// No runtime behavior changes; this is a types/contract boundary.

export type PortalFnName =
  | "createBatch"
  | "pickedUpAndClose"
  | "continueJourney"
  | "createReservation"
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

  // Future-safe optional fields
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
