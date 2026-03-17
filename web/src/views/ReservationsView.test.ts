import { describe, expect, it } from "vitest";
import { normalizeReservationRecord } from "../lib/normalizers/reservations";

describe("normalizeReservationRecord", () => {
  it("fills expected defaults when optional data is missing", () => {
    const row = normalizeReservationRecord("res-1", {});

    expect(row).toMatchObject({
      id: "res-1",
      status: "REQUESTED",
      loadStatus: null,
      firingType: "other",
      shelfEquivalent: 1,
      footprintHalfShelves: null,
      heightInches: null,
      tiers: null,
      estimatedHalfShelves: null,
      intakeMode: "SHELF_PURCHASE",
      estimatedCost: null,
      linkedBatchId: null,
      queuePositionHint: null,
      queueFairness: null,
      queueFairnessPolicy: null,
      queueClass: null,
      assignedStationId: null,
      requiredResources: null,
      estimatedWindow: null,
      pickupWindow: null,
      storageStatus: null,
      readyForPickupAt: null,
      pickupReminderCount: null,
      lastReminderAt: null,
      pickupReminderFailureCount: null,
      lastReminderFailureAt: null,
      storageNoticeHistory: null,
      storageBilling: null,
      isArchived: false,
      archivedAt: null,
      arrivalStatus: null,
      arrivedAt: null,
      arrivalToken: null,
      arrivalTokenIssuedAt: null,
      arrivalTokenExpiresAt: null,
      arrivalTokenVersion: null,
      wareType: null,
      kilnId: null,
      kilnLabel: null,
      photoUrl: null,
      notes: null,
      staffNotes: null,
      stageStatus: null,
      stageHistory: null,
      addOns: null,
      createdByRole: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("maps legacy fragile handling fields into the self-loaded kiln add-on shape", () => {
    const row = normalizeReservationRecord("res-legacy", {
      addOns: {
        fragileHandlingRequested: true,
        fragileHandlingCost: 12,
      },
      storageBilling: {
        chargeBasis: "estimatedHalfShelves",
        chargeBasisHalfShelves: 3,
        prepaidWeeklyRatePerHalfShelf: 2,
        dailyRatePerHalfShelf: 1.5,
        billedDays: 4,
        accruedCost: 18,
        status: "billing",
      },
      isArchived: true,
    });

    expect(row.addOns).toMatchObject({
      selfLoadedKilnRequested: true,
      selfLoadedKilnCost: 12,
    });
    expect(row.storageBilling).toMatchObject({
      chargeBasis: "estimatedHalfShelves",
      chargeBasisHalfShelves: 3,
      prepaidWeeklyRatePerHalfShelf: 2,
      dailyRatePerHalfShelf: 1.5,
      billedDays: 4,
      accruedCost: 18,
      status: "billing",
    });
    expect(row.isArchived).toBe(true);
  });
});
