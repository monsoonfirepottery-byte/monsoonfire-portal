import { normalizeIntakeMode, type IntakeMode } from "../intakeMode";

export type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED" | string;

export type ReservationPieceRecord = {
  pieceId: string;
  pieceLabel: string | null;
  pieceCount: number;
  piecePhotoUrl: string | null;
  pieceStatus: "awaiting_placement" | "loaded" | "fired" | "ready" | "picked_up" | string;
};

export type ReservationRecord = {
  id: string;
  status: ReservationStatus;
  loadStatus?: "queued" | "loading" | "loaded" | string | null;
  firingType: string;
  shelfEquivalent: number;
  footprintHalfShelves?: number | null;
  heightInches?: number | null;
  tiers?: number | null;
  estimatedHalfShelves?: number | null;
  intakeMode?: IntakeMode | string | null;
  estimatedCost?: number | null;
  preferredWindow?: {
    latestDate?: { toDate?: () => Date } | null;
  } | null;
  linkedBatchId?: string | null;
  queuePositionHint?: number | null;
  queueFairness?: {
    noShowCount?: number | null;
    lateArrivalCount?: number | null;
    overrideBoost?: number | null;
    overrideReason?: string | null;
    overrideUntil?: { toDate?: () => Date } | null;
    updatedAt?: { toDate?: () => Date } | null;
    updatedByUid?: string | null;
    updatedByRole?: "staff" | "dev" | "system" | string | null;
    lastPolicyNote?: string | null;
    lastEvidenceId?: string | null;
  } | null;
  queueFairnessPolicy?: {
    noShowCount?: number | null;
    lateArrivalCount?: number | null;
    penaltyPoints?: number | null;
    effectivePenaltyPoints?: number | null;
    overrideBoostApplied?: number | null;
    reasonCodes?: string[];
    policyVersion?: string | null;
    computedAt?: { toDate?: () => Date } | null;
  } | null;
  queueClass?: string | null;
  assignedStationId?: string | null;
  requiredResources?: {
    kilnProfile?: string | null;
    rackCount?: number | null;
    specialHandling?: string[];
  } | null;
  estimatedWindow?: {
    currentStart?: { toDate?: () => Date } | null;
    currentEnd?: { toDate?: () => Date } | null;
    updatedAt?: { toDate?: () => Date } | null;
    slaState?: string | null;
    confidence?: string | null;
  } | null;
  pickupWindow?: {
    requestedStart?: { toDate?: () => Date } | null;
    requestedEnd?: { toDate?: () => Date } | null;
    confirmedStart?: { toDate?: () => Date } | null;
    confirmedEnd?: { toDate?: () => Date } | null;
    status?: "open" | "confirmed" | "missed" | "expired" | "completed" | string | null;
    confirmedAt?: { toDate?: () => Date } | null;
    completedAt?: { toDate?: () => Date } | null;
    lastMissedAt?: { toDate?: () => Date } | null;
    lastRescheduleRequestedAt?: { toDate?: () => Date } | null;
    missedCount?: number | null;
    rescheduleCount?: number | null;
  } | null;
  storageStatus?: "active" | "reminder_pending" | "hold_pending" | "stored_by_policy" | string | null;
  readyForPickupAt?: { toDate?: () => Date } | null;
  pickupReminderCount?: number | null;
  lastReminderAt?: { toDate?: () => Date } | null;
  pickupReminderFailureCount?: number | null;
  lastReminderFailureAt?: { toDate?: () => Date } | null;
  storageNoticeHistory?: Array<{
    at?: { toDate?: () => Date } | null;
    kind?: string | null;
    detail?: string | null;
    status?: string | null;
    reminderOrdinal?: number | null;
    reminderCount?: number | null;
    failureCode?: string | null;
  }> | null;
  arrivalStatus?: string | null;
  arrivedAt?: { toDate?: () => Date } | null;
  arrivalToken?: string | null;
  arrivalTokenIssuedAt?: { toDate?: () => Date } | null;
  arrivalTokenExpiresAt?: { toDate?: () => Date } | null;
  arrivalTokenVersion?: number | null;
  wareType?: string | null;
  kilnId?: string | null;
  kilnLabel?: string | null;
  quantityTier?: string | null;
  quantityLabel?: string | null;
  dropOffQuantity?: {
    id?: string | null;
    label?: string | null;
    pieceRange?: string | null;
  } | null;
  dropOffProfile?: {
    id?: string | null;
    label?: string | null;
    pieceCount?: "single" | "many" | null;
    hasTall?: boolean | null;
    stackable?: boolean | null;
    bisqueOnly?: boolean | null;
    specialHandling?: boolean | null;
  } | null;
  photoUrl?: string | null;
  notes?: {
    general?: string | null;
    clayBody?: string | null;
    glazeNotes?: string | null;
  } | null;
  pieces?: ReservationPieceRecord[] | null;
  staffNotes?: string | null;
  stageStatus?: {
    stage?: string | null;
    at?: { toDate?: () => Date } | null;
    source?: string | null;
    reason?: string | null;
    notes?: string | null;
    actorUid?: string | null;
    actorRole?: string | null;
  } | null;
  stageHistory?: Array<{
    at?: { toDate?: () => Date } | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromLoadStatus?: string | null;
    toLoadStatus?: string | null;
    fromStage?: string | null;
    toStage?: string | null;
    actorUid?: string | null;
    actorRole?: string | null;
    reason?: string | null;
    notes?: string | null;
  }> | null;
  addOns?: {
    rushRequested?: boolean;
    wholeKilnRequested?: boolean;
    pickupDeliveryRequested?: boolean;
    returnDeliveryRequested?: boolean;
    useStudioGlazes?: boolean;
    glazeAccessCost?: number | null;
    waxResistAssistRequested?: boolean;
    glazeSanityCheckRequested?: boolean;
    deliveryAddress?: string | null;
    deliveryInstructions?: string | null;
  } | null;
  createdByRole?: string | null;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
};

