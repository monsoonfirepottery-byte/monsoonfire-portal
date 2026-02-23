export const DASHBOARD_MOCK_NON_DEV_ACK = "ALLOW_NON_DEV_MOCK_DATA";

export type DashboardMockPolicy = {
  requested: boolean;
  allowed: boolean;
  devMode: boolean;
  environmentMode: string;
  source: "disabled" | "dev_flag" | "non_dev_acknowledged" | "non_dev_blocked";
  requiresNonDevAcknowledgement: boolean;
};

function envBool(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function resolveDashboardMockPolicy(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): DashboardMockPolicy {
  const requested = envBool(env.VITE_DASHBOARD_USE_MOCK_KILN_DATA);
  const devMode = Boolean(env.DEV);
  const environmentMode = String(env.MODE ?? "").trim().toLowerCase() || "unknown";
  const acknowledged = String(env.VITE_DASHBOARD_MOCK_KILN_DATA_ACK ?? "").trim() === DASHBOARD_MOCK_NON_DEV_ACK;

  if (!requested) {
    return {
      requested: false,
      allowed: false,
      devMode,
      environmentMode,
      source: "disabled",
      requiresNonDevAcknowledgement: false,
    };
  }

  if (devMode) {
    return {
      requested: true,
      allowed: true,
      devMode,
      environmentMode,
      source: "dev_flag",
      requiresNonDevAcknowledgement: false,
    };
  }

  if (acknowledged) {
    return {
      requested: true,
      allowed: true,
      devMode,
      environmentMode,
      source: "non_dev_acknowledged",
      requiresNonDevAcknowledgement: false,
    };
  }

  return {
    requested: true,
    allowed: false,
    devMode,
    environmentMode,
    source: "non_dev_blocked",
    requiresNonDevAcknowledgement: true,
  };
}
