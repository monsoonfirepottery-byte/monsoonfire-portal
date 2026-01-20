
// functions/src/addTimelineEvent.ts
// C7: Idempotent timeline writer (deduplicates at write-time)

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore();

export type TimelineEventInput = {
  batchId: string;
  type: string;
  at: Timestamp;
  actorUid?: string | null;
  actorName?: string | null;
  notes?: string | null;
  kilnName?: string | null;
  extra?: Record<string, unknown> | null;
};

function stableKey(input: TimelineEventInput): string {
  const parts = [
    input.batchId,
    input.type,
    input.extra?.["fromBatchId"] ?? "",
    input.kilnName ?? "",
  ];
  return parts.join("::");
}

export async function addTimelineEvent(input: TimelineEventInput): Promise<void> {
  const col = db.collection("batches").doc(input.batchId).collection("timeline");

  const key = stableKey(input);

  const existing = await col
    .where("dedupeKey", "==", key)
    .limit(1)
    .get();

  if (!existing.empty) {
    // Duplicate detected → do nothing
    return;
  }

  await col.add({
    type: input.type,
    at: input.at,
    actorUid: input.actorUid ?? null,
    actorName: input.actorName ?? null,
    notes: input.notes ?? null,
    kilnName: input.kilnName ?? null,
    extra: input.extra ?? null,
    dedupeKey: key,
    createdAt: Timestamp.now(),
  });
}
