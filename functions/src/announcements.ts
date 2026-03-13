import { FieldPath } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { applyCors, db, nowTs, requireAdmin, requireAuthUid } from "./shared";

const REGION = "us-central1";
const QA_ANNOUNCEMENT_ID_PREFIX = "qa-fixture-studio-update-";
const LEGACY_QA_ANNOUNCEMENT_ID_PREFIX = "qa-studio-update-";
const DELETE_BATCH_LIMIT = 200;
const DELETE_SAMPLE_LIMIT = 40;

export function buildQaAnnouncementCleanupRange(prefix = QA_ANNOUNCEMENT_ID_PREFIX) {
  return {
    startAt: prefix,
    endBefore: `${prefix}\uf8ff`,
  };
}

async function deleteQaAnnouncements(prefix = QA_ANNOUNCEMENT_ID_PREFIX) {
  const deletedIdsSample: string[] = [];
  let deletedCount = 0;

  for (const currentPrefix of [prefix, LEGACY_QA_ANNOUNCEMENT_ID_PREFIX]) {
    const range = buildQaAnnouncementCleanupRange(currentPrefix);
    let hasMoreInRange = true;

    while (hasMoreInRange) {
      const snap = await db
        .collection("announcements")
        .where(FieldPath.documentId(), ">=", range.startAt)
        .where(FieldPath.documentId(), "<", range.endBefore)
        .limit(DELETE_BATCH_LIMIT)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((docSnap) => {
        if (deletedIdsSample.length < DELETE_SAMPLE_LIMIT) {
          deletedIdsSample.push(docSnap.id);
        }
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      deletedCount += snap.size;

      hasMoreInRange = snap.size === DELETE_BATCH_LIMIT;
    }
  }

  return {
    prefixes: [prefix, LEGACY_QA_ANNOUNCEMENT_ID_PREFIX],
    deletedCount,
    deletedIdsSample,
    deletedIdsSampleTruncated: deletedCount > deletedIdsSample.length,
  };
}

export const staffCleanupQaAnnouncements = onRequest(
  { region: REGION, timeoutSeconds: 60 },
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

    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    try {
      const result = await deleteQaAnnouncements();
      await db.collection("agentAuditLogs").add({
        actorUid: auth.uid,
        actorMode: admin.mode,
        action: "staff_cleanup_qa_announcements",
        prefixes: result.prefixes,
        deletedCount: result.deletedCount,
        createdAt: nowTs(),
      });

      res.status(200).json({
        ok: true,
        ...result,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("staffCleanupQaAnnouncements failed", { message });
      res.status(500).json({ ok: false, message: "QA announcement cleanup failed" });
    }
  }
);
