import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { getPgPool } from "../db/postgres";
import { resolveControlTowerRepoRoot } from "../controlTower/collect";
import type {
  MemoryOpsMemorySnapshot,
  MemoryOpsPostgresSnapshot,
  MemoryOpsServiceProbe,
} from "./contracts";

export type MemoryOpsRunnerResult = {
  ok: boolean;
  rc: number;
  stdout: string;
  stderr: string;
  command: string;
};

export type MemoryOpsRunner = (command: string, args?: string[], options?: { cwd?: string }) => MemoryOpsRunnerResult;

export function createMemoryOpsRunner(): MemoryOpsRunner {
  return (command, args = [], options = {}) => {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
      shell: false,
    });
    return {
      ok: (result.status ?? 1) === 0,
      rc: result.status ?? 1,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
      command: [command, ...args].join(" "),
    };
  };
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clip(value: unknown, max = 260): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}

async function fetchJson(baseUrl: string, path: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${clip(text, 180)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function memoryStatsSummary(payload: unknown): MemoryOpsMemorySnapshot["stats"] {
  const stats = payload && typeof payload === "object" ? (payload as { stats?: Record<string, unknown> }).stats : null;
  if (!stats) return null;
  const reviewBacklog = stats.reviewBacklog as Record<string, unknown> | undefined;
  const conflictBacklog = stats.conflictBacklog as Record<string, unknown> | undefined;
  const consolidation = stats.consolidation as Record<string, unknown> | undefined;
  return {
    total: toNumber(stats.total),
    reviewNow: toNumber(reviewBacklog?.reviewNow),
    resolveConflict: toNumber(reviewBacklog?.resolveConflict),
    revalidate: toNumber(reviewBacklog?.revalidate),
    retire: toNumber(reviewBacklog?.retire),
    verificationFailures24h: toNumber(stats.verificationFailures24h),
    openReviewCases: toNumber(stats.openReviewCases),
    hardConflicts: toNumber(conflictBacklog?.hardConflicts),
    retrievalShadowedRows: toNumber(conflictBacklog?.retrievalShadowedRows),
    consolidationStatus: typeof consolidation?.status === "string" ? consolidation.status : null,
    consolidationLastRunAt: typeof consolidation?.lastRunAt === "string" ? consolidation.lastRunAt : null,
    consolidationStale: consolidation?.staleWarning === true || consolidation?.status === "stale",
  };
}

export async function collectMemoryHttpSnapshot(input: {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ memory: MemoryOpsMemorySnapshot; services: MemoryOpsServiceProbe[] }> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = Math.max(500, input.timeoutMs ?? 5_000);
  const headers = input.headers ?? {};
  const services: MemoryOpsServiceProbe[] = [];
  let pressure: Record<string, unknown> | null = null;
  let stats: MemoryOpsMemorySnapshot["stats"] = null;
  let statsError: string | null = null;

  for (const probe of [
    { id: "healthz", label: "Studio Brain /healthz", path: "/healthz", auth: false },
    { id: "readyz", label: "Studio Brain /readyz", path: "/readyz", auth: false },
  ]) {
    try {
      await fetchJson(input.baseUrl, probe.path, {}, timeoutMs);
      services.push({
        id: probe.id,
        label: probe.label,
        kind: "http",
        health: "healthy",
        status: "ok",
        summary: `${probe.path} returned successfully.`,
        checkedAt,
      });
    } catch (error) {
      services.push({
        id: probe.id,
        label: probe.label,
        kind: "http",
        health: "critical",
        status: "error",
        summary: error instanceof Error ? error.message : String(error),
        checkedAt,
      });
    }
  }

  try {
    const payload = await fetchJson(input.baseUrl, "/api/memory/pressure", headers, timeoutMs);
    pressure = payload && typeof payload === "object" ? ((payload as { pressure?: Record<string, unknown> }).pressure ?? null) : null;
  } catch {
    pressure = null;
  }

  try {
    stats = memoryStatsSummary(await fetchJson(input.baseUrl, "/api/memory/stats", headers, timeoutMs));
  } catch (error) {
    statsError = error instanceof Error ? error.message : String(error);
  }

  return {
    memory: {
      checkedAt,
      pressure,
      stats,
      statsRollupAgeMinutes: null,
      statsError,
    },
    services,
  };
}

export async function collectPostgresDbaSnapshot(): Promise<MemoryOpsPostgresSnapshot> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const pool = getPgPool();
    const [
      settings,
      activity,
      longQueries,
      tableStats,
      indexStats,
      databaseStats,
      extensions,
    ] = await Promise.all([
      pool.query("SELECT current_setting('max_connections')::int AS max_connections"),
      pool.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE state = 'active')::int AS active,
          count(*) FILTER (WHERE state = 'idle')::int AS idle,
          count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
          count(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active')::int AS waiting
        FROM pg_stat_activity
        WHERE backend_type = 'client backend'
      `),
      pool.query(`
        SELECT
          pid,
          COALESCE(NULLIF(application_name, ''), '<unset>') AS application_name,
          COALESCE(state, '<none>') AS state,
          EXTRACT(EPOCH FROM (now() - query_start))::int AS duration_seconds,
          wait_event_type,
          query
        FROM pg_stat_activity
        WHERE backend_type = 'client backend'
          AND query_start IS NOT NULL
          AND now() - query_start > interval '60 seconds'
        ORDER BY query_start ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          relname AS table_name,
          n_live_tup,
          n_dead_tup,
          CASE WHEN n_live_tup > 0 THEN round((n_dead_tup::numeric / n_live_tup::numeric) * 100, 2) ELSE NULL END AS dead_pct,
          COALESCE(last_vacuum, last_autovacuum) AS last_vacuum,
          COALESCE(last_analyze, last_autoanalyze) AS last_analyze
        FROM pg_stat_user_tables
        WHERE relname = 'swarm_memory'
           OR relname LIKE 'memory_%'
        ORDER BY n_dead_tup DESC NULLS LAST
        LIMIT 24
      `),
      pool.query(`
        SELECT
          t.relname AS table_name,
          i.relname AS index_name,
          s.idx_scan,
          pg_relation_size(s.indexrelid) AS size_bytes
        FROM pg_stat_user_indexes s
        JOIN pg_class t ON t.oid = s.relid
        JOIN pg_class i ON i.oid = s.indexrelid
        WHERE t.relname = 'swarm_memory'
           OR t.relname LIKE 'memory_%'
        ORDER BY pg_relation_size(s.indexrelid) DESC
        LIMIT 24
      `),
      pool.query(`
        SELECT temp_files, temp_bytes, deadlocks
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
      pool.query("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS available"),
    ]);

    const maxConnections = toNumber(settings.rows[0]?.max_connections, 0) || null;
    const activityRow = activity.rows[0] ?? {};
    const total = toNumber(activityRow.total);
    return {
      ok: true,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      error: null,
      connectionSummary: {
        maxConnections,
        total,
        active: toNumber(activityRow.active),
        idle: toNumber(activityRow.idle),
        idleInTransaction: toNumber(activityRow.idle_in_transaction),
        waiting: toNumber(activityRow.waiting),
        utilization: maxConnections ? Number((total / maxConnections).toFixed(3)) : null,
      },
      longRunningQueries: longQueries.rows.map((row) => ({
        pid: toNumber(row.pid),
        applicationName: String(row.application_name ?? ""),
        state: String(row.state ?? ""),
        durationSeconds: toNumber(row.duration_seconds),
        waitEventType: row.wait_event_type === null ? null : String(row.wait_event_type),
        query: clip(row.query, 240),
      })),
      tableStats: tableStats.rows.map((row) => ({
        tableName: String(row.table_name ?? ""),
        liveRows: toNumber(row.n_live_tup),
        deadRows: toNumber(row.n_dead_tup),
        deadPct: row.dead_pct === null ? null : toNumber(row.dead_pct),
        lastVacuum: toIsoOrNull(row.last_vacuum),
        lastAnalyze: toIsoOrNull(row.last_analyze),
      })),
      indexStats: indexStats.rows.map((row) => ({
        tableName: String(row.table_name ?? ""),
        indexName: String(row.index_name ?? ""),
        scans: toNumber(row.idx_scan),
        sizeBytes: toNumber(row.size_bytes),
      })),
      databaseStats: {
        tempFiles: toNumber(databaseStats.rows[0]?.temp_files),
        tempBytes: toNumber(databaseStats.rows[0]?.temp_bytes),
        deadlocks: toNumber(databaseStats.rows[0]?.deadlocks),
      },
      pgStatStatementsAvailable: extensions.rows[0]?.available === true,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      connectionSummary: {
        maxConnections: null,
        total: 0,
        active: 0,
        idle: 0,
        idleInTransaction: 0,
        waiting: 0,
        utilization: null,
      },
      longRunningQueries: [],
      tableStats: [],
      indexStats: [],
      databaseStats: { tempFiles: 0, tempBytes: 0, deadlocks: 0 },
      pgStatStatementsAvailable: false,
    };
  }
}

