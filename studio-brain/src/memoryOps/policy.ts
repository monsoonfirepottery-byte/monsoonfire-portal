import crypto from "node:crypto";
import type {
  MemoryOpsAction,
  MemoryOpsActionExecution,
  MemoryOpsFinding,
  MemoryOpsHealth,
  MemoryOpsMemorySnapshot,
  MemoryOpsPostgresSnapshot,
  MemoryOpsRecoveryPolicy,
  MemoryOpsServiceProbe,
  MemoryOpsStuckItem,
} from "./contracts";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}

function stableId(prefix: string, ...parts: string[]): string {
  const readable = parts.map(slug).filter(Boolean).join(":").slice(0, 120);
  const hash = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
  return `${prefix}:${readable}:${hash}`;
}

function maxHealth(left: MemoryOpsHealth, right: MemoryOpsHealth): MemoryOpsHealth {
  const rank: Record<MemoryOpsHealth, number> = { healthy: 0, unknown: 1, degraded: 2, critical: 3 };
  return rank[right] > rank[left] ? right : left;
}

function finding(input: Omit<MemoryOpsFinding, "id">): MemoryOpsFinding {
  return {
    ...input,
    id: stableId("memory-ops-finding", input.area, input.code, input.title),
  };
}

function action(input: {
  policy: MemoryOpsRecoveryPolicy;
  title: string;
  summary: string;
  reason: string;
  findingIds: string[];
  execution: MemoryOpsActionExecution;
  nowIso: string;
}): MemoryOpsAction {
  return {
    id: stableId("memory-ops-action", input.policy, input.title, input.reason),
    policy: input.policy,
    status: "proposed",
    title: input.title,
    summary: input.summary,
    reason: input.reason,
    findingIds: input.findingIds,
    execution: input.execution,
    firstSeenAt: input.nowIso,
    lastSeenAt: input.nowIso,
    approvedAt: null,
    approvedBy: null,
    executedAt: null,
    executionSummary: null,
  };
}

export function classifyPostgresDbaFindings(snapshot: MemoryOpsPostgresSnapshot | null): MemoryOpsFinding[] {
  if (!snapshot) return [];
  if (!snapshot.ok) {
    return [
      finding({
        area: "postgres",
        code: "postgres_unavailable",
        severity: "critical",
        title: "Postgres health probe failed",
        summary: snapshot.error || "The memory ops DBA probe could not reach Postgres.",
        evidence: { checkedAt: snapshot.checkedAt },
      }),
    ];
  }

  const findings: MemoryOpsFinding[] = [];
  const utilization = snapshot.connectionSummary.utilization;
  if (utilization !== null && utilization >= 0.9) {
    findings.push(finding({
      area: "postgres",
      code: "connection_utilization_critical",
      severity: "critical",
      title: "Postgres connection usage is critical",
      summary: `${Math.round(utilization * 100)}% of Postgres connections are in use.`,
      evidence: snapshot.connectionSummary,
    }));
  } else if (utilization !== null && utilization >= 0.75) {
    findings.push(finding({
      area: "postgres",
      code: "connection_utilization_high",
      severity: "warning",
      title: "Postgres connection usage is high",
      summary: `${Math.round(utilization * 100)}% of Postgres connections are in use.`,
      evidence: snapshot.connectionSummary,
    }));
  }

  if (snapshot.connectionSummary.waiting > 0) {
    findings.push(finding({
      area: "postgres",
      code: "connections_waiting",
      severity: "warning",
      title: "Postgres clients are waiting",
      summary: `${snapshot.connectionSummary.waiting} active Postgres client(s) are waiting on an event.`,
      evidence: snapshot.connectionSummary,
    }));
  }

  if (snapshot.connectionSummary.idleInTransaction > 0) {
    findings.push(finding({
      area: "postgres",
      code: "idle_in_transaction_detected",
      severity: "warning",
      title: "Idle transactions detected",
      summary: `${snapshot.connectionSummary.idleInTransaction} connection(s) are idle in transaction.`,
      evidence: snapshot.connectionSummary,
    }));
  }

  if (snapshot.longRunningQueries.length > 0) {
    const longest = snapshot.longRunningQueries[0];
    findings.push(finding({
      area: "postgres",
      code: "long_running_queries",
      severity: longest.durationSeconds >= 900 ? "critical" : "warning",
      title: "Long-running Postgres queries detected",
      summary: `${snapshot.longRunningQueries.length} long-running query row(s), longest ${Math.round(longest.durationSeconds)}s.`,
      evidence: { longest },
    }));
  }

  if (snapshot.databaseStats.tempBytes >= 1024 * 1024 * 1024) {
    findings.push(finding({
      area: "postgres",
      code: "temp_spill_active",
      severity: "warning",
      title: "Postgres temp spill is elevated",
      summary: `Postgres has recorded ${Math.round(snapshot.databaseStats.tempBytes / (1024 * 1024))}MB of temp file writes.`,
      evidence: snapshot.databaseStats,
    }));
  }

  const deadTupleTables = snapshot.tableStats.filter((table) => (table.deadPct ?? 0) >= 20 && table.deadRows >= 1_000);
  if (deadTupleTables.length > 0) {
    findings.push(finding({
      area: "postgres",
      code: "table_dead_tuple_pressure",
      severity: deadTupleTables.some((table) => (table.deadPct ?? 0) >= 40) ? "critical" : "warning",
      title: "Memory tables need vacuum attention",
      summary: `${deadTupleTables.length} table(s) show dead tuple pressure.`,
      evidence: { tables: deadTupleTables.slice(0, 6) },
    }));
  }

  const staleAnalyzeTables = snapshot.tableStats.filter((table) => {
    if (table.liveRows < 10_000) return false;
    if (!table.lastAnalyze) return true;
    const analyzedAt = Date.parse(table.lastAnalyze);
    return Number.isFinite(analyzedAt) && Date.now() - analyzedAt > 24 * 60 * 60 * 1000;
  });
  if (staleAnalyzeTables.length > 0) {
    findings.push(finding({
      area: "postgres",
      code: "table_analyze_stale",
      severity: "warning",
      title: "Memory table statistics are stale",
      summary: `${staleAnalyzeTables.length} memory table(s) need fresh planner statistics.`,
      evidence: { tables: staleAnalyzeTables.slice(0, 8) },
    }));
  }

  if (!snapshot.pgStatStatementsAvailable) {
    findings.push(finding({
      area: "postgres",
      code: "pg_stat_statements_missing",
      severity: "info",
      title: "pg_stat_statements is unavailable",
      summary: "The DBA sidecar can run without pg_stat_statements, but query attribution will be thinner.",
    }));
  }

  return findings;
}

