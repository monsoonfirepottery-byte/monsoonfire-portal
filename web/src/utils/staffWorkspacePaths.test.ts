import { describe, expect, it } from "vitest";
import {
  isStaffWorkspaceRequest,
  resolveStaffCockpitWorkspaceModule,
  resolveStaffCockpitOperationsModule,
  resolveStaffCockpitWorkspaceTabSegment,
  resolveStaffWorkspaceRequestedPath,
  resolveStaffWorkspaceOpenTarget,
  resolveStaffWorkspaceLaunch,
  resolveStaffWorkspaceMatch,
  shouldExitStaffWorkspaceForTargetNav,
  shouldNavigateToStaffWorkspaceTarget,
} from "./staffWorkspacePaths";

describe("resolveStaffWorkspaceMatch", () => {
  it("normalizes duplicate slashes and trailing separators", () => {
    expect(resolveStaffWorkspaceMatch("/staff//system///")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("staff/Cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
  });

  it("treats missing payloads as non-staff requests", () => {
    expect(resolveStaffWorkspaceMatch(undefined)).toBeNull();
    expect(resolveStaffWorkspaceMatch(null)).toBeNull();
  });

  it("consumes only the first segment for legacy nested staff routes", () => {
    expect(resolveStaffWorkspaceMatch("/staff/system/restart")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/checkins/queue")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
  });

  it("falls back to canonical /staff for unknown staff routes", () => {
    expect(resolveStaffWorkspaceMatch("/staff/does-not-exist")).toEqual({
      canonicalPath: "/staff",
      mode: "default",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/does-not-exist")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
  });

  it("consolidates legacy root module routes to cockpit module paths", () => {
    expect(resolveStaffWorkspaceMatch("/staff/workshop")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/ops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/checkins")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/checkin")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/members")).toEqual({
      canonicalPath: "/staff/cockpit/members",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/member")).toEqual({
      canonicalPath: "/staff/cockpit/members",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/pieces")).toEqual({
      canonicalPath: "/staff/cockpit/pieces",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/piece")).toEqual({
      canonicalPath: "/staff/cockpit/pieces",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/firings")).toEqual({
      canonicalPath: "/staff/cockpit/firings",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/firing")).toEqual({
      canonicalPath: "/staff/cockpit/firings",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/events")).toEqual({
      canonicalPath: "/staff/cockpit/events",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/event")).toEqual({
      canonicalPath: "/staff/cockpit/events",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/stripe")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/commerce")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/lending")).toEqual({
      canonicalPath: "/staff/cockpit/lending",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/lending-intake")).toEqual({
      canonicalPath: "/staff/cockpit/lending-intake",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/lendingIntake")).toEqual({
      canonicalPath: "/staff/cockpit/lending-intake",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/reports")).toEqual({
      canonicalPath: "/staff/cockpit/reports",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/operations")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/policy-agent-ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/module-telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/module_telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/moduleTelemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/billing")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/payments")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/overview")).toEqual({
      canonicalPath: "/staff/cockpit/triage",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/governance")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/policy")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/agent-ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/agent_ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/agentops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/policyagentops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/policy_agent_ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
  });

  it("preserves known cockpit tab-only routes in canonical matching", () => {
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/ops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/policy")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/lending-intake")).toEqual({
      canonicalPath: "/staff/cockpit/lending-intake",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/module-telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/module_telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/moduleTelemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/policyAgentOps")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/agentops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/policyagentops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/policy_agent_ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
  });

  it("normalizes legacy cockpit module-like routes to consolidated anchors", () => {
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/checkins")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/checkin")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/member")).toEqual({
      canonicalPath: "/staff/cockpit/members",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/piece")).toEqual({
      canonicalPath: "/staff/cockpit/pieces",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/firing")).toEqual({
      canonicalPath: "/staff/cockpit/firings",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/event")).toEqual({
      canonicalPath: "/staff/cockpit/events",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/workshop")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/commerce")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/stripe")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/lending")).toEqual({
      canonicalPath: "/staff/cockpit/lending",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/agentops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
  });

  it("ignores query strings on staff workspace routes", () => {
    expect(resolveStaffWorkspaceMatch("/staff/workshops?intent=planning#x")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/system#utm=ci")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
  });

  it("normalizes hash-prefix routes to canonical staff routes", () => {
    expect(resolveStaffWorkspaceMatch("/staff#system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/cockpit#finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff?from=legacy#finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/#/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/#staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("#staff/cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff#/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff#/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/dashboard#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/dashboard#/STAFF/Operations?utm=ci")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("\\staff\\system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("portal.monsoonfire.com\\staff\\cockpit\\commerce")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
  });

  it("normalizes absolute staff URLs", () => {
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/staff/system?x=1")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/staff#/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/staff#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("//portal.monsoonfire.com/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/#!/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
  });

  it("normalizes protocol-less host URLs with ports", () => {
    expect(resolveStaffWorkspaceMatch("portal.monsoonfire.com:5173/staff/cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("localhost:5173/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("127.0.0.1:3000/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("supports protocol-less staff links", () => {
    expect(resolveStaffWorkspaceMatch("portal.monsoonfire.com/staff/cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/cockpit#finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("portal.monsoonfire.com/#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("normalizes URL-encoded absolute staff links", () => {
    expect(
      resolveStaffWorkspaceMatch("https%3A%2F%2Fportal.monsoonfire.com%2Fstaff%2Fworkshops%3Fintent%3Dchat")
    ).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceMatch("https%3A%2F%2Fportal.monsoonfire.com%2Fdashboard%23%2Fstaff%2Fsystem")
    ).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceMatch("https%3A%2F%2Fportal.monsoonfire.com%2F%2Fstaff%2Fcockpit%2Fcommerce")
    ).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
  });

  it("supports protocol-less host URLs with ports as staff open targets", () => {
    expect(resolveStaffWorkspaceOpenTarget("portal.monsoonfire.com:5173/staff/cockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("localhost:5173/#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("normalizes encoded hash-fragment staff URLs", () => {
    expect(resolveStaffWorkspaceMatch("/%23/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/%23/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("normalizes hashbang and whitespace variants", () => {
    expect(resolveStaffWorkspaceMatch(" /#!/staff/workshops ")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("normalizes protocol-relative URL variants", () => {
    expect(resolveStaffWorkspaceMatch("//portal.monsoonfire.com/#!/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("https://portal.monsoonfire.com/dashboard#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceMatch("//portal.monsoonfire.com:5173/staff?x=1#/workshops?from=copy")
    ).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceLaunch("/staff", "//portal.monsoonfire.com/#/staff/workshops")
    ).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("trims copied-link punctuation around staff routes", () => {
    expect(resolveStaffWorkspaceMatch("/staff/workshops)") )
      .toEqual({
        canonicalPath: "/staff/cockpit/operations",
        mode: "cockpit",
      });
    expect(resolveStaffWorkspaceMatch('"https://portal.monsoonfire.com/staff/system,"'))
      .toEqual({
        canonicalPath: "/staff/cockpit/platform",
        mode: "cockpit",
      });
    expect(resolveStaffWorkspaceMatch("(https://portal.monsoonfire.com/staff/cockpit/finance,"))
      .toEqual({
        canonicalPath: "/staff/cockpit/finance",
        mode: "cockpit",
      });
  });

  it("normalizes percent-encoded staff separators and traversal fragments", () => {
    expect(resolveStaffWorkspaceMatch("/staff%2fcockpit")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceMatch("/staff/%2e%2e/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
  });
});

describe("resolveStaffWorkspaceOpenTarget", () => {
  it("defaults blank staff navigation input to canonical staff root", () => {
    expect(resolveStaffWorkspaceOpenTarget("")).toEqual({
      canonicalPath: "/staff",
      mode: "default",
    });
    expect(resolveStaffWorkspaceOpenTarget("   ")).toEqual({
      canonicalPath: "/staff",
      mode: "default",
    });
    expect(resolveStaffWorkspaceOpenTarget(undefined)).toEqual({
      canonicalPath: "/staff",
      mode: "default",
    });
    expect(resolveStaffWorkspaceOpenTarget(null)).toEqual({
      canonicalPath: "/staff",
      mode: "default",
    });
  });

  it("preserves explicit module and deep-link navigation", () => {
    expect(resolveStaffWorkspaceOpenTarget("/staff/cockpit/commerce")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/cockpit/finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
  });

  it("keeps non-staff targets no-op for staff workspace openers", () => {
    expect(resolveStaffWorkspaceOpenTarget("https://portal.monsoonfire.com")).toBeNull();
    expect(resolveStaffWorkspaceOpenTarget("/staff#system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff?from=legacy#finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("https://portal.monsoonfire.com/staff#/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("https://portal.monsoonfire.com/dashboard#/staff/workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
  });

  it("canonicalizes legacy root module links through open target", () => {
    expect(resolveStaffWorkspaceOpenTarget("/staff/system")).toEqual({
      canonicalPath: "/staff/cockpit/platform",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/checkins")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/checkin")).toEqual({
      canonicalPath: "/staff/cockpit/checkins",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/members")).toEqual({
      canonicalPath: "/staff/cockpit/members",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/member")).toEqual({
      canonicalPath: "/staff/cockpit/members",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/operations")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/policy-agent-ops")).toEqual({
      canonicalPath: "/staff/cockpit/policy-agent-ops",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/module-telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/module_telemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/moduleTelemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/cockpit/moduleTelemetry")).toEqual({
      canonicalPath: "/staff/cockpit/module-telemetry",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/piece")).toEqual({
      canonicalPath: "/staff/cockpit/pieces",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/firing")).toEqual({
      canonicalPath: "/staff/cockpit/firings",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("/staff/event")).toEqual({
      canonicalPath: "/staff/cockpit/events",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("\\staff\\workshops")).toEqual({
      canonicalPath: "/staff/cockpit/operations",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceOpenTarget("portal.monsoonfire.com\\staff\\cockpit\\finance")).toEqual({
      canonicalPath: "/staff/cockpit/finance",
      mode: "cockpit",
    });
  });
});

describe("resolveStaffCockpitWorkspaceModule", () => {
  it("extracts dedicated cockpit module from deep cockpit path", () => {
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/reports")).toBe("reports");
  });

  it("returns null when no cockpit module is present", () => {
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff")).toBeNull();
  });

  it("returns null for legacy deep links now handled as cockpit tab anchors", () => {
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/commerce")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/stripe")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/checkins")).toBe("checkins");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/member")).toBe("members");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/piece")).toBe("pieces");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/firing")).toBe("firings");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/event")).toBe("events");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/lendingIntake")).toBe("lending-intake");
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/lending_intake")).toBe("lending-intake");
  });

  it("normalizes legacy tab-only cockpit paths without treating them as module routes", () => {
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/overview")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/governance")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/agent-ops")).toBeNull();
  });

  it("falls back to null for unknown cockpit workspace segments", () => {
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/cockpit")).toBeNull();
    expect(resolveStaffCockpitWorkspaceModule("/staff/cockpit/does-not-exist")).toBeNull();
    expect(resolveStaffWorkspaceMatch("/staff/cockpit/does-not-exist")).toEqual({
      canonicalPath: "/staff/cockpit",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceRequestedPath("/staff/cockpit/does-not-exist", "")).toBe("/staff/cockpit");
  });

  it("normalizes case and spacing for cockpit module extraction", () => {
    expect(resolveStaffCockpitWorkspaceModule(" /staff/Cockpit/Reports ")).toBe("reports");
  });
});

describe("resolveStaffCockpitOperationsModule", () => {
  it("extracts focused operations modules from legacy cockpit paths", () => {
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/checkins")).toBe("checkins");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/member")).toBe("members");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/piece")).toBe("pieces");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/firing")).toBe("firings");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/event")).toBe("events");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/lending")).toBe("lending");
  });

  it("extracts focused operations modules from legacy root staff paths", () => {
    expect(resolveStaffCockpitOperationsModule("/staff/checkins")).toBe("checkins");
    expect(resolveStaffCockpitOperationsModule("/staff/member")).toBe("members");
    expect(resolveStaffCockpitOperationsModule("/staff/piece")).toBe("pieces");
    expect(resolveStaffCockpitOperationsModule("/staff/firing")).toBe("firings");
    expect(resolveStaffCockpitOperationsModule("/staff/event")).toBe("events");
    expect(resolveStaffCockpitOperationsModule("/staff/lendingIntake")).toBe("lending-intake");
    expect(resolveStaffCockpitOperationsModule("/staff/lending_intake")).toBe("lending-intake");
  });

  it("normalizes finance and platform aliases as non-operation focus targets", () => {
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/finance")).toBeNull();
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/stripe")).toBeNull();
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/system")).toBeNull();
  });

  it("normalizes mixed-case operation module aliases before mapping to focused operations", () => {
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/Checkins")).toBe("checkins");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/MEMBER")).toBe("members");
    expect(resolveStaffCockpitOperationsModule("/staff/CHECKIN")).toBe("checkins");
  });

  it("falls back to generic operations for raw operations and workshops aliases", () => {
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/operations")).toBe("operations");
    expect(resolveStaffCockpitOperationsModule("/staff/cockpit/workshops")).toBe("operations");
    expect(resolveStaffCockpitOperationsModule("/staff/workshops")).toBe("operations");
  });
});

describe("resolveStaffCockpitWorkspaceTabSegment", () => {
  it("returns tab-only segments for legacy cockpit deep links", () => {
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/overview")).toBe("triage");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/governance")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/Cockpit/Policy")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/agent-ops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/agent_ops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/agentops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/policyagentops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/policy_agent_ops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/policyAgentOps")).toBe("policy-agent-ops");
  });

  it("returns tab-only segments for operations and module-telemetry", () => {
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/operations")).toBe("operations");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/policy-agent-ops")).toBe("policy-agent-ops");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/module-telemetry")).toBe("module-telemetry");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/module_telemetry")).toBe("module-telemetry");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/billing")).toBe("finance");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/payments")).toBe("finance");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/commerce")).toBe("finance");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/stripe")).toBe("finance");
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/checkins")).toBeNull();
  });

  it("returns null for unknown cockpit segments", () => {
    expect(resolveStaffCockpitWorkspaceTabSegment("/staff/cockpit/does-not-exist")).toBeNull();
  });
});