function parseSystemctlShow(stdout: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 0) continue;
    output[line.slice(0, index)] = line.slice(index + 1);
  }
  return output;
}

export function collectSystemdServiceProbes(input: {
  runner: MemoryOpsRunner;
  services?: string[];
}): MemoryOpsServiceProbe[] {
  const checkedAt = new Date().toISOString();
  const services = input.services ?? ["studio-brain.service", "studio-brain-memory-ops-supervisor.service"];
  return services.map((service) => {
    const result = input.runner("systemctl", ["--user", "show", service, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts"], {});
    if (!result.ok) {
      return {
        id: service,
        label: service,
        kind: "systemd",
        health: "unknown",
        status: "unavailable",
        summary: result.stderr || result.stdout || "systemctl user service state is unavailable.",
        checkedAt,
      };
    }
    const parsed = parseSystemctlShow(result.stdout);
    const activeState = parsed.ActiveState || "unknown";
    const subState = parsed.SubState || "unknown";
    return {
      id: service,
      label: service,
      kind: "systemd",
      health: activeState === "active" ? "healthy" : activeState === "failed" ? "critical" : "degraded",
      status: activeState,
      summary: `${service} is ${activeState} (${subState}).`,
      checkedAt,
      evidence: {
        activeState,
        subState,
        restarts: toNumber(parsed.NRestarts),
      },
    };
  });
}

export function collectDockerServiceProbes(input: {
  runner: MemoryOpsRunner;
  repoRoot?: string;
  composeFile?: string;
}): MemoryOpsServiceProbe[] {
  const checkedAt = new Date().toISOString();
  const repoRoot = resolveControlTowerRepoRoot(input.repoRoot);
  const composeFile = input.composeFile || resolve(repoRoot, "studio-brain", "docker-compose.yml");
  const result = input.runner("docker", ["compose", "-f", composeFile, "ps", "--services", "--status", "running"], {
    cwd: resolve(repoRoot, "studio-brain"),
  });
  const expected = [
    { id: "postgres", label: "Postgres" },
    { id: "redis", label: "Redis" },
    { id: "minio", label: "MinIO" },
    { id: "otel-collector", label: "OTel Collector" },
  ] as const;
  if (!result.ok) {
    return expected.map((service) => ({
      id: service.id,
      label: service.label,
      kind: "docker" as const,
      health: "unknown" as const,
      status: "unavailable",
      summary: result.stderr || result.stdout || "Docker Compose state is unavailable.",
      checkedAt,
      evidence: { composeFile, command: result.command },
    }));
  }
  const running = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return expected.map((service) => {
    const isRunning = running.has(service.id);
    const optional = service.id === "otel-collector";
    return {
      id: service.id,
      label: service.label,
      kind: "docker" as const,
      health: isRunning ? "healthy" as const : optional ? "unknown" as const : "critical" as const,
      status: isRunning ? "running" : "not-running",
      summary: isRunning ? `${service.label} container is running.` : `${service.label} container is not running.`,
      checkedAt,
      evidence: { composeFile, running: Array.from(running).sort() },
    };
  });
}

function parsePgrep(stdout: string): Array<{ pid: number; command: string }> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry): entry is { pid: number; command: string } => Boolean(entry && entry.pid > 1));
}