export function classifyMemoryFindings(memory: MemoryOpsMemorySnapshot): { findings: MemoryOpsFinding[]; stuckItems: MemoryOpsStuckItem[] } {
  const findings: MemoryOpsFinding[] = [];
  const stuckItems: MemoryOpsStuckItem[] = [];
  const stats = memory.stats;

  if (memory.statsError) {
    findings.push(finding({
      area: "memory",
      code: "memory_stats_unavailable",
      severity: "warning",
      title: "Memory stats probe failed",
      summary: memory.statsError,
    }));
  }

  if (memory.statsRollupAgeMinutes !== null && memory.statsRollupAgeMinutes > 10) {
    findings.push(finding({
      area: "memory",
      code: "stats_rollup_stale",
      severity: "warning",
      title: "Memory stats rollup is stale",
      summary: `The memory stats rollup is ${memory.statsRollupAgeMinutes} minutes old.`,
      evidence: { statsRollupAgeMinutes: memory.statsRollupAgeMinutes },
    }));
  }

  if (stats) {
    if (stats.resolveConflict > 0 || stats.revalidate > 0 || stats.retire > 0) {
      stuckItems.push({
        id: stableId("memory-ops-stuck", "review-backlog", String(stats.resolveConflict), String(stats.revalidate), String(stats.retire)),
        kind: "memory-conflict",
        severity: stats.resolveConflict > 50 ? "critical" : "warning",
        title: "Memory review backlog is waiting",
        ageMinutes: null,
        summary: `${stats.resolveConflict} conflict(s), ${stats.revalidate} revalidation(s), and ${stats.retire} retirement(s) need review.`,
        actionHint: "Open or refresh memory review cases for the backlog.",
      });
    }
    if (stats.openReviewCases > 0) {
      stuckItems.push({
        id: stableId("memory-ops-stuck", "open-review-cases", String(stats.openReviewCases)),
        kind: "review-case",
        severity: stats.openReviewCases > 100 ? "critical" : "warning",
        title: "Memory review cases are open",
        ageMinutes: null,
        summary: `${stats.openReviewCases} memory review case(s) are open or in progress.`,
        actionHint: "Prioritize stale open review cases.",
      });
    }
    if (stats.verificationFailures24h > 0) {
      stuckItems.push({
        id: stableId("memory-ops-stuck", "verification-failures", String(stats.verificationFailures24h)),
        kind: "verification-failure",
        severity: stats.verificationFailures24h > 10 ? "critical" : "warning",
        title: "Memory verification is failing",
        ageMinutes: null,
        summary: `${stats.verificationFailures24h} verification run(s) failed in the last 24 hours.`,
        actionHint: "Inspect verification failures before trusting promotion output.",
      });
    }
    if (stats.consolidationStale || stats.consolidationStatus === "failed") {
      stuckItems.push({
        id: stableId("memory-ops-stuck", "consolidation", String(stats.consolidationStatus), String(stats.consolidationLastRunAt)),
        kind: "consolidation",
        severity: stats.consolidationStatus === "failed" ? "critical" : "warning",
        title: "Memory consolidation needs attention",
        ageMinutes: null,
        summary: `Consolidation status is ${stats.consolidationStatus || "unknown"}.`,
        actionHint: "Run the consolidation repair path or inspect the latest artifact.",
      });
    }
  }

  if (stuckItems.length > 0) {
    findings.push(finding({
      area: "stuck-items",
      code: "stuck_memory_items",
      severity: stuckItems.some((item) => item.severity === "critical") ? "critical" : "warning",
      title: "Memory has stuck work",
      summary: `${stuckItems.length} stuck memory work bucket(s) need attention.`,
      evidence: { stuckItems: stuckItems.slice(0, 8) },
    }));
  }

  return { findings, stuckItems };
}

