import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  applyCors,
  db,
  nowTs,
  Timestamp,
  requireAdmin,
  requireAuthUid,
  enforceRateLimit,
  parseBody,
  makeIdempotencyId,
  safeString,
} from "./shared";

const REGION = "us-central1";

const VALID_FIRING_TYPES = new Set(["bisque", "glaze", "other"] as const);
const VALID_WARE_TYPES = new Set(["stoneware", "earthenware", "porcelain", "mixed", "other"] as const);
const VALID_KILN_IDS = new Set(["studio-electric", "reduction-raku"] as const);
const VALID_QUANTITY_TIERS = new Set(["few", "small", "medium", "large"] as const);

const reservationSchema = z.object({
  firingType: z.enum(["bisque", "glaze", "other"]).optional(),
  shelfEquivalent: z.number().optional(),
  footprintHalfShelves: z.number().optional(),
  heightInches: z.number().optional(),
  tiers: z.number().optional(),
  estimatedHalfShelves: z.number().optional(),
  useVolumePricing: z.boolean().optional(),
  volumeIn3: z.number().optional(),
  estimatedCost: z.number().optional(),
  preferredWindow: z
    .object({
      earliestDate: z.any().optional().nullable(),
      latestDate: z.any().optional().nullable(),
    })
    .optional(),
  linkedBatchId: z.string().optional().nullable(),
  clientRequestId: z.string().optional().nullable(),
  ownerUid: z.string().optional().nullable(),
  wareType: z.string().optional().nullable(),
  kilnId: z.string().optional().nullable(),
  kilnLabel: z.string().optional().nullable(),
  quantityTier: z.string().optional().nullable(),
  quantityLabel: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  photoPath: z.string().optional().nullable(),
  notes: z
    .object({
      general: z.string().optional().nullable(),
      clayBody: z.string().optional().nullable(),
      glazeNotes: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  dropOffProfile: z
    .object({
      id: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      pieceCount: z.string().optional().nullable(),
      hasTall: z.boolean().optional().nullable(),
      stackable: z.boolean().optional().nullable(),
      bisqueOnly: z.boolean().optional().nullable(),
      specialHandling: z.boolean().optional().nullable(),
    })
    .optional()
    .nullable(),
  dropOffQuantity: z
    .object({
      id: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      pieceRange: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  addOns: z
    .object({
      rushRequested: z.boolean().optional(),
      wholeKilnRequested: z.boolean().optional(),
      pickupDeliveryRequested: z.boolean().optional(),
      returnDeliveryRequested: z.boolean().optional(),
      useStudioGlazes: z.boolean().optional(),
      glazeAccessCost: z.number().optional().nullable(),
      waxResistAssistRequested: z.boolean().optional(),
      glazeSanityCheckRequested: z.boolean().optional(),
      deliveryAddress: z.string().optional().nullable(),
      deliveryInstructions: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

type PreferredWindowInput = {
  earliestDate?: string | null;
  latestDate?: string | null;
};

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return maybe.toDate();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeFootprint(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clampNumber(Math.round(parsed), 1, 8);
}

function getTiersOptionB(heightInches: number | null): number {
  if (!Number.isFinite(heightInches) || (heightInches ?? 0) <= 0) return 1;
  return Math.max(1, 1 + Math.floor(((heightInches ?? 0) - 1) / 10));
}

function applyConservativeBump(input: { heightInches: number | null; footprintHalfShelves: number; tiers: number }) {
  const { heightInches, footprintHalfShelves, tiers } = input;
  if ((heightInches ?? 0) >= 20 && footprintHalfShelves === 1) {
    return Math.max(tiers, 3);
  }
  return tiers;
}

export const createReservation = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
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
    const requesterUid = auth.uid;

    const parsed = parseBody(reservationSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createReservation",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const body = parsed.data;
    const ownerUidInput = safeString(body.ownerUid).trim();
    let ownerUid = requesterUid;
    let createdByRole: "client" | "staff" | "dev" = "client";

    if (ownerUidInput && ownerUidInput !== requesterUid) {
      const admin = await requireAdmin(req);
      if (!admin.ok) {
        res.status(403).json({ ok: false, message: admin.message });
        return;
      }
      ownerUid = ownerUidInput;
      createdByRole = admin.mode === "staff" ? "staff" : "dev";
    }
    const firingTypeRaw =
      typeof body.firingType === "string" ? body.firingType.toLowerCase() : "";
    let firingType = VALID_FIRING_TYPES.has(firingTypeRaw as any)
      ? (firingTypeRaw as "bisque" | "glaze" | "other")
      : "other";

    const footprintHalfShelves = normalizeFootprint(body.footprintHalfShelves);
    const heightRaw = Number(body.heightInches);
    const heightInches = Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : null;
    const tiersRaw = Number(body.tiers);
    const tiersInput = Number.isFinite(tiersRaw) && tiersRaw > 0 ? Math.round(tiersRaw) : null;
    const estimatedHalfShelvesRaw = Number(body.estimatedHalfShelves);
    const estimatedHalfShelvesInput =
      Number.isFinite(estimatedHalfShelvesRaw) && estimatedHalfShelvesRaw > 0
        ? Math.round(estimatedHalfShelvesRaw)
        : null;
    const computedTiers =
      footprintHalfShelves != null
        ? applyConservativeBump({
            heightInches,
            footprintHalfShelves,
            tiers: getTiersOptionB(heightInches),
          })
        : null;
    const resolvedTiers = tiersInput ?? computedTiers;
    const resolvedEstimatedHalfShelves =
      estimatedHalfShelvesInput ??
      (footprintHalfShelves != null && resolvedTiers != null
        ? footprintHalfShelves * resolvedTiers
        : null);

    const shelfValue = Number(body.shelfEquivalent);
    const shelfEquivalentFallback =
      Number.isFinite(shelfValue) && shelfValue > 0 ? shelfValue : 1;
    const shelfEquivalent =
      resolvedEstimatedHalfShelves != null
        ? Math.max(0.25, resolvedEstimatedHalfShelves / 2)
        : clampNumber(shelfEquivalentFallback, 0.25, 32);

    const preferredWindow: PreferredWindowInput = body.preferredWindow ?? {};
    const earliest = parseIsoDate(preferredWindow.earliestDate);
    const latest = parseIsoDate(preferredWindow.latestDate);

    if (earliest && latest && earliest > latest) {
      res
        .status(400)
        .json({ ok: false, message: "Earliest date must come before latest date" });
      return;
    }

    const windowPayload = {
      earliestDate: earliest ? Timestamp.fromDate(earliest) : null,
      latestDate: latest ? Timestamp.fromDate(latest) : null,
    };

    const linkedBatchId =
      typeof body.linkedBatchId === "string" && body.linkedBatchId.trim()
        ? body.linkedBatchId.trim()
        : null;
    const clientRequestId =
      typeof body.clientRequestId === "string" && body.clientRequestId.trim()
        ? body.clientRequestId.trim()
        : "";

    if (linkedBatchId) {
      const batchSnap = await db.collection("batches").doc(linkedBatchId).get();
      if (!batchSnap.exists) {
        res.status(404).json({ ok: false, message: "Linked batch not found" });
        return;
      }
      const batchData = batchSnap.data() as Record<string, any>;
      const editors = Array.isArray(batchData.editors) ? batchData.editors : [];
      const ownerMatches = batchData.ownerUid === ownerUid || editors.includes(ownerUid);
      if (!ownerMatches) {
        res.status(403).json({ ok: false, message: "Linked batch not owned by requester" });
        return;
      }
    }

    const now = nowTs();
    const ref = clientRequestId
      ? db.collection("reservations").doc(makeIdempotencyId("reservation", ownerUid, clientRequestId))
      : db.collection("reservations").doc();

    if (clientRequestId) {
      const existing = await ref.get();
      if (existing.exists) {
        const data = existing.data() as Record<string, any>;
        if (data?.ownerUid === ownerUid) {
          res.status(200).json({
            ok: true,
            reservationId: ref.id,
            status: data.status ?? "REQUESTED",
          });
          return;
        }
      }
    }

    const wareRaw = safeString(body.wareType).trim().toLowerCase();
    const wareType = VALID_WARE_TYPES.has(wareRaw as any) ? wareRaw : null;
    const kilnIdRaw = safeString(body.kilnId).trim();
    const kilnId = VALID_KILN_IDS.has(kilnIdRaw as any) ? kilnIdRaw : null;
    const kilnLabelRaw = safeString(body.kilnLabel).trim();
    const kilnLabel = kilnLabelRaw ? kilnLabelRaw : null;
    const quantityTierRaw = safeString(body.quantityTier).trim();
    const quantityTier = VALID_QUANTITY_TIERS.has(quantityTierRaw as any) ? quantityTierRaw : null;
    const quantityLabelRaw = safeString(body.quantityLabel).trim();
    const quantityLabel = quantityLabelRaw ? quantityLabelRaw : null;
    const photoUrlRaw = safeString(body.photoUrl).trim();
    const photoUrl = photoUrlRaw ? photoUrlRaw : null;
    const photoPathRaw = safeString(body.photoPath).trim();
    const photoPath = photoPathRaw ? photoPathRaw : null;
    const useVolumePricing = body.useVolumePricing === true;
    const volumeIn3Raw = Number(body.volumeIn3);
    const volumeIn3 = Number.isFinite(volumeIn3Raw) && volumeIn3Raw > 0 ? volumeIn3Raw : null;
    const estimatedCostRaw = Number(body.estimatedCost);
    const estimatedCost =
      Number.isFinite(estimatedCostRaw) && estimatedCostRaw > 0 ? estimatedCostRaw : null;

    if (photoPath && !photoPath.startsWith(`checkins/${ownerUid}/`)) {
      res.status(400).json({ ok: false, message: "Invalid photo path" });
      return;
    }

    const dropInput = body.dropOffProfile ?? {};
    const dropId = safeString(dropInput?.id).trim();
    const dropLabel = safeString(dropInput?.label).trim();
    const dropPieceCountRaw = safeString(dropInput?.pieceCount).trim();
    const dropPieceCount =
      dropPieceCountRaw === "single" || dropPieceCountRaw === "many" ? dropPieceCountRaw : null;
    const dropOffProfile =
      dropId || dropLabel || dropPieceCount || dropInput?.hasTall || dropInput?.stackable || dropInput?.bisqueOnly || dropInput?.specialHandling
        ? {
            id: dropId || null,
            label: dropLabel || null,
            pieceCount: dropPieceCount,
            hasTall: dropInput?.hasTall === true,
            stackable: dropInput?.stackable === true,
            bisqueOnly: dropInput?.bisqueOnly === true,
            specialHandling: dropInput?.specialHandling === true,
          }
        : null;

    const dropQtyInput = body.dropOffQuantity ?? {};
    const dropQtyId = safeString(dropQtyInput?.id).trim();
    const dropQtyLabel = safeString(dropQtyInput?.label).trim();
    const dropQtyRange = safeString(dropQtyInput?.pieceRange).trim();
    const dropOffQuantity =
      dropQtyId || dropQtyLabel || dropQtyRange
        ? {
            id: dropQtyId || null,
            label: dropQtyLabel || null,
            pieceRange: dropQtyRange || null,
          }
        : null;

    if (dropOffProfile?.bisqueOnly && firingType !== "bisque") {
      firingType = "bisque";
    }

    const notesInput = body.notes ?? {};
    const notesGeneral = safeString(notesInput?.general).trim();
    const notesClayBody = safeString(notesInput?.clayBody).trim();
    const notesGlazeNotes = safeString(notesInput?.glazeNotes).trim();
    const notesPayload =
      notesGeneral || notesClayBody || notesGlazeNotes
        ? {
            general: notesGeneral || null,
            clayBody: notesClayBody || null,
            glazeNotes: notesGlazeNotes || null,
          }
        : null;
    const notesHistory = notesPayload
      ? [{ at: now, byUid: requesterUid, byRole: createdByRole, notes: notesPayload }]
      : [];

    const addOnsInput = body.addOns ?? {};
    const estimatedHalfShelves = Number(body.estimatedHalfShelves);
    const safeHalfShelves = Number.isFinite(estimatedHalfShelves) ? estimatedHalfShelves : 0;
    const glazeAccessCost =
      addOnsInput?.useStudioGlazes === true && safeHalfShelves > 0
        ? safeHalfShelves * 3
        : null;
    const addOnsPayload = {
      rushRequested: addOnsInput?.rushRequested === true,
      waxResistAssistRequested: addOnsInput?.waxResistAssistRequested === true,
      glazeSanityCheckRequested: addOnsInput?.glazeSanityCheckRequested === true,
      wholeKilnRequested: addOnsInput?.wholeKilnRequested === true,
      pickupDeliveryRequested: addOnsInput?.pickupDeliveryRequested === true,
      returnDeliveryRequested: addOnsInput?.returnDeliveryRequested === true,
      useStudioGlazes: addOnsInput?.useStudioGlazes === true,
      glazeAccessCost,
      deliveryAddress: safeString(addOnsInput?.deliveryAddress).trim() || null,
      deliveryInstructions: safeString(addOnsInput?.deliveryInstructions).trim() || null,
    };

    if ((addOnsPayload.pickupDeliveryRequested || addOnsPayload.returnDeliveryRequested)
      && (!addOnsPayload.deliveryAddress || !addOnsPayload.deliveryInstructions)) {
      res.status(400).json({
        ok: false,
        message: "Delivery address and instructions are required for pickup/return.",
      });
      return;
    }

    await ref.set({
      ownerUid,
      status: "REQUESTED",
      loadStatus: "queued",
      firingType,
      shelfEquivalent,
      footprintHalfShelves: footprintHalfShelves ?? null,
      heightInches,
      tiers: resolvedTiers ?? null,
      estimatedHalfShelves: resolvedEstimatedHalfShelves ?? null,
      useVolumePricing,
      volumeIn3,
      estimatedCost,
      preferredWindow: windowPayload,
      linkedBatchId,
      wareType,
      kilnId,
      kilnLabel,
      quantityTier,
      quantityLabel,
      dropOffQuantity,
      dropOffProfile,
      photoUrl,
      photoPath,
      notes: notesPayload,
      notesHistory,
      addOns: addOnsPayload,
      createdByUid: requesterUid,
      createdByRole,
      createdAt: now,
      updatedAt: now,
    });

    res
      .status(200)
      .json({ ok: true, reservationId: ref.id, status: "REQUESTED" });
  }
);

