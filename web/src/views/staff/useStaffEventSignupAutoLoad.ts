import { useEffect } from "react";
import type { StaffToolbarRefreshTabKey } from "./staffRefreshPlan";

export function isStaffEventSignupSurfaceActive(
  cockpitTab: StaffToolbarRefreshTabKey
): boolean {
  return cockpitTab === "operations";
}

type UseStaffEventSignupAutoLoadArgs = {
  cockpitTab: StaffToolbarRefreshTabKey;
  selectedEventId: string;
  loadSignups: (eventId: string) => Promise<void>;
  onError: (error: unknown) => void;
};

export function useStaffEventSignupAutoLoad({
  cockpitTab,
  selectedEventId,
  loadSignups,
  onError,
}: UseStaffEventSignupAutoLoadArgs): void {
  useEffect(() => {
    if (!isStaffEventSignupSurfaceActive(cockpitTab) || !selectedEventId) return;
    void loadSignups(selectedEventId).catch(onError);
  }, [cockpitTab, loadSignups, onError, selectedEventId]);
}
