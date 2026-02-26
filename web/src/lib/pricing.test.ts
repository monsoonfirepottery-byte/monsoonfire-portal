import { describe, expect, test } from "vitest";
import {
  HALF_SHELF_BISQUE_PRICE,
  HALF_SHELF_GLAZE_PRICE,
  DELIVERY_PRICE_PER_TRIP,
  FULL_KILN_CUSTOM_PRICE,
  applyHalfKilnPriceBreak,
  applyConservativeBump,
  computeDeliveryCost,
  computeEstimatedCost,
  computeEstimatedHalfShelves,
  getTiersOptionB,
} from "./pricing";

describe("pricing helpers", () => {
  test("getTiersOptionB uses 10-inch bands", () => {
    expect(getTiersOptionB(10)).toBe(1);
    expect(getTiersOptionB(11)).toBe(2);
    expect(getTiersOptionB(20)).toBe(2);
    expect(getTiersOptionB(21)).toBe(3);
  });

  test("applyConservativeBump enforces 20-inch rule for single footprint", () => {
    expect(
      applyConservativeBump({ heightInches: 20, footprintHalfShelves: 1, tiers: 2 })
    ).toBe(3);
    expect(
      applyConservativeBump({ heightInches: 20, footprintHalfShelves: 2, tiers: 2 })
    ).toBe(2);
  });

  test("computeEstimatedHalfShelves multiplies footprint by tiers", () => {
    expect(computeEstimatedHalfShelves({ footprintHalfShelves: 2, heightInches: 10 })).toBe(2);
    expect(computeEstimatedHalfShelves({ footprintHalfShelves: 1, heightInches: 21 })).toBe(3);
    expect(computeEstimatedHalfShelves({ footprintHalfShelves: 1, heightInches: 20 })).toBe(3);
  });

  test("computeEstimatedCost uses bisque/glaze/raku rules", () => {
    const shelves = 2;
    expect(
      computeEstimatedCost({
        kilnType: "studio-electric",
        firingType: "bisque",
        estimatedHalfShelves: shelves,
      })
    ).toBe(shelves * HALF_SHELF_BISQUE_PRICE);
    expect(
      computeEstimatedCost({
        kilnType: "studio-electric",
        firingType: "glaze",
        estimatedHalfShelves: shelves,
      })
    ).toBe(shelves * HALF_SHELF_GLAZE_PRICE);
    expect(
      computeEstimatedCost({
        kilnType: "reduction-raku",
        firingType: "bisque",
        estimatedHalfShelves: shelves,
      })
    ).toBe(shelves * HALF_SHELF_GLAZE_PRICE);
  });

  test("computeEstimatedCost returns null for other firing", () => {
    expect(
      computeEstimatedCost({
        kilnType: "studio-electric",
        firingType: "other",
        estimatedHalfShelves: 2,
      })
    ).toBeNull();
  });

  test("applyHalfKilnPriceBreak caps at full kiln price for 4+ half shelves", () => {
    const result = applyHalfKilnPriceBreak({ estimatedHalfShelves: 4, estimatedCost: 120 });
    expect(result.estimatedCost).toBe(FULL_KILN_CUSTOM_PRICE);
    expect(result.priceBreakApplied).toBe(true);
  });

  test("computeDeliveryCost uses per-trip pricing", () => {
    expect(computeDeliveryCost(0)).toBe(0);
    expect(computeDeliveryCost(2)).toBe(2 * DELIVERY_PRICE_PER_TRIP);
  });
});
