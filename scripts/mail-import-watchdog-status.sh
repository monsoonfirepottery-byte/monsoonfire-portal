#!/usr/bin/env bash
set -euo pipefail

RUN_ROOT="${1:-}"
if [[ -z "$RUN_ROOT" ]]; then
  echo "Usage: scripts/mail-import-watchdog-status.sh <run-root>" >&2
  exit 2
fi

METRICS="$RUN_ROOT/watchdog-metrics.json"
DIAG="$RUN_ROOT/watchdog-diagnostics.json"

if [[ ! -f "$METRICS" ]]; then
  echo "No metrics file yet: $METRICS" >&2
  exit 1
fi

node - "$METRICS" "$DIAG" <<'NODE'
const fs = require("fs");
const metricsPath = process.argv[2];
const diagPath = process.argv[3];

const m = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
console.log(`ts=${m.ts}`);
console.log(`workers=${m.workers} active=${m.activeWorkers} restarts=${m.restarts} paused=${m.restartPaused} budget=${m.restartBudgetRemaining}`);
console.log(`progress sumNext=${m.sumNextIndex}/${m.sumTotalRows} delta=${m.deltaNextIndex} in ${m.deltaSeconds}s ipm=${m.itemsPerMinute}`);
console.log(`flatline=${m.flatlineStreak} stalledWorkers=${m.stalledWorkers}`);

if (fs.existsSync(diagPath)) {
  const d = JSON.parse(fs.readFileSync(diagPath, "utf8"));
  const problematic = d.workerStatus.filter((w) => (w.status !== "completed") && (w.lastOk === false || w.lastFailed > 0 || w.lastImported === 0));
  console.log(`diagnostics ts=${d.ts} problematic=${problematic.length}`);
  for (const w of problematic.slice(0, 8)) {
    console.log(`  ${w.worker} next=${w.nextIndex}/${w.totalRows} status=${w.status} lastOk=${w.lastOk} imported=${w.lastImported} failed=${w.lastFailed}`);
  }
}
NODE
