// src/types/domain.ts
import type { Timestamp } from "firebase/firestore";

/**
 * Shared domain + Cloud Function response contracts.
 *
 * Web uses Firestore Timestamp; iOS should map these to Date / ISO-8601 strings.
 * Keep fields optional + tolerant because Firestore docs and Functions payloads evolve.
 */

/** Firestore Batch doc (tolerant union of legacy + current fields). */
export type Batch = {
  id: string;

  // ownership / display
  ownerUid?: string;
  ownerDisplayName?: string;

  // naming / status
  title?: string;
  status?: string; // e.g. "SHELF_PURCHASE"
  intakeMode?: "SHELF_PURCHASE" | "WHOLE_KILN" | "COMMUNITY_SHELF" | string;

  // pricing (some paths used priceCents, some used estimatedCostCents)
  priceCents?: number;
  estimatedCostCents?: number;

  // lifecycle
  isClosed?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  closedAt?: Timestamp;

  // allow extra fields without blowing up UI
  [key: string]: unknown;
};

/** Firestore timeline event doc. */
export type TimelineEvent = {
  id: string;

  type?: string; // e.g. "CREATED", "CLOSED", etc.
  at?: Timestamp;

  notes?: string;
  actorName?: string;
  kilnName?: string;

  [key: string]: unknown;
};

/** Common “ok” response used by many functions. */
export type OkResponse = {
  ok: boolean;
  message?: string;
};

/** createBatch response (future-proof: batchId might be missing on older stubs). */
export type CreateBatchResponse = OkResponse & {
  batchId?: string;
};

/** continueJourney response (future-proof across versions). */
export type ContinueJourneyResponse = OkResponse & {
  newBatchId?: string;
  existingBatchId?: string;
  batchId?: string; // some versions may return this
};

/** pickedUpAndClose response. */
export type PickedUpAndCloseResponse = OkResponse;

/**
 * Cloud Functions error bodies sometimes return { error } or { message }.
 * This is for defensive parsing / UI display (optional).
 */
export type FunctionErrorBody = {
  error?: string;
  message?: string;
  [key: string]: unknown;
};
