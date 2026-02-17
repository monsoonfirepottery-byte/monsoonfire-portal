export type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED" | string;

export type ReservationRecord = {
  id: string;
  status: ReservationStatus;
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
    wareType: raw.wareType ?? null,
    kilnId: raw.kilnId ?? null,
    kilnLabel: raw.kilnLabel ?? null,
    quantityTier: raw.quantityTier ?? null,
    quantityLabel: raw.quantityLabel ?? null,
    dropOffQuantity: raw.dropOffQuantity ?? null,
    dropOffProfile: raw.dropOffProfile ?? null,
    photoUrl: raw.photoUrl ?? null,
    notes: raw.notes ?? null,
    addOns: raw.addOns ?? null,
    createdByRole: raw.createdByRole ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}