export function normalizeReservationRecord(
  id: string,
  raw: Partial<ReservationRecord>
): ReservationRecord {
  return {
    id,
    status: raw.status ?? "REQUESTED",
    loadStatus: raw.loadStatus ?? null,
    firingType: raw.firingType ?? "other",
    shelfEquivalent: typeof raw.shelfEquivalent === "number" ? raw.shelfEquivalent : 1,
    footprintHalfShelves: raw.footprintHalfShelves ?? null,
    heightInches: raw.heightInches ?? null,
    tiers: raw.tiers ?? null,
    estimatedHalfShelves: raw.estimatedHalfShelves ?? null,
    intakeMode: normalizeIntakeMode(
      raw.intakeMode,
      (raw.addOns as { wholeKilnRequested?: boolean } | null | undefined)?.wholeKilnRequested === true
        ? "WHOLE_KILN"
        : "SHELF_PURCHASE"
    ),
    estimatedCost: raw.estimatedCost ?? null,
    preferredWindow: raw.preferredWindow ?? null,
    linkedBatchId: raw.linkedBatchId ?? null,
    queuePositionHint: typeof raw.queuePositionHint === "number" ? raw.queuePositionHint : null,
    queueFairness:
      raw.queueFairness && typeof raw.queueFairness === "object"
        ? (() => {
            const queueFairness = raw.queueFairness as {
              noShowCount?: number | null;
              lateArrivalCount?: number | null;
              overrideBoost?: number | null;
              overrideReason?: string | null;
              overrideUntil?: { toDate?: () => Date } | null;
              updatedAt?: { toDate?: () => Date } | null;
              updatedByUid?: string | null;
              updatedByRole?: string | null;
              lastPolicyNote?: string | null;
              lastEvidenceId?: string | null;
            };
            const updatedByRoleRaw =
              typeof queueFairness.updatedByRole === "string"
                ? queueFairness.updatedByRole.trim().toLowerCase()
                : null;
            const updatedByRole =
              updatedByRoleRaw === "staff" ||
              updatedByRoleRaw === "dev" ||
              updatedByRoleRaw === "system"
                ? updatedByRoleRaw
                : null;
            return {
              noShowCount:
                typeof queueFairness.noShowCount === "number" &&
                Number.isFinite(queueFairness.noShowCount)
                  ? Math.max(0, Math.round(queueFairness.noShowCount))
                  : null,
              lateArrivalCount:
                typeof queueFairness.lateArrivalCount === "number" &&
                Number.isFinite(queueFairness.lateArrivalCount)
                  ? Math.max(0, Math.round(queueFairness.lateArrivalCount))
                  : null,
              overrideBoost:
                typeof queueFairness.overrideBoost === "number" &&
                Number.isFinite(queueFairness.overrideBoost)
                  ? Math.max(0, Math.round(queueFairness.overrideBoost))
                  : null,
              overrideReason:
                typeof queueFairness.overrideReason === "string" &&
                queueFairness.overrideReason.trim().length > 0
                  ? queueFairness.overrideReason.trim()
                  : null,
              overrideUntil: queueFairness.overrideUntil ?? null,
              updatedAt: queueFairness.updatedAt ?? null,
              updatedByUid:
                typeof queueFairness.updatedByUid === "string" &&
                queueFairness.updatedByUid.trim().length > 0
                  ? queueFairness.updatedByUid.trim()
                  : null,
              updatedByRole,
              lastPolicyNote:
                typeof queueFairness.lastPolicyNote === "string" &&
                queueFairness.lastPolicyNote.trim().length > 0
                  ? queueFairness.lastPolicyNote.trim()
                  : null,
              lastEvidenceId:
                typeof queueFairness.lastEvidenceId === "string" &&
                queueFairness.lastEvidenceId.trim().length > 0
                  ? queueFairness.lastEvidenceId.trim()
                  : null,
            };
          })()
        : null,
    queueFairnessPolicy:
      raw.queueFairnessPolicy && typeof raw.queueFairnessPolicy === "object"
        ? (() => {
            const queueFairnessPolicy = raw.queueFairnessPolicy as {
              noShowCount?: number | null;
              lateArrivalCount?: number | null;
              penaltyPoints?: number | null;
              effectivePenaltyPoints?: number | null;
              overrideBoostApplied?: number | null;
              reasonCodes?: string[] | null;
              policyVersion?: string | null;
              computedAt?: { toDate?: () => Date } | null;
            };
            return {
              noShowCount:
                typeof queueFairnessPolicy.noShowCount === "number" &&
                Number.isFinite(queueFairnessPolicy.noShowCount)
                  ? Math.max(0, Math.round(queueFairnessPolicy.noShowCount))
                  : null,
              lateArrivalCount:
                typeof queueFairnessPolicy.lateArrivalCount === "number" &&
                Number.isFinite(queueFairnessPolicy.lateArrivalCount)
                  ? Math.max(0, Math.round(queueFairnessPolicy.lateArrivalCount))
                  : null,
              penaltyPoints:
                typeof queueFairnessPolicy.penaltyPoints === "number" &&
                Number.isFinite(queueFairnessPolicy.penaltyPoints)
                  ? Math.max(0, Math.round(queueFairnessPolicy.penaltyPoints))
                  : null,
              effectivePenaltyPoints:
                typeof queueFairnessPolicy.effectivePenaltyPoints === "number" &&
                Number.isFinite(queueFairnessPolicy.effectivePenaltyPoints)
                  ? Math.max(0, Math.round(queueFairnessPolicy.effectivePenaltyPoints))
                  : null,
              overrideBoostApplied:
                typeof queueFairnessPolicy.overrideBoostApplied === "number" &&
                Number.isFinite(queueFairnessPolicy.overrideBoostApplied)
                  ? Math.max(0, Math.round(queueFairnessPolicy.overrideBoostApplied))
                  : null,
              reasonCodes: Array.isArray(queueFairnessPolicy.reasonCodes)
                ? queueFairnessPolicy.reasonCodes
                    .map((value) => (typeof value === "string" ? value.trim() : ""))
                    .filter((value) => value.length > 0)
                : [],
              policyVersion:
                typeof queueFairnessPolicy.policyVersion === "string" &&
                queueFairnessPolicy.policyVersion.trim().length > 0
                  ? queueFairnessPolicy.policyVersion.trim()
                  : null,
              computedAt: queueFairnessPolicy.computedAt ?? null,
            };
          })()
        : null,
    queueClass: typeof raw.queueClass === "string" ? raw.queueClass : null,
    assignedStationId: typeof raw.assignedStationId === "string" ? raw.assignedStationId : null,
    requiredResources: raw.requiredResources ?? null,
    estimatedWindow: raw.estimatedWindow ?? null,
    pickupWindow:
      raw.pickupWindow && typeof raw.pickupWindow === "object"
        ? (() => {
            const pickupWindow = raw.pickupWindow as {
              requestedStart?: { toDate?: () => Date } | null;
              requestedEnd?: { toDate?: () => Date } | null;
              confirmedStart?: { toDate?: () => Date } | null;
              confirmedEnd?: { toDate?: () => Date } | null;
              status?: string | null;
              confirmedAt?: { toDate?: () => Date } | null;
              completedAt?: { toDate?: () => Date } | null;
              lastMissedAt?: { toDate?: () => Date } | null;
              lastRescheduleRequestedAt?: { toDate?: () => Date } | null;
              missedCount?: number | null;
              rescheduleCount?: number | null;
            };
            const statusRaw =
              typeof pickupWindow.status === "string" && pickupWindow.status.trim().length > 0
                ? pickupWindow.status.trim().toLowerCase()
                : null;
            const status =
              statusRaw === "open" ||
              statusRaw === "confirmed" ||
              statusRaw === "missed" ||
              statusRaw === "expired" ||
              statusRaw === "completed"
                ? statusRaw
                : null;
            return {
              requestedStart: pickupWindow.requestedStart ?? null,
              requestedEnd: pickupWindow.requestedEnd ?? null,
              confirmedStart: pickupWindow.confirmedStart ?? null,
              confirmedEnd: pickupWindow.confirmedEnd ?? null,
              status,
              confirmedAt: pickupWindow.confirmedAt ?? null,
              completedAt: pickupWindow.completedAt ?? null,
              lastMissedAt: pickupWindow.lastMissedAt ?? null,
              lastRescheduleRequestedAt: pickupWindow.lastRescheduleRequestedAt ?? null,
              missedCount:
                typeof pickupWindow.missedCount === "number" &&
                Number.isFinite(pickupWindow.missedCount)
                  ? Math.max(0, Math.round(pickupWindow.missedCount))
                  : null,
              rescheduleCount:
                typeof pickupWindow.rescheduleCount === "number" &&
                Number.isFinite(pickupWindow.rescheduleCount)
                  ? Math.max(0, Math.round(pickupWindow.rescheduleCount))
                  : null,
            };
          })()
        : null,
    storageStatus:
      typeof raw.storageStatus === "string" && raw.storageStatus.trim().length > 0
        ? raw.storageStatus.trim().toLowerCase()
        : null,
    readyForPickupAt: raw.readyForPickupAt ?? null,
    pickupReminderCount:
      typeof raw.pickupReminderCount === "number" && Number.isFinite(raw.pickupReminderCount)
        ? Math.max(0, Math.round(raw.pickupReminderCount))
        : null,
    lastReminderAt: raw.lastReminderAt ?? null,
    pickupReminderFailureCount:
      typeof raw.pickupReminderFailureCount === "number" &&
      Number.isFinite(raw.pickupReminderFailureCount)
        ? Math.max(0, Math.round(raw.pickupReminderFailureCount))
        : null,
    lastReminderFailureAt: raw.lastReminderFailureAt ?? null,
    storageNoticeHistory: Array.isArray(raw.storageNoticeHistory)
      ? raw.storageNoticeHistory.reduce<
          NonNullable<ReservationRecord["storageNoticeHistory"]>
        >((acc, entry) => {
          if (!entry || typeof entry !== "object") return acc;
          const row = entry as {
            at?: { toDate?: () => Date } | null;
            kind?: string | null;
            detail?: string | null;
            status?: string | null;
            reminderOrdinal?: number | null;
            reminderCount?: number | null;
            failureCode?: string | null;
          };
          const kind =
            typeof row.kind === "string" && row.kind.trim().length > 0
              ? row.kind.trim()
              : "";
          if (!kind) return acc;
          acc.push({
            at: row.at ?? null,
            kind,
            detail:
              typeof row.detail === "string" && row.detail.trim().length > 0
                ? row.detail.trim()
                : null,
            status:
              typeof row.status === "string" && row.status.trim().length > 0
                ? row.status.trim().toLowerCase()
                : null,
            reminderOrdinal:
              typeof row.reminderOrdinal === "number" && Number.isFinite(row.reminderOrdinal)
                ? Math.max(1, Math.round(row.reminderOrdinal))
                : null,
            reminderCount:
              typeof row.reminderCount === "number" && Number.isFinite(row.reminderCount)
                ? Math.max(0, Math.round(row.reminderCount))
                : null,
            failureCode:
              typeof row.failureCode === "string" && row.failureCode.trim().length > 0
                ? row.failureCode.trim()
                : null,
          });
          return acc;
        }, [])
      : null,
    arrivalStatus: typeof raw.arrivalStatus === "string" ? raw.arrivalStatus : null,
    arrivedAt: raw.arrivedAt ?? null,
    arrivalToken: typeof raw.arrivalToken === "string" ? raw.arrivalToken : null,
    arrivalTokenIssuedAt: raw.arrivalTokenIssuedAt ?? null,
    arrivalTokenExpiresAt: raw.arrivalTokenExpiresAt ?? null,
    arrivalTokenVersion:
      typeof raw.arrivalTokenVersion === "number" ? raw.arrivalTokenVersion : null,
    wareType: raw.wareType ?? null,
    kilnId: raw.kilnId ?? null,
    kilnLabel: raw.kilnLabel ?? null,
    quantityTier: raw.quantityTier ?? null,
    quantityLabel: raw.quantityLabel ?? null,
    dropOffQuantity: raw.dropOffQuantity ?? null,
    dropOffProfile: raw.dropOffProfile ?? null,
    photoUrl: raw.photoUrl ?? null,
    notes: raw.notes ?? null,
    pieces: Array.isArray(raw.pieces)
      ? raw.pieces.reduce<ReservationPieceRecord[]>((acc, entry) => {
          if (!entry || typeof entry !== "object") return acc;
          const row = entry as ReservationPieceRecord;
          const pieceId =
            typeof row.pieceId === "string" && row.pieceId.trim().length > 0
              ? row.pieceId.trim()
              : "";
          if (!pieceId) return acc;
          const pieceCountRaw =
            typeof row.pieceCount === "number" && Number.isFinite(row.pieceCount)
              ? Math.max(1, Math.round(row.pieceCount))
              : 1;
          const pieceStatus =
            typeof row.pieceStatus === "string" && row.pieceStatus.trim().length > 0
              ? row.pieceStatus.trim().toLowerCase()
              : "awaiting_placement";
          acc.push({
            pieceId,
            pieceLabel:
              typeof row.pieceLabel === "string" && row.pieceLabel.trim().length > 0
                ? row.pieceLabel.trim()
                : null,
            pieceCount: pieceCountRaw,
            piecePhotoUrl:
              typeof row.piecePhotoUrl === "string" && row.piecePhotoUrl.trim().length > 0
                ? row.piecePhotoUrl.trim()
                : null,
            pieceStatus,
          });
          return acc;
        }, [])
      : null,
    staffNotes: raw.staffNotes ?? null,
    stageStatus: raw.stageStatus ?? null,
    stageHistory: Array.isArray(raw.stageHistory) ? raw.stageHistory : null,
    addOns: raw.addOns ?? null,
    createdByRole: raw.createdByRole ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}
