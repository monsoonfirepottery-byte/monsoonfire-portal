export type StaffToolbarRefreshTabKey =
  | "triage"
  | "automation"
  | "platform"
  | "finance"
  | "operations"
  | "policyAgentOps"
  | "reports"
  | "moduleTelemetry";

export type StaffToolbarRefreshPlan =
  | {
      visible: false;
      key: null;
      statusMessage: "";
    }
  | {
      visible: true;
      key:
        | "refreshVisibleTriage"
        | "refreshVisibleAutomation"
        | "refreshVisiblePlatform"
        | "refreshVisibleFinance";
      statusMessage: string;
    };

export function resolveStaffToolbarRefreshPlan(
  cockpitTab: StaffToolbarRefreshTabKey
): StaffToolbarRefreshPlan {
  switch (cockpitTab) {
    case "triage":
      return {
        visible: true,
        key: "refreshVisibleTriage",
        statusMessage: "Refreshed action queue data.",
      };
    case "automation":
      return {
        visible: true,
        key: "refreshVisibleAutomation",
        statusMessage: "Refreshed automation dashboard.",
      };
    case "platform":
      return {
        visible: true,
        key: "refreshVisiblePlatform",
        statusMessage: "Refreshed platform diagnostics.",
      };
    case "finance":
      return {
        visible: true,
        key: "refreshVisibleFinance",
        statusMessage: "Refreshed commerce diagnostics.",
      };
    case "operations":
    case "policyAgentOps":
    case "reports":
    case "moduleTelemetry":
      return {
        visible: false,
        key: null,
        statusMessage: "",
      };
  }
}
