/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OperationsCockpitModule from "./OperationsCockpitModule";
import { resolveOperationsOverview } from "./operationsOverview";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function buildOverview() {
  return resolveOperationsOverview({
    todayReservationsCount: 2,
    nextReservationTimeLabel: "9:30 AM",
    reservationsWithNotesCount: 1,
    memberTotalCount: 24,
    memberStaffCount: 3,
    memberAdminCount: 1,
    memberInferredCount: 0,
    memberFallbackSources: [],
    openBatchesCount: 8,
    likelyArtifactsCount: 4,
    highConfidenceArtifactsCount: 2,
    manualReviewHintsCount: 1,
    firingActiveCount: 1,
    firingAttentionCount: 1,
    firingScheduledCount: 2,
    eventUpcomingCount: 3,
    eventReviewRequiredCount: 1,
    eventWaitlistedCount: 5,
    eventHighPressureCount: 1,
    lendingOpenRequestsCount: 2,
    lendingActiveLoansCount: 4,
    lendingOverdueCount: 1,
    lendingPendingReviewCount: 1,
    lendingTagQueueCount: 2,
    lendingCoverReviewCount: 0,
  });
}

describe("OperationsCockpitModule", () => {
  it("renders the overview instead of all full module content in operations mode", () => {
    const openModuleFromCockpit = vi.fn();

    render(
      <OperationsCockpitModule
        overview={buildOverview()}
        checkinsContent={<div>Check-ins full workspace sentinel</div>}
        membersContent={<div>Members full workspace sentinel</div>}
        piecesContent={<div>Pieces full workspace sentinel</div>}
        firingsContent={<div>Firings full workspace sentinel</div>}
        eventsContent={<div>Events full workspace sentinel</div>}
        lendingContent={<div>Lending full workspace sentinel</div>}
        lendingIntakeContent={<div>Lending intake sentinel</div>}
        activeOperationsModule="operations"
        openModuleFromCockpit={openModuleFromCockpit}
      />
    );

    expect(screen.getByTestId("operations-overview")).toBeTruthy();
    expect(screen.getByText("Operations workboard")).toBeTruthy();
    expect(screen.getByText("Needs attention now")).toBeTruthy();
    expect(screen.queryByText("Members full workspace sentinel")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("operations-priority-firings-attention")).getByRole("button", { name: "Open firings" })
    );
    expect(openModuleFromCockpit).toHaveBeenCalledWith("firings");
  });

  it("renders a focused module with a back-to-overview control", () => {
    const openModuleFromCockpit = vi.fn();

    render(
      <OperationsCockpitModule
        overview={buildOverview()}
        checkinsContent={<div>Check-ins full workspace sentinel</div>}
        membersContent={<div>Members full workspace sentinel</div>}
        piecesContent={<div>Pieces full workspace sentinel</div>}
        firingsContent={<div>Firings full workspace sentinel</div>}
        eventsContent={<div>Events full workspace sentinel</div>}
        lendingContent={<div>Lending full workspace sentinel</div>}
        lendingIntakeContent={<div>Lending intake sentinel</div>}
        activeOperationsModule="members"
        openModuleFromCockpit={openModuleFromCockpit}
      />
    );

    expect(screen.getByTestId("operations-focus-members")).toBeTruthy();
    expect(screen.getByText("Members full workspace sentinel")).toBeTruthy();
    expect(screen.queryByText("Needs attention now")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /back to operations overview/i }));
    expect(openModuleFromCockpit).toHaveBeenCalledWith("operations");
  });

  it("renders lending intake as a focused operations module", () => {
    const openModuleFromCockpit = vi.fn();

    render(
      <OperationsCockpitModule
        overview={buildOverview()}
        checkinsContent={<div>Check-ins full workspace sentinel</div>}
        membersContent={<div>Members full workspace sentinel</div>}
        piecesContent={<div>Pieces full workspace sentinel</div>}
        firingsContent={<div>Firings full workspace sentinel</div>}
        eventsContent={<div>Events full workspace sentinel</div>}
        lendingContent={<div>Lending full workspace sentinel</div>}
        lendingIntakeContent={<div>Lending intake sentinel</div>}
        activeOperationsModule="lending-intake"
        openModuleFromCockpit={openModuleFromCockpit}
      />
    );

    expect(screen.getByTestId("operations-focus-lending-intake")).toBeTruthy();
    expect(screen.getByText("Lending intake")).toBeTruthy();
    expect(screen.getByText("Lending intake sentinel")).toBeTruthy();
  });
});
