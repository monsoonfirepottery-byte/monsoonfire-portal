import { describe, expect, it } from "vitest";
import { resolveStaffToolbarRefreshPlan } from "./staffRefreshPlan";

describe("resolveStaffToolbarRefreshPlan", () => {
  it("shows the toolbar refresh only for shell-owned cockpit tabs", () => {
    expect(resolveStaffToolbarRefreshPlan("triage")).toEqual({
      visible: true,
      key: "refreshVisibleTriage",
      statusMessage: "Refreshed action queue data.",
    });
    expect(resolveStaffToolbarRefreshPlan("automation")).toEqual({
      visible: true,
      key: "refreshVisibleAutomation",
      statusMessage: "Refreshed automation dashboard.",
    });
    expect(resolveStaffToolbarRefreshPlan("platform")).toEqual({
      visible: true,
      key: "refreshVisiblePlatform",
      statusMessage: "Refreshed platform diagnostics.",
    });
    expect(resolveStaffToolbarRefreshPlan("finance")).toEqual({
      visible: true,
      key: "refreshVisibleFinance",
      statusMessage: "Refreshed commerce diagnostics.",
    });
  });

  it("hides the toolbar refresh when the visible module owns its own refresh flow", () => {
    expect(resolveStaffToolbarRefreshPlan("operations")).toEqual({
      visible: false,
      key: null,
      statusMessage: "",
    });
    expect(resolveStaffToolbarRefreshPlan("policyAgentOps")).toEqual({
      visible: false,
      key: null,
      statusMessage: "",
    });
    expect(resolveStaffToolbarRefreshPlan("reports")).toEqual({
      visible: false,
      key: null,
      statusMessage: "",
    });
    expect(resolveStaffToolbarRefreshPlan("moduleTelemetry")).toEqual({
      visible: false,
      key: null,
      statusMessage: "",
    });
  });
});
