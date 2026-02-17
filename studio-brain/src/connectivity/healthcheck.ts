import type { Logger } from "../config/logger";

export type DependencyCheckFunction = {
  label: string;
  check: () => Promise<{ ok: boolean; latencyMs: number; error?: string; [key: string]: unknown }>;
};

export type BackendDependencyCheck = {
  name: string;
  status: "ok" | "degraded" | "error" | "disabled";
  latencyMs: number | null;
  details?: Record<string, unknown>;
  error?: string;
};

export type BackendHealthReport = {
  at: string;
  ok: boolean;
  checks: BackendDependencyCheck[];
};

export function normalizeStatus(ok: boolean): "ok" | "degraded" {
  return ok ? "ok" : "degraded";
}

export async function collectBackendHealth(
  checks: Array<{ label: string; enabled: boolean; run: DependencyCheckFunction["check"] }>,
  logger?: Logger
): Promise<BackendHealthReport> {
  const results = await Promise.all(
    checks.map(async ({ label, enabled, run }) => {
      if (!enabled) {
        return { name: label, status: "disabled" as const, latencyMs: null };
      }
      const startedAt = Date.now();
      try {
        const outcome = await run();
        const status = outcome.ok ? "ok" : "degraded";
        return {
          name: label,
          status,
          latencyMs: outcome.latencyMs ?? Date.now() - startedAt,
          details: { ...outcome },
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (logger) {
          logger.warn("backend_dependency_healthcheck_failed", { check: label, message: error instanceof Error ? error.message : String(error) });
        }
        return {
          name: label,
          status: "error",
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  const ok = results.every((result) => result.status === "ok" || result.status === "disabled");
  return { at: new Date().toISOString(), ok, checks: results };
}

export function renderHealthTable(report: BackendHealthReport): string {
  const maxName = Math.max(...report.checks.map((entry) => entry.name.length), 16);
  const rows = [
    ["dependency", "status", "latency(ms)", "error"].map((header) => header.padEnd(14)),
    ["-".repeat(maxName), "-".repeat(8), "-".repeat(12), "-".repeat(20)],
  ] as string[][];
  const body = report.checks.map((entry) => [
    entry.name.padEnd(maxName),
    entry.status.padEnd(10),
    String(entry.latencyMs ?? "").padEnd(12),
    (entry.error ?? "").padEnd(20),
  ]);
  const lines = [ ...rows, ...body ].map((columns) => columns.join(" | "));
  return `Backend dependency health
${lines.join("\n")}
`;
}
