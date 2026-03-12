/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStaffEventSignupAutoLoad } from "./useStaffEventSignupAutoLoad";
import type { StaffToolbarRefreshTabKey } from "./staffRefreshPlan";

function Harness({
  cockpitTab,
  selectedEventId,
  loadSignups,
  onError,
  marker,
}: {
  cockpitTab: StaffToolbarRefreshTabKey;
  selectedEventId: string;
  loadSignups: (eventId: string) => Promise<void>;
  onError: (error: unknown) => void;
  marker?: string;
}) {
  useStaffEventSignupAutoLoad({
    cockpitTab,
    selectedEventId,
    loadSignups,
    onError,
  });

  return <div data-marker={marker ?? ""}>staff-events-auto-load</div>;
}

describe("useStaffEventSignupAutoLoad", () => {
  it("loads signups when the operations surface activates and ignores unrelated rerenders", () => {
    const loadSignups = vi.fn(async (_eventId: string) => {});
    const onError = vi.fn();

    const { rerender } = render(
      <Harness
        cockpitTab="operations"
        selectedEventId="event-1"
        loadSignups={loadSignups}
        onError={onError}
        marker="first"
      />
    );

    expect(loadSignups).toHaveBeenCalledTimes(1);
    expect(loadSignups).toHaveBeenCalledWith("event-1");

    rerender(
      <Harness
        cockpitTab="operations"
        selectedEventId="event-1"
        loadSignups={loadSignups}
        onError={onError}
        marker="busy-flipped"
      />
    );

    expect(loadSignups).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    rerender(
      <Harness
        cockpitTab="operations"
        selectedEventId="event-2"
        loadSignups={loadSignups}
        onError={onError}
        marker="selection-changed"
      />
    );

    expect(loadSignups).toHaveBeenCalledTimes(2);
    expect(loadSignups).toHaveBeenLastCalledWith("event-2");
  });

  it("does not load signups when the operations surface is not active", () => {
    const loadSignups = vi.fn(async (_eventId: string) => {});
    const onError = vi.fn();

    render(
      <Harness
        cockpitTab="policyAgentOps"
        selectedEventId="event-1"
        loadSignups={loadSignups}
        onError={onError}
      />
    );

    expect(loadSignups).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
