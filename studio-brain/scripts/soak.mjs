const baseUrl = process.env.SOAK_BASE_URL ?? "http://127.0.0.1:8787";
const durationMinutes = Number(process.env.SOAK_DURATION_MINUTES ?? "60");
const pollSeconds = Number(process.env.SOAK_POLL_SECONDS ?? "30");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetchJson(path) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`);
    const payload = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function main() {
  const startedAt = Date.now();
  const durationMs = durationMinutes * 60 * 1000;
  const intervalMs = pollSeconds * 1000;
  const summary = {
    samples: 0,
    healthOk: 0,
    readyOk: 0,
    statusOk: 0,
    metricsOk: 0,
    requestLatenciesMs: [],
    maxRssBytes: 0,
    maxHeapUsedBytes: 0,
    lastSnapshotGeneratedAt: null,
    errors: [],
  };

  process.stdout.write(
    `Starting soak: baseUrl=${baseUrl} durationMinutes=${durationMinutes} pollSeconds=${pollSeconds}\n`
  );

  while (Date.now() - startedAt < durationMs) {
    const [health, ready, status, metrics] = await Promise.all([
      safeFetchJson("/healthz"),
      safeFetchJson("/readyz"),
      safeFetchJson("/api/status"),
      safeFetchJson("/api/metrics"),
    ]);
    summary.samples += 1;

    for (const result of [health, ready, status, metrics]) {
      summary.requestLatenciesMs.push(result.durationMs);
      if (result.error) {
        summary.errors.push(result.error);
      }
    }

    if (health.ok) summary.healthOk += 1;
    if (ready.ok) summary.readyOk += 1;
    if (status.ok) summary.statusOk += 1;
    if (metrics.ok) summary.metricsOk += 1;

    const rss = Number(metrics.payload?.metrics?.process?.memory?.rss ?? 0);
    const heapUsed = Number(metrics.payload?.metrics?.process?.memory?.heapUsed ?? 0);
    summary.maxRssBytes = Math.max(summary.maxRssBytes, rss);
    summary.maxHeapUsedBytes = Math.max(summary.maxHeapUsedBytes, heapUsed);
    summary.lastSnapshotGeneratedAt = status.payload?.snapshot?.generatedAt ?? summary.lastSnapshotGeneratedAt;

    process.stdout.write(
      `[${new Date().toISOString()}] sample=${summary.samples} health=${health.status} ready=${ready.status} status=${status.status} metrics=${metrics.status} latencyMs=${Math.round((health.durationMs + ready.durationMs + status.durationMs + metrics.durationMs) / 4)}\n`
    );

    await sleep(intervalMs);
  }

  const avgLatency =
    summary.requestLatenciesMs.length === 0
      ? 0
      : Math.round(summary.requestLatenciesMs.reduce((a, b) => a + b, 0) / summary.requestLatenciesMs.length);

  const report = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    baseUrl,
    durationMinutes,
    pollSeconds,
    samples: summary.samples,
    availability: {
      health: summary.samples === 0 ? 0 : summary.healthOk / summary.samples,
      ready: summary.samples === 0 ? 0 : summary.readyOk / summary.samples,
      status: summary.samples === 0 ? 0 : summary.statusOk / summary.samples,
      metrics: summary.samples === 0 ? 0 : summary.metricsOk / summary.samples,
    },
    latencyMs: {
      avg: avgLatency,
      p95: percentile(summary.requestLatenciesMs, 0.95),
      p99: percentile(summary.requestLatenciesMs, 0.99),
      max: summary.requestLatenciesMs.length ? Math.max(...summary.requestLatenciesMs) : 0,
    },
    memoryBytes: {
      maxRss: summary.maxRssBytes,
      maxHeapUsed: summary.maxHeapUsedBytes,
    },
    lastSnapshotGeneratedAt: summary.lastSnapshotGeneratedAt,
    errorCount: summary.errors.length,
    recentErrors: summary.errors.slice(-20),
  };

  process.stdout.write(`\nSoak report:\n${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`soak failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