export function classifyServiceFindings(services: MemoryOpsServiceProbe[]): MemoryOpsFinding[] {
  return services
    .filter((service) => service.health === "critical" || service.health === "degraded")
    .map((service) =>
      finding({
        area: service.kind === "docker" ? "docker" : service.kind === "systemd" ? "systemd" : service.kind === "process" ? "process" : "memory",
        code: `${service.kind}_service_${service.health}`,
        severity: service.health === "critical" ? "critical" : "warning",
        title: `${service.label} needs attention`,
        summary: service.summary,
        evidence: service.evidence,
      }),
    );
}

function related(findings: MemoryOpsFinding[], code: string): MemoryOpsFinding[] {
  return findings.filter((entry) => entry.code === code || entry.code.includes(code));
}

export function deriveMemoryOpsActions(input: {
  findings: MemoryOpsFinding[];
  services: MemoryOpsServiceProbe[];
  memory: MemoryOpsMemorySnapshot;
  postgres: MemoryOpsPostgresSnapshot | null;
  nowIso: string;
}): MemoryOpsAction[] {
  const actions: MemoryOpsAction[] = [];
  const add = (candidate: MemoryOpsAction | null): void => {
    if (!candidate || actions.some((entry) => entry.id === candidate.id)) return;
    actions.push(candidate);
  };

  const staleStats = related(input.findings, "stats_rollup_stale");
  if (staleStats.length > 0) {
    add(action({
      policy: "safe_auto",
      title: "Refresh memory stats rollup",
      summary: "Re-run the lightweight memory stats endpoint to refresh rollup tables.",
      reason: "stats-rollup-stale",
      findingIds: staleStats.map((entry) => entry.id),
      execution: { kind: "http_get", path: "/api/memory/stats" },
      nowIso: input.nowIso,
    }));
  }

  const analyze = related(input.findings, "table_analyze_stale");
  if (analyze.length > 0) {
    add(action({
      policy: "safe_auto",
      title: "Analyze memory tables",
      summary: "Refresh Postgres planner statistics for the core memory tables.",
      reason: "table-analyze-stale",
      findingIds: analyze.map((entry) => entry.id),
      execution: { kind: "postgres_analyze", tables: ["swarm_memory", "memory_lattice_projection", "memory_review_case", "memory_verification_run"] },
      nowIso: input.nowIso,
    }));
  }

  const deadTuple = related(input.findings, "table_dead_tuple_pressure");
  if (deadTuple.length > 0) {
    add(action({
      policy: "approval_required",
      title: "Run VACUUM ANALYZE on memory tables",
      summary: "Dead tuple pressure is high enough to require an operator-approved vacuum pass.",
      reason: "dead-tuple-pressure",
      findingIds: deadTuple.map((entry) => entry.id),
      execution: { kind: "postgres_vacuum_analyze", tables: ["swarm_memory", "memory_lattice_projection"] },
      nowIso: input.nowIso,
    }));
  }

  const longQueries = related(input.findings, "long_running_queries");
  if (longQueries.length > 0) {
    add(action({
      policy: "manual_only",
      title: "Investigate long-running memory queries",
      summary: "Review query text and caller before canceling anything.",
      reason: "long-running-query",
      findingIds: longQueries.map((entry) => entry.id),
      execution: { kind: "none" },
      nowIso: input.nowIso,
    }));
  }

  const connectionPressure = input.findings.filter((entry) =>
    entry.code === "connection_utilization_critical" ||
    entry.code === "connection_utilization_high" ||
    entry.code === "connections_waiting"
  );
  if (connectionPressure.length > 0) {
    add(action({
      policy: "manual_only",
      title: "Reduce memory import concurrency",
      summary: "Apply runtime tuning or pause ingest before increasing query concurrency.",
      reason: "postgres-connection-pressure",
      findingIds: connectionPressure.map((entry) => entry.id),
      execution: { kind: "none" },
      nowIso: input.nowIso,
    }));
  }

  const duplicateProcessServices = input.services.filter((service) =>
    service.kind === "process" && (service.health === "degraded" || service.health === "critical")
  );
  for (const service of duplicateProcessServices) {
    const pids = Array.isArray(service.evidence?.pids)
      ? service.evidence.pids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 1)
      : [];
    add(action({
      policy: "approval_required",
      title: `Stop duplicate ${service.label}`,
      summary: "Duplicate memory companion/import processes can starve interactive memory queries.",
      reason: `duplicate-process:${service.id}`,
      findingIds: input.findings.filter((entry) => entry.evidence?.serviceId === service.id || entry.title.includes(service.label)).map((entry) => entry.id),
      execution: pids.length > 0 ? { kind: "process_kill", pids } : { kind: "none" },
      nowIso: input.nowIso,
    }));
  }

  const mainService = input.services.find((service) => service.id === "studio-brain.service");
  if (mainService && mainService.health === "critical") {
    add(action({
      policy: "approval_required",
      title: "Restart Studio Brain service",
      summary: "The main Studio Brain service is not healthy and may need a supervised restart.",
      reason: "studio-brain-service-critical",
      findingIds: input.findings.filter((entry) => entry.title.includes(mainService.label)).map((entry) => entry.id),
      execution: { kind: "systemctl_user", verb: "restart", service: "studio-brain.service" },
      nowIso: input.nowIso,
    }));
  }

  for (const service of input.services.filter((entry) => entry.kind === "docker" && entry.health === "critical")) {
    if (service.id === "postgres" || service.id === "redis" || service.id === "minio") {
      add(action({
        policy: "approval_required",
        title: `Restart Docker ${service.label}`,
        summary: `${service.label} is not healthy according to the sidecar probe.`,
        reason: `docker-service-critical:${service.id}`,
        findingIds: input.findings.filter((entry) => entry.title.includes(service.label)).map((entry) => entry.id),
        execution: { kind: "docker_compose", verb: "restart", service: service.id },
        nowIso: input.nowIso,
      }));
    }
  }

  const stuck = related(input.findings, "stuck_memory_items");
  if (stuck.length > 0) {
    add(action({
      policy: "safe_auto",
      title: "Refresh memory review cases",
      summary: "Create or refresh review visibility for stale conflicts, failed verifications, and consolidation drift.",
      reason: "stuck-memory-items",
      findingIds: stuck.map((entry) => entry.id),
      execution: { kind: "http_get", path: "/api/memory/review-cases?limit=50" },
      nowIso: input.nowIso,
    }));
  }

  return actions;
}

export function summarizeMemoryOpsHealth(findings: MemoryOpsFinding[]): { health: MemoryOpsHealth; summary: string } {
  let health: MemoryOpsHealth = "healthy";
  for (const entry of findings) {
    health = maxHealth(health, entry.severity === "critical" ? "critical" : entry.severity === "warning" ? "degraded" : "healthy");
  }
  if (health === "healthy") return { health, summary: "Memory ops posture is healthy." };
  const critical = findings.filter((entry) => entry.severity === "critical").length;
  const warnings = findings.filter((entry) => entry.severity === "warning").length;
  return {
    health,
    summary: `Memory ops has ${critical} critical finding(s) and ${warnings} warning finding(s).`,
  };
}