export function collectProcessProbes(input: { runner: MemoryOpsRunner }): MemoryOpsServiceProbe[] {
  const checkedAt = new Date().toISOString();
  const result = input.runner("pgrep", ["-af", "session-memory-companion|open-memory.*import|studio-brain-memory-ops-supervisor|npm run dev|node lib/index.js"], {});
  if (!result.ok) {
    return [
      {
        id: "memory-process-scan",
        label: "Memory process scan",
        kind: "process",
        health: "unknown",
        status: "unavailable",
        summary: result.stderr || result.stdout || "pgrep did not return process data.",
        checkedAt,
      },
    ];
  }
  const rows = parsePgrep(result.stdout).filter((row) => row.pid !== process.pid);
  const companion = rows.filter((row) => /session-memory-companion/i.test(row.command));
  const imports = rows.filter((row) => /open-memory.*import/i.test(row.command));
  const runtimes = rows.filter((row) => /npm run dev|node lib\/index\.js/i.test(row.command));
  const probes: MemoryOpsServiceProbe[] = [];
  const buildProbe = (id: string, label: string, rowsForProbe: Array<{ pid: number; command: string }>, healthyMax: number) => {
    probes.push({
      id,
      label,
      kind: "process",
      health: rowsForProbe.length <= healthyMax ? "healthy" : rowsForProbe.length >= healthyMax + 3 ? "critical" : "degraded",
      status: `${rowsForProbe.length}`,
      summary:
        rowsForProbe.length <= healthyMax
          ? `${label} count is within bounds.`
          : `${rowsForProbe.length} ${label} process(es) are active; expected at most ${healthyMax}.`,
      checkedAt,
      evidence: {
        pids: rowsForProbe.map((row) => row.pid),
        commands: rowsForProbe.map((row) => clip(row.command, 220)),
      },
    });
  };
  buildProbe("session-memory-companion", "session memory companion", companion, 1);
  buildProbe("open-memory-import", "open-memory import", imports, 1);
  buildProbe("studio-brain-runtime", "Studio Brain runtime", runtimes, 1);
  return probes;
}
