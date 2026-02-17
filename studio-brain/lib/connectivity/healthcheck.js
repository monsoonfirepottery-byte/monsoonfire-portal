"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStatus = normalizeStatus;
exports.collectBackendHealth = collectBackendHealth;
exports.renderHealthTable = renderHealthTable;
function normalizeStatus(ok) {
    return ok ? "ok" : "degraded";
}
async function collectBackendHealth(checks, logger) {
    const results = await Promise.all(checks.map(async ({ label, enabled, run }) => {
        if (!enabled) {
            return { name: label, status: "disabled", latencyMs: null };
        }
        const startedAt = Date.now();
        try {
            const outcome = await run();
            const status = outcome.ok ? "ok" : "degraded";
            const outcomeLatencyMs = outcome.latencyMs ?? Date.now() - startedAt;
            return {
                name: label,
                status,
                latencyMs: outcomeLatencyMs,
                details: { ...outcome, latencyMs: outcomeLatencyMs },
            };
        }
        catch (error) {
            const latencyMs = Date.now() - startedAt;
            const status = "error";
            if (logger) {
                logger.warn("backend_dependency_healthcheck_failed", { check: label, message: error instanceof Error ? error.message : String(error) });
            }
            return {
                name: label,
                status,
                latencyMs,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }));
    const ok = results.every((result) => result.status === "ok" || result.status === "disabled");
    return { at: new Date().toISOString(), ok, checks: results };
}
function renderHealthTable(report) {
    const maxName = Math.max(...report.checks.map((entry) => entry.name.length), 16);
    const rows = [
        ["dependency", "status", "latency(ms)", "error"].map((header) => header.padEnd(14)),
        ["-".repeat(maxName), "-".repeat(8), "-".repeat(12), "-".repeat(20)],
    ];
    const body = report.checks.map((entry) => [
        entry.name.padEnd(maxName),
        entry.status.padEnd(10),
        String(entry.latencyMs ?? "").padEnd(12),
        (entry.error ?? "").padEnd(20),
    ]);
    const lines = [...rows, ...body].map((columns) => columns.join(" | "));
    return `Backend dependency health
${lines.join("\n")}
`;
}
