import { onRequest } from "firebase-functions/v2/https";

import {
  applyCors,
  asInt,
  db,
  requireAdmin,
  requireAuthUid,
  safeString,
} from "./shared";

const REGION = "us-central1";

const LEGACY_TYPE_MAP: Record<string, string> = {
  BATCH_CREATED: "CREATE_BATCH",
  SUBMITTED: "SUBMIT_DRAFT",
  PICKED_UP_AND_CLOSED: "PICKED_UP_AND_CLOSE",
};

export const normalizeTimelineEventTypes = onRequest(
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

    const admin = requireAdmin(req);
    if (!admin.ok) {
      res.status(401).json({ ok: false, message: admin.message });
      return;
    }

    const body = req.body ?? {};
    const batchId = safeString(body.batchId);
    const dryRun = !!body.dryRun;
    const limit = Math.min(Math.max(asInt(body.limit, 200), 1), 500);

    const legacyTypes = Object.keys(LEGACY_TYPE_MAP);

    let snaps;
    try {
      if (batchId) {
        snaps = await db
          .collection("batches")
          .doc(batchId)
          .collection("timeline")
          .get();
      } else {
        snaps = await db
          .collectionGroup("timeline")
          .where("type", "in", legacyTypes)
          .limit(limit)
          .get();
      }
    } catch (e: any) {
      res.status(200).json({
        ok: false,
        message: e?.message ?? String(e),
        hint:
          "If you see FAILED_PRECONDITION, create the required index from the console link in the error.",
      });
      return;
    }

    const sample: Array<{
      id: string;
      batchId: string | null;
      from: string;
      to: string;
    }> = [];

    let matched = 0;
    let wouldUpdate = 0;
    let updated = 0;

    let batch = db.batch();
    let writes = 0;

    async function commitBatch(force: boolean) {
      if (dryRun) return;
      if (writes === 0) return;
      if (!force && writes < 400) return;
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }

    for (const docSnap of snaps.docs) {
      const currentType = docSnap.get("type");
      if (typeof currentType !== "string") continue;

      const nextType = LEGACY_TYPE_MAP[currentType];
      if (!nextType || nextType === currentType) continue;

      matched += 1;
      wouldUpdate += 1;

      if (sample.length < 25) {
        const parent = docSnap.ref.parent.parent;
        sample.push({
          id: docSnap.id,
          batchId: parent ? parent.id : null,
          from: currentType,
          to: nextType,
        });
      }

      if (!dryRun) {
        batch.update(docSnap.ref, { type: nextType });
        writes += 1;
        updated += 1;
        if (writes >= 400) {
          await commitBatch(true);
        }
      }
    }

    await commitBatch(true);

    res.status(200).json({
      ok: true,
      dryRun,
      scope: batchId ? "batch" : "collectionGroup",
      batchId: batchId || null,
      scanned: snaps.size,
      matched,
      wouldUpdate,
      updated: dryRun ? 0 : updated,
      sample,
    });
  }
);
