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
      useVolumePricing: false,
      volumeIn3: null,
      estimatedCost: null,
      linkedBatchId: null,
      queuePositionHint: null,
      queueClass: null,
      assignedStationId: null,
      requiredResources: null,
      estimatedWindow: null,
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
});
