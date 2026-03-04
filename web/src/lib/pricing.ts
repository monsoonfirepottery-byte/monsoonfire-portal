export const HALF_SHELF_BISQUE_PRICE = 15;
export const HALF_SHELF_GLAZE_PRICE = 25;
export const FULL_KILN_CUSTOM_PRICE = 85;
export const DELIVERY_PRICE_PER_TRIP = 25;
export const RUSH_REQUEST_PRICE = 20;
export const WAX_RESIST_ASSIST_PRICE = 10;
export const GLAZE_SANITY_CHECK_PRICE = 12;
export const STAFF_GLAZE_PREP_PER_HALF_SHELF_PRICE = 10;

export type FiringType = "bisque" | "glaze" | "other";

type TierInput = {
  heightInches: number;
  footprintHalfShelves: number;
  tiers: number;
};

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeFootprint(value: number) {
  const parsed = Number.isFinite(value) ? Math.round(value) : 1;
  return clampNumber(parsed, 1, 8);
}

export function getTiersOptionB(heightInches: number | null | undefined): number {
  if (!Number.isFinite(heightInches) || (heightInches ?? 0) <= 0) return 1;
  const tiers = 1 + Math.floor((heightInches! - 1) / 10);
  return Math.max(1, tiers);
}

export function applyConservativeBump(input: TierInput): number {
  const { heightInches, footprintHalfShelves, tiers } = input;
  if (heightInches >= 20 && footprintHalfShelves === 1) {
    return Math.max(tiers, 3);
  }
  return tiers;
}

export function computeEstimatedHalfShelves(input: {
  footprintHalfShelves: number;
  heightInches: number | null | undefined;
}): number {
  const footprint = normalizeFootprint(input.footprintHalfShelves);
  const tiers = applyConservativeBump({
    heightInches: Number(input.heightInches ?? 0),
    footprintHalfShelves: footprint,
    tiers: getTiersOptionB(input.heightInches),
  });
  return footprint * tiers;
}

export function computeEstimatedCost(input: {
  kilnType: string | null | undefined;
  firingType: FiringType;
  estimatedHalfShelves: number | null | undefined;
}): number | null {
  if (input.firingType === "other") return null;

  const shelves = Number(input.estimatedHalfShelves);
  if (!Number.isFinite(shelves) || shelves <= 0) return null;

  const isRaku = typeof input.kilnType === "string" && input.kilnType.includes("raku");
  const perHalfShelf =
    isRaku || input.firingType === "glaze" ? HALF_SHELF_GLAZE_PRICE : HALF_SHELF_BISQUE_PRICE;
  return shelves * perHalfShelf;
}

export function applyHalfKilnPriceBreak(input: {
  estimatedHalfShelves: number | null | undefined;
  estimatedCost: number | null | undefined;
}): { estimatedCost: number | null; priceBreakApplied: boolean } {
  const shelves = Number(input.estimatedHalfShelves);
  const cost = Number(input.estimatedCost);
  if (!Number.isFinite(shelves) || !Number.isFinite(cost)) {
    return { estimatedCost: input.estimatedCost ?? null, priceBreakApplied: false };
  }
  if (shelves >= 4 && cost > FULL_KILN_CUSTOM_PRICE) {
    return { estimatedCost: FULL_KILN_CUSTOM_PRICE, priceBreakApplied: true };
  }
  return { estimatedCost: input.estimatedCost ?? null, priceBreakApplied: false };
}

export function computeDeliveryCost(trips: number | null | undefined) {
  const count = Number(trips);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return count * DELIVERY_PRICE_PER_TRIP;
}
