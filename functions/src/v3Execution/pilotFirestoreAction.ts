import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCors, db, nowTs, parseBody, requireAdmin, requireAuthUid, safeString } from "../shared";

const REGION = "us-central1";

const executeSchema = z.object({
  proposalId: z.string().min(8),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8).max(120),
  actorUid: z.string().min(1),
  actionType: z.literal("ops_note_append"),
  ownerUid: z.string().min(1),
  resourceCollection: z.literal("batches"),
  resourceId: z.string().min(1),
  note: z.string().min(5).max(500),
});

const rollbackSchema = z.object({
  proposalId: z.string().min(8),
  idempotencyKey: z.string().min(8).max(120),
  actorUid: z.string().min(1),
  reason: z.string().min(10).max(500),
});

function actionDocId(proposalId: string, idempotencyKey: string): string {
  const safe = idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `${proposalId}__${safe}`;
}

export const executeStudioBrainPilotAction = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(403).json({ ok: false, message: "Forbidden" });
    return;
  }
  const parsed = parseBody(executeSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const body = parsed.data;
  const proposalId = safeString(body.proposalId);
  const idempotencyKey = safeString(body.idempotencyKey);
  const ownerUid = safeString(body.ownerUid);
  const resourceCollection = safeString(body.resourceCollection);
  const resourceId = safeString(body.resourceId);
  const note = safeString(body.note);
  if (resourceCollection !== "batches") {
    res.status(400).json({ ok: false, message: "Unsupported resourceCollection." });
    return;
  }
  const actionRef = db.collection("studioBrainPilotActions").doc(actionDocId(proposalId, idempotencyKey));
  const noteRef = db.collection("studioBrainPilotOpsNotes").doc();

  const txResult = await db.runTransaction(async (tx) => {
    const existing = await tx.get(actionRef);
    if (existing.exists) {
      const data = existing.data() as Record<string, unknown>;
      return {
        replayed: true,
        noteCollection: String(data.noteCollection ?? "studioBrainPilotOpsNotes"),
        noteId: String(data.noteId ?? ""),
      };
    }
    tx.set(noteRef, {
      ownerUid,
      resourceCollection,
      resourceId,
      note,
      proposalId,
      idempotencyKey,
      createdAt: nowTs(),
      createdByUid: auth.uid,
      rolledBackAt: null,
      rollbackReason: null,
    });
    tx.set(actionRef, {
      proposalId,
      idempotencyKey,
      approvedBy: body.approvedBy ?? null,
      approvedAt: body.approvedAt ?? null,
      actorUid: body.actorUid,
      ownerUid,
      resourceCollection,
      resourceId,
      noteCollection: "studioBrainPilotOpsNotes",
      noteId: noteRef.id,
      createdAt: nowTs(),
      rollbackState: "active",
      rollbackReason: null,
      rolledBackAt: null,
    });
    return { replayed: false, noteCollection: "studioBrainPilotOpsNotes", noteId: noteRef.id };
  });

  res.status(200).json({
    ok: true,
    replayed: txResult.replayed,
    resourcePointer: {
      collection: txResult.noteCollection,
      docId: txResult.noteId,
    },
  });
});

export const rollbackStudioBrainPilotAction = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(403).json({ ok: false, message: "Forbidden" });
    return;
  }
  const parsed = parseBody(rollbackSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const proposalId = safeString(parsed.data.proposalId);
  const idempotencyKey = safeString(parsed.data.idempotencyKey);
  const reason = safeString(parsed.data.reason);
  const actionRef = db.collection("studioBrainPilotActions").doc(actionDocId(proposalId, idempotencyKey));

  const rollbackResult = await db.runTransaction(async (tx) => {
    const actionSnap = await tx.get(actionRef);
    if (!actionSnap.exists) {
      return { found: false, replayed: false };
    }
    const action = actionSnap.data() as Record<string, unknown>;
    if (safeString(action.rollbackState) === "rolled_back") {
      return { found: true, replayed: true };
    }
    const noteCollection = safeString(action.noteCollection) || "studioBrainPilotOpsNotes";
    const noteId = safeString(action.noteId);
    const noteRef = db.collection(noteCollection).doc(noteId);
    tx.set(noteRef, { rolledBackAt: nowTs(), rollbackReason: reason }, { merge: true });
    tx.set(
      actionRef,
      {
        rollbackState: "rolled_back",
        rollbackReason: reason,
        rolledBackAt: nowTs(),
        rolledBackByUid: auth.uid,
      },
      { merge: true }
    );
    return { found: true, replayed: false };
  });

  if (!rollbackResult.found) {
    res.status(404).json({ ok: false, message: "Pilot action not found." });
    return;
  }
  res.status(200).json({ ok: true, replayed: rollbackResult.replayed });
});

