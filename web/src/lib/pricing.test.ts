import { describe, expect, test } from "vitest";
import {
  HALF_SHELF_BISQUE_PRICE,
  HALF_SHELF_GLAZE_PRICE,
  DELIVERY_PRICE_PER_TRIP,
  PLACEMENT_PREFERENCE_PRICE,
  PREPAID_STORAGE_FLAT_PRICE,
  PREPAID_STORAGE_INCLUDED_WEEKS,
  SELF_LOADED_KILN_FLAT_PRICE,
  STORAGE_BILLING_DAILY_RATE_PER_HALF_SHELF,
  STUDIO_GLAZE_ACCESS_PER_HALF_SHELF_PRICE,
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

  test("a partial half shelf is charged as a full unit", () => {
    expect(computeEstimatedCost({ kilnType: "studio-electric", firingType: "bisque", estimatedHalfShelves: 1.2 })).toBe(40);
  });

  test("caps base prices independently by firing type", () => {
    const result = applyHalfKilnPriceBreak({ estimatedHalfShelves: 4, estimatedCost: 140, firingType: "glaze" });
    expect(result.estimatedCost).toBe(120);
    expect(result.priceBreakApplied).toBe(true);
    expect(applyHalfKilnPriceBreak({ estimatedHalfShelves: 5, estimatedCost: 100, firingType: "bisque" }).estimatedCost).toBe(80);
  });

  test("computeDeliveryCost uses per-trip pricing", () => {
    expect(computeDeliveryCost(0)).toBe(0);
    expect(computeDeliveryCost(2)).toBe(2 * DELIVERY_PRICE_PER_TRIP);
  });

  test("ware add-on pricing matches the published portal rates", () => {
    expect(STUDIO_GLAZE_ACCESS_PER_HALF_SHELF_PRICE).toBe(5);
    expect(SELF_LOADED_KILN_FLAT_PRICE).toBe(15);
    expect(PLACEMENT_PREFERENCE_PRICE).toBe(3);
    expect(PREPAID_STORAGE_FLAT_PRICE).toBe(15);
    expect(PREPAID_STORAGE_INCLUDED_WEEKS).toBe(4);
    expect(STORAGE_BILLING_DAILY_RATE_PER_HALF_SHELF).toBe(1.5);
  });
});
