import { describe, expect, it } from "vitest";

import { resolveOperationsOverview, type ResolveOperationsOverviewInput } from "./operationsOverview";

function makeInput(overrides: Partial<ResolveOperationsOverviewInput> = {}): ResolveOperationsOverviewInput {
  return {
    todayReservationsCount: 0,
    nextReservationTimeLabel: "",
    reservationsWithNotesCount: 0,
    memberTotalCount: 24,
    memberStaffCount: 3,
    memberAdminCount: 1,
    memberInferredCount: 0,
    memberFallbackSources: [],
    openBatchesCount: 8,
    likelyArtifactsCount: 0,
    highConfidenceArtifactsCount: 0,
    manualReviewHintsCount: 0,
    firingActiveCount: 0,
    firingAttentionCount: 0,
    firingScheduledCount: 0,
    eventUpcomingCount: 4,
    eventReviewRequiredCount: 0,
    eventWaitlistedCount: 0,
    eventHighPressureCount: 0,
    lendingOpenRequestsCount: 0,
    lendingActiveLoansCount: 0,
    lendingOverdueCount: 0,
    lendingPendingReviewCount: 0,
    lendingTagQueueCount: 0,
    lendingCoverReviewCount: 0,
    ...overrides,
  };
}

describe("resolveOperationsOverview", () => {
  it("orders priority items by urgency and caps the queue at five", () => {
    const overview = resolveOperationsOverview(
      makeInput({
        todayReservationsCount: 3,
        nextReservationTimeLabel: "9:30 AM",
        highConfidenceArtifactsCount: 2,
        likelyArtifactsCount: 5,
        firingAttentionCount: 1,
        lendingOverdueCount: 4,
        eventReviewRequiredCount: 2,
        eventWaitlistedCount: 6,
        lendingOpenRequestsCount: 2,
        lendingPendingReviewCount: 1,
        memberInferredCount: 2,
        memberFallbackSources: ["profiles_fallback"],
      })
    );

    expect(overview.label).toBe("Action needed");
    expect(overview.priorityItems).toHaveLength(5);
    expect(overview.priorityItems.map((item) => item.id)).toEqual([
      "firings-attention",
      "lending-overdue",
      "events-review",
      "pieces-artifacts",
      "checkins-today",
    ]);
  });

  it("keeps members in reference mode unless source anomalies exist", () => {
    const cleanOverview = resolveOperationsOverview(makeInput());
    const cleanMembersCard = cleanOverview.areaCards.find((card) => card.key === "members");
    expect(cleanMembersCard).toMatchObject({
      tone: "reference",
      label: "Reference",
    });

    const anomalyOverview = resolveOperationsOverview(
      makeInput({
        memberInferredCount: 3,
        memberFallbackSources: ["legacy-profiles", "imports"],
      })
    );
    const anomalyMembersCard = anomalyOverview.areaCards.find((card) => card.key === "members");
    expect(anomalyMembersCard).toMatchObject({
      tone: "watch",
      label: "Watch",
    });
    expect(anomalyMembersCard?.headline).toContain("3 member records inferred");
  });

  it("returns an on-track summary when there are no urgent operations blockers", () => {
    const overview = resolveOperationsOverview(makeInput());

    expect(overview).toMatchObject({
      tone: "clear",
      label: "On track",
      headline: "No urgent operational blockers right now.",
      priorityItems: [],
    });
    expect(overview.areaCards.find((card) => card.key === "checkins")).toMatchObject({
      tone: "clear",
      headline: "No reservations are due today.",
    });
  });
});