describe("resolveStaffWorkspaceLaunch", () => {
  it("honors path over hash for mode selection", () => {
    expect(
      resolveStaffWorkspaceLaunch("/staff/system", "/#/staff/cockpit?utm=ci")
    ).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("uses hash path when pathname is not staff", () => {
    expect(resolveStaffWorkspaceLaunch("/dashboard", "#/staff/workshops")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/dashboard", "#staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/dashboard#/staff/system", "")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("uses hash path for generic staff root deep links", () => {
    expect(resolveStaffWorkspaceLaunch("/staff", "#/staff/workshops?utm=ci")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("understands hashbang links for root deep links", () => {
    expect(resolveStaffWorkspaceLaunch("/staff", "/#!/staff/workshops")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/cockpit", "#finance")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("uses hash path even with hash-fragment noise", () => {
    expect(resolveStaffWorkspaceLaunch("/dashboard", "#/staff/system#intent=ci")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("supports absolute URL payloads for path and hash launches", () => {
    expect(
      resolveStaffWorkspaceLaunch(
        "https://portal.monsoonfire.com/staff/cockpit",
        "https://portal.monsoonfire.com/#/staff/workshops"
      )
    ).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceLaunch(
        "https://portal.monsoonfire.com/dashboard",
        "https://portal.monsoonfire.com/#/staff/system?intent=ci"
      )
    ).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(
      resolveStaffWorkspaceLaunch(
        "https://portal.monsoonfire.com/staff",
        "https://portal.monsoonfire.com/staff#/system"
      )
    ).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("localhost:5173/dashboard", "#/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });

  it("falls back to generic staff mode when hash path is unknown", () => {
    expect(resolveStaffWorkspaceLaunch("/staff/does-not-exist", "/#/staff/unknown")).toEqual({
      targetNav: "staff",
      mode: "default",
    });
  });

  it("routes legacy root module paths to cockpit launch mode", () => {
    expect(resolveStaffWorkspaceLaunch("/staff/events", "/staff/cockpit")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/checkin", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/checkins", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/member", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/operations", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/policy-agent-ops", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
    expect(resolveStaffWorkspaceLaunch("/staff/module-telemetry", "/staff/system")).toEqual({
      targetNav: "staff",
      mode: "cockpit",
    });
  });
});

describe("shouldNavigateToStaffWorkspaceTarget", () => {
  it("rewrites when current path differs from the canonical staff target", () => {
    expect(shouldNavigateToStaffWorkspaceTarget("/staff/system", "/staff/cockpit/platform", "")).toBe(true);
    expect(shouldNavigateToStaffWorkspaceTarget("/dashboard", "/staff/cockpit/finance", "")).toBe(true);
  });

  it("rewrites same-path staff targets when a hash fragment is still active", () => {
    expect(shouldNavigateToStaffWorkspaceTarget("/staff", "/staff", "#system")).toBe(true);
    expect(shouldNavigateToStaffWorkspaceTarget("/staff/cockpit/finance", "/staff/cockpit/finance", "#finance")).toBe(true);
  });

  it("keeps same-path staff targets stable when no hash fragment remains", () => {
    expect(shouldNavigateToStaffWorkspaceTarget("/staff", "/staff", "")).toBe(false);
    expect(shouldNavigateToStaffWorkspaceTarget("/staff/cockpit/finance", "/staff/cockpit/finance", "   ")).toBe(false);
  });

  it("does not rewrite same-path non-staff targets just because a hash exists", () => {
    expect(shouldNavigateToStaffWorkspaceTarget("/dashboard", "/dashboard", "#finance")).toBe(false);
  });
});

describe("resolveStaffWorkspaceRequestedPath", () => {
  it("prioritizes explicit /staff path over non-workspace hash intent", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff/does-not-exist", "#/staff/workshops")).toBe("/staff");
  });

  it("preserves root+hash workspace intent when pathname is exact staff root", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff", "#/staff/workshops")).toBe("/staff/cockpit/operations");
  });

  it("supports absolute URL path/hash combinations while avoiding false positives", () => {
    expect(
      resolveStaffWorkspaceRequestedPath(
        "https://portal.monsoonfire.com/#/dashboard",
        "#/staff/system"
      )
    ).toBe("/staff/cockpit/platform");
    expect(resolveStaffWorkspaceRequestedPath("https://portal.monsoonfire.com/dashboard", "#/staff/system")).toBe(
      "/staff/cockpit/platform"
    );
    expect(resolveStaffWorkspaceRequestedPath("https://portal.monsoonfire.com/staff", "/staff/system")).toBe(
      "/staff/cockpit/platform"
    );
    expect(resolveStaffWorkspaceRequestedPath("https://portal.monsoonfire.com/staff", "https://portal.monsoonfire.com/staff#/system")).toBe(
      "/staff/cockpit/platform"
    );
    expect(resolveStaffWorkspaceRequestedPath("https://portal.monsoonfire.com/staff/system", "https://portal.monsoonfire.com/#/staff/workshops")).toBe(
      "/staff/cockpit/platform"
    );
    expect(resolveStaffWorkspaceRequestedPath("/dashboard#/staff/workshops", "")).toBe("/staff/cockpit/operations");
    expect(resolveStaffWorkspaceRequestedPath("/staff#/system", "")).toBe("/staff/cockpit/platform");
    expect(resolveStaffWorkspaceRequestedPath("/staff/cockpit", "#finance")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff/cockpit", "/finance")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff/cockpit", "#/staff/system")).toBe("/staff/cockpit/platform");
  });

  it("prioritizes hash staff deep links from protocol-relative inputs", () => {
    expect(
      resolveStaffWorkspaceRequestedPath("//portal.monsoonfire.com:5173/#/staff/cockpit", "/staff/system?from=copy")
    ).toBe("/staff/cockpit/platform");
  });

  it("normalizes Windows-style hash-copy variants in requested staff paths", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff\\#/system", "")).toBe("/staff/cockpit/platform");
  });

  it("returns canonical root-module cockpit path as requested staff path", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff/reports", "")).toBe("/staff/cockpit/reports");
    expect(resolveStaffWorkspaceRequestedPath("/staff/workshop", "")).toBe("/staff/cockpit/operations");
    expect(resolveStaffWorkspaceRequestedPath("/staff/ops", "")).toBe("/staff/cockpit/operations");
    expect(resolveStaffWorkspaceRequestedPath("/staff/finance", "/staff/workshops")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff/commerce", "")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff/events", "")).toBe("/staff/cockpit/events");
    expect(resolveStaffWorkspaceRequestedPath("/staff/lending", "")).toBe("/staff/cockpit/lending");
    expect(resolveStaffWorkspaceRequestedPath("/staff/stripe", "")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff/checkins", "")).toBe("/staff/cockpit/checkins");
    expect(resolveStaffWorkspaceRequestedPath("/staff/checkin", "")).toBe("/staff/cockpit/checkins");
    expect(resolveStaffWorkspaceRequestedPath("/staff/member", "")).toBe("/staff/cockpit/members");
    expect(resolveStaffWorkspaceRequestedPath("/staff/piece", "")).toBe("/staff/cockpit/pieces");
    expect(resolveStaffWorkspaceRequestedPath("/staff/firing", "")).toBe("/staff/cockpit/firings");
    expect(resolveStaffWorkspaceRequestedPath("/staff/event", "")).toBe("/staff/cockpit/events");
    expect(resolveStaffWorkspaceRequestedPath("/staff/operations", "")).toBe("/staff/cockpit/operations");
    expect(resolveStaffWorkspaceRequestedPath("/staff/policy-agent-ops", "")).toBe("/staff/cockpit/policy-agent-ops");
    expect(resolveStaffWorkspaceRequestedPath("/staff/module-telemetry", "")).toBe("/staff/cockpit/module-telemetry");
    expect(resolveStaffWorkspaceRequestedPath("/staff/module_telemetry", "")).toBe("/staff/cockpit/module-telemetry");
    expect(resolveStaffWorkspaceRequestedPath("/staff/cockpit/moduleTelemetry", "")).toBe(
      "/staff/cockpit/module-telemetry"
    );
  });

  it("returns null when neither path nor hash is a staff workspace", () => {
    expect(resolveStaffWorkspaceRequestedPath("/dashboard", "#/requests")).toBeNull();
    expect(resolveStaffWorkspaceRequestedPath("/", "")).toBeNull();
  });

  it("supports URL-encoded absolute path/hash pairs for requested workspace", () => {
    expect(
      resolveStaffWorkspaceRequestedPath("https%3A%2F%2Fportal.monsoonfire.com%2Fdashboard", "/staff/system")
    ).toBe("/staff/cockpit/platform");
    expect(
      resolveStaffWorkspaceRequestedPath("https%3A%2F%2Fportal.monsoonfire.com%2F", "#/staff/workshops?from%3Dchat")
    ).toBe("/staff/cockpit/operations");
  });

  it("uses bare staff-root hash segments as dedicated workspace intents", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff", "#finance")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("/staff", "#system")).toBe("/staff/cockpit/platform");
  });

  it("uses staff-root hash segments even when pathname carries staff query noise", () => {
    expect(resolveStaffWorkspaceRequestedPath("/staff?from=legacy", "#finance")).toBe("/staff/cockpit/finance");
    expect(resolveStaffWorkspaceRequestedPath("https://portal.monsoonfire.com/staff?from=legacy", "#system")).toBe(
      "/staff/cockpit/platform"
    );
  });

  it("handles missing pathname/hash payloads as non-resolvable workspace intents", () => {
    expect(resolveStaffWorkspaceRequestedPath(undefined, undefined)).toBeNull();
    expect(resolveStaffWorkspaceRequestedPath("/staff", undefined)).toBe("/staff");
    expect(resolveStaffWorkspaceRequestedPath(null, null)).toBeNull();
  });

  it("returns null when launch path/hash are missing", () => {
    expect(resolveStaffWorkspaceLaunch(undefined, undefined)).toBeNull();
    expect(resolveStaffWorkspaceLaunch(null, "#finance")).toBeNull();
  });
});

describe("isStaffWorkspaceRequest", () => {
  it("detects legacy legacy hash deep links and canonical staff routes", () => {
    expect(isStaffWorkspaceRequest("/dashboard", "/#requests")).toBe(false);
    expect(isStaffWorkspaceRequest("/staff", "")).toBe(true);
    expect(isStaffWorkspaceRequest("/staff/does-not-exist", "/")).toBe(true);
    expect(isStaffWorkspaceRequest("/", "/staff/system")).toBe(true);
    expect(isStaffWorkspaceRequest(undefined, undefined)).toBe(false);
  });
});

describe("shouldExitStaffWorkspaceForTargetNav", () => {
  it("exits staff workspace when navigating to non-staff views", () => {
    expect(shouldExitStaffWorkspaceForTargetNav("/staff/cockpit", "", "messages")).toBe(true);
    expect(shouldExitStaffWorkspaceForTargetNav("/dashboard", "#/staff/system", "reservations")).toBe(true);
  });

  it("keeps staff navigation in place for staff targets or non-staff routes", () => {
    expect(shouldExitStaffWorkspaceForTargetNav("/staff/cockpit", "", "staff")).toBe(false);
    expect(shouldExitStaffWorkspaceForTargetNav("/dashboard", "", "messages")).toBe(false);
    expect(shouldExitStaffWorkspaceForTargetNav(undefined, undefined, "dashboard")).toBe(false);
  });
});
