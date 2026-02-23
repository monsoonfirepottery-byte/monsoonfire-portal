import { describe, expect, it } from "vitest";
import { DASHBOARD_MOCK_NON_DEV_ACK, resolveDashboardMockPolicy } from "./dashboardMockPolicy";

describe("resolveDashboardMockPolicy", () => {
  it("disables mock mode when request flag is not set", () => {
    const policy = resolveDashboardMockPolicy({
      DEV: true,
      MODE: "development",
      VITE_DASHBOARD_USE_MOCK_KILN_DATA: "false",
    });

    expect(policy).toMatchObject({
      requested: false,
      allowed: false,
      source: "disabled",
      requiresNonDevAcknowledgement: false,
    });
  });

  it("allows mock mode in dev when request flag is true", () => {
    const policy = resolveDashboardMockPolicy({
      DEV: true,
      MODE: "development",
      VITE_DASHBOARD_USE_MOCK_KILN_DATA: "true",
    });

    expect(policy).toMatchObject({
      requested: true,
      allowed: true,
      source: "dev_flag",
      devMode: true,
      requiresNonDevAcknowledgement: false,
    });
  });

  it("blocks requested mock mode outside dev without explicit acknowledgement", () => {
    const policy = resolveDashboardMockPolicy({
      DEV: false,
      MODE: "production",
      VITE_DASHBOARD_USE_MOCK_KILN_DATA: "true",
      VITE_DASHBOARD_MOCK_KILN_DATA_ACK: "",
    });

    expect(policy).toMatchObject({
      requested: true,
      allowed: false,
      source: "non_dev_blocked",
      devMode: false,
      requiresNonDevAcknowledgement: true,
    });
  });

  it("allows non-dev mock mode only when acknowledgement value matches contract token", () => {
    const policy = resolveDashboardMockPolicy({
      DEV: false,
      MODE: "staging",
      VITE_DASHBOARD_USE_MOCK_KILN_DATA: "true",
      VITE_DASHBOARD_MOCK_KILN_DATA_ACK: DASHBOARD_MOCK_NON_DEV_ACK,
    });

    expect(policy).toMatchObject({
      requested: true,
      allowed: true,
      source: "non_dev_acknowledged",
      requiresNonDevAcknowledgement: false,
    });
  });
});
