import type { OpsPortalSnapshot, StationDisplayState } from "../contracts";

export type OpsPortalPageModel = {
  snapshot: OpsPortalSnapshot;
  displayState: StationDisplayState | null;
  surface: string;
  stationId: string | null;
  sessionToken?: string | null;
};
