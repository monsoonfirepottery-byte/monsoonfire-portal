export type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED" | string;

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
  useVolumePricing?: boolean;
  volumeIn3?: number | null;
  estimatedCost?: number | null;
  preferredWindow?: {
    latestDate?: { toDate?: () => Date } | null;
  } | null;
  linkedBatchId?: string | null;
  queuePositionHint?: number | null;
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
    useVolumePricing: raw.useVolumePricing ?? false,
    volumeIn3: raw.volumeIn3 ?? null,
    estimatedCost: raw.estimatedCost ?? null,
    preferredWindow: raw.preferredWindow ?? null,
    linkedBatchId: raw.linkedBatchId ?? null,
    queuePositionHint: typeof raw.queuePositionHint === "number" ? raw.queuePositionHint : null,
    queueClass: typeof raw.queueClass === "string" ? raw.queueClass : null,
    assignedStationId: typeof raw.assignedStationId === "string" ? raw.assignedStationId : null,
    requiredResources: raw.requiredResources ?? null,
    estimatedWindow: raw.estimatedWindow ?? null,
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
    staffNotes: raw.staffNotes ?? null,
    stageStatus: raw.stageStatus ?? null,
    stageHistory: Array.isArray(raw.stageHistory) ? raw.stageHistory : null,
    addOns: raw.addOns ?? null,
    createdByRole: raw.createdByRole ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}
