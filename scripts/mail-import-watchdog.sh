#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; printf "%s %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "watchdog fatal rc=$rc line=$LINENO cmd=$BASH_COMMAND" >&2; exit $rc' ERR

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_ROOT=""
SLEEP_SECONDS=60
STALL_SECONDS=600
MAX_RESTARTS_PER_HOUR=6
MAX_RESTARTS_PER_CYCLE=8
DEAD_STREAK_THRESHOLD=2
FLATLINE_PAUSE_SECONDS=120
CLEAR_PAUSE_ON_START=true

CHUNK_SIZE=1
IMPORT_CONCURRENCY_CAP="${MAIL_IMPORT_IMPORT_CONCURRENCY_CAP:-2}"
OPEN_MEMORY_TIMEOUT_MS=60000
OPEN_MEMORY_COMMAND_TIMEOUT_MS=180000
OPEN_MEMORY_REQUEST_RETRIES=2
OPEN_MEMORY_REQUEST_RETRY_BASE_MS=600
MAX_RETRIES=5
WATCHDOG_LOCK_DIR=""
WATCHDOG_LOCK_OWNER=""
PRESSURE_GATING_ENABLED=true
PRESSURE_URL="${STUDIO_BRAIN_PRESSURE_URL:-http://127.0.0.1:4540/api/memory/pressure}"
PRESSURE_TIMEOUT_SECONDS=2
PRESSURE_COOLDOWN_SECONDS="${MAIL_IMPORT_PRESSURE_COOLDOWN_SECONDS:-45}"
PRESSURE_HARD_MAX_IN_FLIGHT=0
PRESSURE_QUEUE_DEPTH_THRESHOLD="${MAIL_IMPORT_PRESSURE_QUEUE_DEPTH_THRESHOLD:-1}"
PRESSURE_FAIL_OPEN=true
BACKEND_SATURATION_COOLDOWN_SECONDS="${MAIL_IMPORT_BACKEND_SATURATION_COOLDOWN_SECONDS:-120}"
BACKEND_SATURATION_SCAN_LINES=200

usage() {
  cat <<'USAGE'
Usage:
  scripts/mail-import-watchdog.sh --run-root <path> [options]

Required:
  --run-root <path>                     Path to import run root containing w* folders

Options:
  --sleep-seconds <n>                   Poll interval (default: 60)
  --stall-seconds <n>                   No-progress threshold before restart (default: 600)
  --max-restarts-per-hour <n>           Restart cap per worker per rolling hour (default: 6)
  --max-restarts-per-cycle <n>          Global restart cap per cycle (default: 8)
  --dead-streak-threshold <n>           Restart only after N dead checks (default: 2)
  --flatline-pause-seconds <n>          Pause restarts after flatline alert (default: 120)
  --clear-pause-on-start true|false     Clear persisted restart pause state when watchdog starts (default: true)

  --chunk-size <n>                      Worker chunk size (default: 1)
  --import-concurrency-cap <n>          Worker import cap (default: 2)
  --open-memory-timeout-ms <n>          open-memory timeout (default: 60000)
  --open-memory-command-timeout-ms <n>  command timeout (default: 180000)
  --open-memory-request-retries <n>     request retries (default: 2)
  --open-memory-request-retry-base-ms <n> request retry base ms (default: 600)
  --max-retries <n>                     chunk max retries (default: 5)
  --pressure-gating-enabled true|false  Enable pressure-gated restarts (default: true)
  --pressure-url <url>                  Pressure endpoint (default: http://127.0.0.1:4540/api/memory/pressure)
  --pressure-timeout-seconds <n>        Pressure endpoint timeout (default: 2)
  --pressure-cooldown-seconds <n>       Restart cooldown applied when pressure blocks (default: 45)
  --pressure-hard-max-in-flight <n>     Local hard cap fallback for query in-flight (default: 0=disabled)
  --pressure-queue-depth-threshold <n>  Queue depth threshold to block restarts (default: 1)
  --pressure-fail-open true|false       Allow restarts if pressure endpoint unavailable (default: true)
  --backend-saturation-cooldown-seconds <n> Cooldown if worker log shows DB saturation (default: 120)
  --backend-saturation-scan-lines <n>   Tail lines scanned for backend saturation markers (default: 200)
USAGE
}

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

checkpoint_fields() {
  local checkpoint="$1"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    try {
      const raw = fs.readFileSync(p, "utf8");
      const cp = JSON.parse(raw);
      const runId = cp.runId || "";
      const source = cp.source || "mail:outlook";
      const next = Number.isFinite(cp.nextIndex) ? cp.nextIndex : 0;
      const total = Number.isFinite(cp.totalRows) ? cp.totalRows : 0;
      const status = cp.status || "";
      process.stdout.write([runId, source, String(next), String(total), status].join(" ") + "\n");
    } catch {
      process.stdout.write(" parse_error 0 0 \n");
      process.exit(0);
    }
  ' "$checkpoint"
}

require_arg() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "Missing value for $flag" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-root) require_arg "$1" "${2:-}"; RUN_ROOT="$2"; shift 2 ;;
    --sleep-seconds) require_arg "$1" "${2:-}"; SLEEP_SECONDS="$2"; shift 2 ;;
    --stall-seconds) require_arg "$1" "${2:-}"; STALL_SECONDS="$2"; shift 2 ;;
    --max-restarts-per-hour) require_arg "$1" "${2:-}"; MAX_RESTARTS_PER_HOUR="$2"; shift 2 ;;
    --max-restarts-per-cycle) require_arg "$1" "${2:-}"; MAX_RESTARTS_PER_CYCLE="$2"; shift 2 ;;
    --dead-streak-threshold) require_arg "$1" "${2:-}"; DEAD_STREAK_THRESHOLD="$2"; shift 2 ;;
    --flatline-pause-seconds) require_arg "$1" "${2:-}"; FLATLINE_PAUSE_SECONDS="$2"; shift 2 ;;
    --clear-pause-on-start) require_arg "$1" "${2:-}"; CLEAR_PAUSE_ON_START="$2"; shift 2 ;;
    --chunk-size) require_arg "$1" "${2:-}"; CHUNK_SIZE="$2"; shift 2 ;;
    --import-concurrency-cap) require_arg "$1" "${2:-}"; IMPORT_CONCURRENCY_CAP="$2"; shift 2 ;;
    --open-memory-timeout-ms) require_arg "$1" "${2:-}"; OPEN_MEMORY_TIMEOUT_MS="$2"; shift 2 ;;
    --open-memory-command-timeout-ms) require_arg "$1" "${2:-}"; OPEN_MEMORY_COMMAND_TIMEOUT_MS="$2"; shift 2 ;;
    --open-memory-request-retries) require_arg "$1" "${2:-}"; OPEN_MEMORY_REQUEST_RETRIES="$2"; shift 2 ;;
    --open-memory-request-retry-base-ms) require_arg "$1" "${2:-}"; OPEN_MEMORY_REQUEST_RETRY_BASE_MS="$2"; shift 2 ;;
    --max-retries) require_arg "$1" "${2:-}"; MAX_RETRIES="$2"; shift 2 ;;
    --pressure-gating-enabled) require_arg "$1" "${2:-}"; PRESSURE_GATING_ENABLED="$2"; shift 2 ;;
    --pressure-url) require_arg "$1" "${2:-}"; PRESSURE_URL="$2"; shift 2 ;;
    --pressure-timeout-seconds) require_arg "$1" "${2:-}"; PRESSURE_TIMEOUT_SECONDS="$2"; shift 2 ;;
    --pressure-cooldown-seconds) require_arg "$1" "${2:-}"; PRESSURE_COOLDOWN_SECONDS="$2"; shift 2 ;;
    --pressure-hard-max-in-flight) require_arg "$1" "${2:-}"; PRESSURE_HARD_MAX_IN_FLIGHT="$2"; shift 2 ;;
    --pressure-queue-depth-threshold) require_arg "$1" "${2:-}"; PRESSURE_QUEUE_DEPTH_THRESHOLD="$2"; shift 2 ;;
    --pressure-fail-open) require_arg "$1" "${2:-}"; PRESSURE_FAIL_OPEN="$2"; shift 2 ;;
    --backend-saturation-cooldown-seconds) require_arg "$1" "${2:-}"; BACKEND_SATURATION_COOLDOWN_SECONDS="$2"; shift 2 ;;
    --backend-saturation-scan-lines) require_arg "$1" "${2:-}"; BACKEND_SATURATION_SCAN_LINES="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$RUN_ROOT" ]]; then
  usage
  exit 2
fi

if [[ ! -d "$RUN_ROOT" ]]; then
  echo "Run root not found: $RUN_ROOT" >&2
  exit 2
fi

STATE_DIR="$RUN_ROOT/.watchdog-state"
mkdir -p "$STATE_DIR"

WATCHDOG_LOCK_DIR="$STATE_DIR/.singleton.lock"
if ! mkdir "$WATCHDOG_LOCK_DIR" 2>/dev/null; then
  existing_pid="$(cat "$WATCHDOG_LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    log "another watchdog is already running pid=$existing_pid run_root=$RUN_ROOT; exiting"
    exit 0
  fi
  rm -rf "$WATCHDOG_LOCK_DIR" 2>/dev/null || true
  mkdir "$WATCHDOG_LOCK_DIR"
fi
WATCHDOG_LOCK_OWNER="$$"
echo "$WATCHDOG_LOCK_OWNER" > "$WATCHDOG_LOCK_DIR/pid"
trap 'if [[ -n "$WATCHDOG_LOCK_DIR" && -d "$WATCHDOG_LOCK_DIR" ]]; then owner="$(cat "$WATCHDOG_LOCK_DIR/pid" 2>/dev/null || true)"; if [[ -n "$owner" && "$owner" == "$WATCHDOG_LOCK_OWNER" ]]; then rm -rf "$WATCHDOG_LOCK_DIR" 2>/dev/null || true; fi; fi' EXIT INT TERM

if [[ "${CLEAR_PAUSE_ON_START,,}" == "true" ]]; then
  cycle_state_start="$STATE_DIR/.cycle.state"
  touch "$cycle_state_start"
  sed -i '/^pause_restarts_until_epoch=/d' "$cycle_state_start" 2>/dev/null || true
  printf 'pause_restarts_until_epoch=0\n' >> "$cycle_state_start"
fi

log "watchdog start run_root=$RUN_ROOT sleep=${SLEEP_SECONDS}s stall=${STALL_SECONDS}s max_restarts_per_hour=$MAX_RESTARTS_PER_HOUR max_restarts_per_cycle=$MAX_RESTARTS_PER_CYCLE dead_streak_threshold=$DEAD_STREAK_THRESHOLD flatline_pause_seconds=$FLATLINE_PAUSE_SECONDS clear_pause_on_start=$CLEAR_PAUSE_ON_START pressure_gating_enabled=$PRESSURE_GATING_ENABLED pressure_url=$PRESSURE_URL pressure_timeout_seconds=$PRESSURE_TIMEOUT_SECONDS pressure_cooldown_seconds=$PRESSURE_COOLDOWN_SECONDS pressure_fail_open=$PRESSURE_FAIL_OPEN backend_saturation_cooldown_seconds=$BACKEND_SATURATION_COOLDOWN_SECONDS"

restart_worker() {
  local wdir="$1"
  local run_id="$2"
  local source="$3"
  local lock_dir="$wdir/.watchdog-start.lock"
  local worker_log="$wdir/watchdog-worker.log"
  local pid_file="$STATE_DIR/${run_id}.pid"

  if ! mkdir "$lock_dir" 2>/dev/null; then
    log "skip start (lock busy) run_id=$run_id"
    return 0
  fi

  (
    cd "$REPO_ROOT"
    nohup node ./scripts/open-memory-mail-import.mjs \
      --mode outlook \
      --stage-mode ingest-only \
      --source "$source" \
      --run-id "$run_id" \
      --run-root "$wdir" \
      --snapshot "$wdir/mail-memory-outlook-snapshot.jsonl" \
      --checkpoint "$wdir/mail-import-checkpoint.json" \
      --ledger "$wdir/mail-import-ledger.jsonl" \
      --dead-letter "$wdir/mail-import-dead-letter.jsonl" \
      --report "$wdir/mail-import-report.json" \
      --chunk-size "$CHUNK_SIZE" \
      --post-chunk-sleep-ms 0 \
      --import-concurrency-cap "$IMPORT_CONCURRENCY_CAP" \
      --open-memory-timeout-ms "$OPEN_MEMORY_TIMEOUT_MS" \
      --open-memory-command-timeout-ms "$OPEN_MEMORY_COMMAND_TIMEOUT_MS" \
      --open-memory-request-retries "$OPEN_MEMORY_REQUEST_RETRIES" \
      --open-memory-request-retry-base-ms "$OPEN_MEMORY_REQUEST_RETRY_BASE_MS" \
      --max-retries "$MAX_RETRIES" \
      --disable-run-burst-limit true \
      >> "$worker_log" 2>&1 &
    local new_pid="$!"
    echo "$new_pid" > "$pid_file"
    log "started run_id=$run_id pid=$new_pid source=$source"
  )

  rmdir "$lock_dir" 2>/dev/null || true
}

should_restart_now() {
  local state_file="$1"
  local now="$2"
  local restarts_raw
  restarts_raw="$(awk -F= '/^restarts=/{print $2}' "$state_file" 2>/dev/null || true)"

  local kept=()
  local count=0
  if [[ -n "$restarts_raw" ]]; then
    IFS=',' read -r -a all <<< "$restarts_raw"
    for ts in "${all[@]}"; do
      [[ -z "$ts" ]] && continue
      if (( now - ts < 3600 )); then
        kept+=("$ts")
        ((count+=1))
      fi
    done
  fi

  if (( count >= MAX_RESTARTS_PER_HOUR )); then
    printf '%s\n' "NO"
    return 0
  fi

  kept+=("$now")
  local joined=""
  for ts in "${kept[@]}"; do
    if [[ -z "$joined" ]]; then
      joined="$ts"
    else
      joined="$joined,$ts"
    fi
  done
  sed -i '/^restarts=/d' "$state_file" 2>/dev/null || true
  printf 'restarts=%s\n' "$joined" >> "$state_file"
  printf '%s\n' "YES"
}

write_state_kv() {
  local state_file="$1"
  local key="$2"
  local value="$3"
  sed -i "/^${key}=.*/d" "$state_file" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "$state_file"
}

pressure_gate_snapshot() {
  local tmp_json=""
  local parse_output=""
  tmp_json="$(mktemp)"

  if ! curl -fsS --max-time "$PRESSURE_TIMEOUT_SECONDS" "$PRESSURE_URL" > "$tmp_json" 2>/dev/null; then
    rm -f "$tmp_json" 2>/dev/null || true
    if [[ "${PRESSURE_FAIL_OPEN,,}" == "true" ]]; then
      printf 'ALLOW 0 pressure-unreachable 0 0 0 0 0\n'
    else
      printf 'BLOCK %s pressure-unreachable 0 0 0 0 0\n' "$PRESSURE_COOLDOWN_SECONDS"
    fi
    return 0
  fi

  if ! parse_output="$(
    node - "$tmp_json" "$PRESSURE_HARD_MAX_IN_FLIGHT" "$PRESSURE_QUEUE_DEPTH_THRESHOLD" "$PRESSURE_COOLDOWN_SECONDS" <<'NODE'
const fs = require("fs");

const [file, hardMaxRaw, queueThresholdRaw, cooldownRaw] = process.argv.slice(2);
const hardMax = Number.isFinite(Number(hardMaxRaw)) ? Number(hardMaxRaw) : 0;
const queueThreshold = Number.isFinite(Number(queueThresholdRaw)) ? Number(queueThresholdRaw) : 1;
const cooldown = Number.isFinite(Number(cooldownRaw)) ? Number(cooldownRaw) : 45;

const raw = fs.readFileSync(file, "utf8");
const body = raw ? JSON.parse(raw) : {};

const getPath = (obj, path) =>
  path.split(".").reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
    return undefined;
  }, obj);

const first = (paths, predicate) => {
  for (const p of paths) {
    const v = getPath(body, p);
    if (predicate(v)) return v;
  }
  return undefined;
};

const num = (paths, fallback = 0) => {
  const direct = first(paths, (v) => typeof v === "number" && Number.isFinite(v));
  if (typeof direct === "number") return direct;
  const fromString = first(
    paths,
    (v) => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
  );
  if (typeof fromString === "string") return Number(fromString);
  return fallback;
};

const bool = (paths) => {
  const direct = first(paths, (v) => typeof v === "boolean");
  if (typeof direct === "boolean") return direct;
  const fromString = first(paths, (v) => typeof v === "string");
  if (typeof fromString === "string") {
    const norm = fromString.trim().toLowerCase();
    if (norm === "true") return true;
    if (norm === "false") return false;
  }
  return false;
};

const inFlight = num([
  "query.inFlight",
  "query.inFlightCount",
  "query.active",
  "query.inflight",
  "metrics.queryInFlight",
  "memory.query.inFlight",
  "inFlight",
  "queryPressure.inFlight"
]);

const limit = num([
  "query.limit",
  "query.maxInFlight",
  "query.maxConcurrency",
  "query.concurrencyLimit",
  "metrics.queryLimit",
  "memory.query.limit",
  "limit",
  "queryPressure.limit"
]);

const queueDepth = num([
  "query.queueDepth",
  "query.pending",
  "query.backlog",
  "metrics.queueDepth",
  "memory.query.queueDepth",
  "queueDepth",
  "queryPressure.queueDepth"
]);

const shed = num([
  "query.shedCount",
  "query.shed",
  "query.dropped",
  "metrics.queryShedCount",
  "memory.query.shedCount",
  "queryShedCount",
  "shedCount"
]);

const degraded = num([
  "query.degradedCount",
  "query.degraded",
  "metrics.queryDegradedCount",
  "memory.query.degradedCount",
  "queryDegradedCount",
  "degradedCount"
]);

const overloaded =
  bool([
    "query.overloaded",
    "query.isOverloaded",
    "metrics.queryOverloaded",
    "memory.query.overloaded",
    "overloaded",
    "queryPressure.overloaded"
  ]) || (limit > 0 && inFlight >= limit);

let action = "ALLOW";
let reason = "ok";

if (overloaded) {
  action = "BLOCK";
  reason = "overloaded";
} else if (shed > 0) {
  action = "BLOCK";
  reason = "shed";
} else if (hardMax > 0 && inFlight >= hardMax) {
  action = "BLOCK";
  reason = "hard-max";
} else if (queueThreshold > 0 && queueDepth >= queueThreshold) {
  action = "BLOCK";
  reason = "queue-depth";
}

const wait = action === "BLOCK" ? cooldown : 0;
process.stdout.write(
  `${action} ${wait} ${reason} ${inFlight} ${limit} ${queueDepth} ${shed} ${degraded}\n`
);
NODE
  )"; then
    rm -f "$tmp_json" 2>/dev/null || true
    if [[ "${PRESSURE_FAIL_OPEN,,}" == "true" ]]; then
      printf 'ALLOW 0 pressure-parse-error 0 0 0 0 0\n'
    else
      printf 'BLOCK %s pressure-parse-error 0 0 0 0 0\n' "$PRESSURE_COOLDOWN_SECONDS"
    fi
    return 0
  fi

  rm -f "$tmp_json" 2>/dev/null || true
  printf '%s\n' "$parse_output"
}

worker_log_has_backend_saturation() {
  local wdir="$1"
  local worker_log="$wdir/watchdog-worker.log"
  [[ -f "$worker_log" ]] || return 1

  if tail -n "$BACKEND_SATURATION_SCAN_LINES" "$worker_log" \
    | grep -Eiq 'too many clients already|remaining connection slots are reserved|too many connections for role'; then
    return 0
  fi
  return 1
}

cleanup_watchdog_lock() {
  if [[ -n "$WATCHDOG_LOCK_DIR" && -d "$WATCHDOG_LOCK_DIR" ]]; then
    local owner=""
    owner="$(cat "$WATCHDOG_LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "$owner" && "$owner" == "$WATCHDOG_LOCK_OWNER" ]]; then
      rm -rf "$WATCHDOG_LOCK_DIR" 2>/dev/null || true
    fi
  fi
}

heal_missing_chunk_file() {
  local wdir="$1"
  local ledger="$wdir/mail-import-ledger.jsonl"
  local snapshot="$wdir/mail-memory-outlook-snapshot.jsonl"

  [[ -f "$ledger" ]] || return 1
  [[ -f "$snapshot" ]] || return 1

  local enoent_line=""
  enoent_line="$(tail -n 20 "$ledger" | tac | grep -m1 "ENOENT: no such file or directory, open '" || true)"
  [[ -n "$enoent_line" ]] || return 1

  local missing_path=""
  missing_path="$(printf '%s' "$enoent_line" | sed -n "s/.*ENOENT: no such file or directory, open '\\([^']\\+\\)'.*/\\1/p")"
  [[ -n "$missing_path" ]] || return 1
  [[ ! -f "$missing_path" ]] || return 1

  local base
  base="$(basename "$missing_path")"
  local chunk_start chunk_end
  if [[ "$base" =~ \.chunk-([0-9]+)-([0-9]+)-[0-9a-f]+\.jsonl$ ]]; then
    chunk_start="${BASH_REMATCH[1]}"
    chunk_end="${BASH_REMATCH[2]}"
  else
    return 1
  fi

  local start_line=$((chunk_start + 1))
  local end_line=$((chunk_end))
  local tmp_file="${missing_path}.tmp.$$"

  mkdir -p "$(dirname "$missing_path")"
  sed -n "${start_line},${end_line}p" "$snapshot" > "$tmp_file" || true
  if [[ -s "$tmp_file" ]]; then
    mv "$tmp_file" "$missing_path"
    log "auto-heal chunk-file worker=$(basename "$wdir") chunk=$base lines=${start_line}-${end_line}"
    return 0
  fi

  rm -f "$tmp_file" 2>/dev/null || true
  return 1
}

emit_flatline_diagnostics() {
  local root="$1"
  node - "$root" <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
let dirs = [];
try {
  dirs = fs.readdirSync(root).filter((d) => /^w\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
} catch {
  process.exit(0);
}

const workers = [];
for (const d of dirs) {
  const w = path.join(root, d);
  let cp = {};
  let last = {};
  try {
    cp = JSON.parse(fs.readFileSync(path.join(w, "mail-import-checkpoint.json"), "utf8"));
  } catch {}
  try {
    const raw = fs.readFileSync(path.join(w, "mail-import-ledger.jsonl"), "utf8").trim();
    if (raw) {
      const tail = raw.split("\n").pop();
      if (tail) last = JSON.parse(tail);
    }
  } catch {}
  workers.push({
    worker: d,
    runId: cp.runId || null,
    nextIndex: Number.isFinite(cp.nextIndex) ? cp.nextIndex : null,
    totalRows: Number.isFinite(cp.totalRows) ? cp.totalRows : null,
    status: cp.status || null,
    lastTs: last.ts || null,
    lastOk: typeof last.ok === "boolean" ? last.ok : null,
    lastImported: Number.isFinite(last.imported) ? last.imported : null,
    lastFailed: Number.isFinite(last.failed) ? last.failed : null,
    lastError: typeof last.error === "string" ? last.error : null
  });
}

const out = {
  ts: new Date().toISOString(),
  runRoot: root,
  workers: workers.length,
  workerStatus: workers
};
fs.writeFileSync(path.join(root, "watchdog-diagnostics.json"), JSON.stringify(out, null, 2));
NODE
}

while true; do
  now_epoch="$(date -u +%s)"
  mapfile -t workers < <(find "$RUN_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'w*' | sort -V)

  active_count=0
  restart_count=0
  stalled_count=0
  sum_next=0
  sum_total=0
  restart_budget="$MAX_RESTARTS_PER_CYCLE"
  cycle_state="$STATE_DIR/.cycle.state"
  touch "$cycle_state"
  pause_restarts_until_epoch="$(awk -F= '/^pause_restarts_until_epoch=/{print $2}' "$cycle_state" 2>/dev/null || true)"
  [[ -n "$pause_restarts_until_epoch" ]] || pause_restarts_until_epoch=0
  restart_paused="no"
  if (( now_epoch < pause_restarts_until_epoch )); then
    restart_paused="yes"
  fi
  pressure_action="ALLOW"
  pressure_wait=0
  pressure_reason="ok"
  pressure_in_flight=0
  pressure_limit=0
  pressure_queue_depth=0
  pressure_shed=0
  pressure_degraded=0
  pressure_suppressed_count=0
  backend_saturation_suppressed_count=0

  if [[ "${PRESSURE_GATING_ENABLED,,}" == "true" ]]; then
    read -r pressure_action pressure_wait pressure_reason pressure_in_flight pressure_limit pressure_queue_depth pressure_shed pressure_degraded < <(pressure_gate_snapshot)
    if [[ "$pressure_action" == "BLOCK" ]]; then
      candidate_pause_until=$((now_epoch + pressure_wait))
      if (( candidate_pause_until > pause_restarts_until_epoch )); then
        pause_restarts_until_epoch="$candidate_pause_until"
        write_state_kv "$cycle_state" "pause_restarts_until_epoch" "$pause_restarts_until_epoch"
      fi
      restart_paused="yes"
      log "pressure-gate block reason=$pressure_reason in_flight=$pressure_in_flight limit=$pressure_limit queue_depth=$pressure_queue_depth shed=$pressure_shed degraded=$pressure_degraded cooldown=${pressure_wait}s"
    fi
  fi

  for wdir in "${workers[@]}"; do
    checkpoint="$wdir/mail-import-checkpoint.json"
    [[ -f "$checkpoint" ]] || { log "skip (no checkpoint) worker=$(basename "$wdir")"; continue; }

    read -r run_id source next_index total_rows status < <(checkpoint_fields "$checkpoint") || true

    if [[ -z "$run_id" ]]; then
      log "skip (missing runId) worker=$(basename "$wdir")"
      continue
    fi

    if [[ "$source" == "parse_error" ]]; then
      log "skip (checkpoint parse race) worker=$(basename "$wdir")"
      continue
    fi

    sum_next=$((sum_next + next_index))
    sum_total=$((sum_total + total_rows))

    state_file="$STATE_DIR/${run_id}.state"
    touch "$state_file"

    prev_next="$(awk -F= '/^last_next=/{print $2}' "$state_file" 2>/dev/null || true)"
    last_advance="$(awk -F= '/^last_advance_epoch=/{print $2}' "$state_file" 2>/dev/null || true)"
    dead_streak="$(awk -F= '/^dead_streak=/{print $2}' "$state_file" 2>/dev/null || true)"
    [[ -n "$prev_next" ]] || prev_next="$next_index"
    [[ -n "$last_advance" ]] || last_advance="$now_epoch"
    [[ -n "$dead_streak" ]] || dead_streak=0

    if (( next_index > prev_next )); then
      last_advance="$now_epoch"
      write_state_kv "$state_file" "last_advance_epoch" "$last_advance"
      write_state_kv "$state_file" "last_next" "$next_index"
      write_state_kv "$state_file" "restart_backoff_seconds" "0"
      write_state_kv "$state_file" "restart_not_before_epoch" "0"
      dead_streak=0
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
    else
      write_state_kv "$state_file" "last_next" "$next_index"
    fi

    mapfile -t pids < <(
      pgrep -af "open-memory-mail-import.mjs" \
        | awk -v id="$run_id" 'index($0, "--run-id " id " ") || $0 ~ ("--run-id " id "$") { print $1 }'
    ) || true
    pid_count="${#pids[@]}"
    alive="no"
    if (( pid_count > 0 )); then
      alive="yes"
    fi

    needs_restart="no"
    reason=""
    if (( total_rows > 0 && next_index >= total_rows )); then
      if (( pid_count > 0 )); then
        for pid in "${pids[@]}"; do
          kill "$pid" 2>/dev/null || true
        done
        log "stopped-complete run_id=$run_id killed=$pid_count"
        alive="no"
        pid_count=0
      fi
      reason="complete"
      needs_restart="no"
      dead_streak=0
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
    elif [[ "$alive" == "no" ]]; then
      dead_streak=$((dead_streak + 1))
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
      if (( dead_streak >= DEAD_STREAK_THRESHOLD )); then
        needs_restart="yes"
        reason="dead"
      else
        needs_restart="no"
        reason="dead-wait"
      fi
    elif (( now_epoch - last_advance >= STALL_SECONDS )); then
      needs_restart="yes"
      reason="stalled"
      stalled_count=$((stalled_count + 1))
      dead_streak=0
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
    elif (( pid_count > 1 )); then
      reason="duplicate-pids"
      for ((i=1; i<pid_count; i++)); do
        kill "${pids[$i]}" 2>/dev/null || true
      done
      log "trimmed duplicates run_id=$run_id kept_pid=${pids[0]} killed=$((pid_count-1))"
      dead_streak=0
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
    else
      reason="ok"
      dead_streak=0
      write_state_kv "$state_file" "dead_streak" "$dead_streak"
    fi

    if [[ "$reason" == "dead" || "$reason" == "stalled" ]]; then
      heal_missing_chunk_file "$wdir" || true
    fi

    if [[ "$needs_restart" == "yes" ]]; then
      if [[ "$restart_paused" == "yes" ]]; then
        wait_for=$((pause_restarts_until_epoch - now_epoch))
        if [[ "$pressure_action" == "BLOCK" ]]; then
          pressure_suppressed_count=$((pressure_suppressed_count + 1))
          log "restart-suppressed run_id=$run_id reason=$reason pressure_reason=$pressure_reason wait=${wait_for}s"
        else
          log "restart-suppressed run_id=$run_id reason=$reason global_pause=${wait_for}s"
        fi
      elif worker_log_has_backend_saturation "$wdir"; then
        backend_saturation_suppressed_count=$((backend_saturation_suppressed_count + 1))
        write_state_kv "$state_file" "restart_backoff_seconds" "$BACKEND_SATURATION_COOLDOWN_SECONDS"
        write_state_kv "$state_file" "restart_not_before_epoch" "$((now_epoch + BACKEND_SATURATION_COOLDOWN_SECONDS))"
        log "restart-suppressed run_id=$run_id reason=$reason backend_saturation=true cooldown=${BACKEND_SATURATION_COOLDOWN_SECONDS}s"
      else
        not_before="$(awk -F= '/^restart_not_before_epoch=/{print $2}' "$state_file" 2>/dev/null || true)"
        [[ -n "$not_before" ]] || not_before=0
        if (( now_epoch < not_before )); then
          wait_for=$((not_before - now_epoch))
          log "restart-suppressed run_id=$run_id reason=$reason cooldown=${wait_for}s"
        elif (( restart_budget <= 0 )); then
          log "restart-suppressed run_id=$run_id reason=$reason cycle_budget_exhausted"
        else
          allow="$(should_restart_now "$state_file" "$now_epoch")"
          if [[ "$allow" == "YES" ]]; then
            restart_worker "$wdir" "$run_id" "$source"
            restart_count=$((restart_count + 1))
            restart_budget=$((restart_budget - 1))
            alive="yes"

            prior_backoff="$(awk -F= '/^restart_backoff_seconds=/{print $2}' "$state_file" 2>/dev/null || true)"
            [[ -n "$prior_backoff" ]] || prior_backoff=0
            if (( prior_backoff <= 0 )); then
              next_backoff=15
            else
              next_backoff=$((prior_backoff * 2))
              (( next_backoff > 300 )) && next_backoff=300
            fi
            write_state_kv "$state_file" "restart_backoff_seconds" "$next_backoff"
            write_state_kv "$state_file" "restart_not_before_epoch" "$((now_epoch + next_backoff))"
          else
            log "restart-suppressed run_id=$run_id reason=$reason cap=${MAX_RESTARTS_PER_HOUR}/h"
          fi
        fi
      fi
    fi

    if [[ "$alive" == "yes" ]]; then
      active_count=$((active_count + 1))
    fi

    log "worker=$(basename "$wdir") run_id=$run_id alive=$alive next=$next_index total=$total_rows status=$status reason=$reason"
  done

  last_cycle_epoch="$(awk -F= '/^last_epoch=/{print $2}' "$cycle_state" 2>/dev/null || true)"
  last_cycle_next="$(awk -F= '/^last_sum_next=/{print $2}' "$cycle_state" 2>/dev/null || true)"
  flatline_streak="$(awk -F= '/^flatline_streak=/{print $2}' "$cycle_state" 2>/dev/null || true)"
  [[ -n "$last_cycle_epoch" ]] || last_cycle_epoch="$now_epoch"
  [[ -n "$last_cycle_next" ]] || last_cycle_next="$sum_next"
  [[ -n "$flatline_streak" ]] || flatline_streak=0

  delta_seconds=$((now_epoch - last_cycle_epoch))
  (( delta_seconds > 0 )) || delta_seconds=1
  delta_next=$((sum_next - last_cycle_next))
  items_per_min="$(awk -v dn="$delta_next" -v ds="$delta_seconds" 'BEGIN { printf "%.2f", (dn*60)/ds }')"

  if (( delta_next <= 0 )); then
    flatline_streak=$((flatline_streak + 1))
  else
    flatline_streak=0
  fi

  write_state_kv "$cycle_state" "last_epoch" "$now_epoch"
  write_state_kv "$cycle_state" "last_sum_next" "$sum_next"
  write_state_kv "$cycle_state" "flatline_streak" "$flatline_streak"

  if (( flatline_streak >= 3 )); then
    pause_restarts_until_epoch=$((now_epoch + FLATLINE_PAUSE_SECONDS))
    write_state_kv "$cycle_state" "pause_restarts_until_epoch" "$pause_restarts_until_epoch"
    emit_flatline_diagnostics "$RUN_ROOT" || true
    log "ALERT flatline detected streak=$flatline_streak delta_next=$delta_next over ${delta_seconds}s"
  elif (( delta_next > 0 )); then
    write_state_kv "$cycle_state" "pause_restarts_until_epoch" "0"
  fi

  cycle_ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  metrics_json="$RUN_ROOT/watchdog-metrics.json"
  metrics_jsonl="$RUN_ROOT/watchdog-metrics.jsonl"
  cat > "$metrics_json" <<EOF
{
  "ts": "$cycle_ts",
  "runRoot": "$RUN_ROOT",
  "workers": ${#workers[@]},
  "activeWorkers": $active_count,
  "restartPaused": "$restart_paused",
  "restarts": $restart_count,
  "restartBudgetRemaining": $restart_budget,
  "stalledWorkers": $stalled_count,
  "sumNextIndex": $sum_next,
  "sumTotalRows": $sum_total,
  "deltaNextIndex": $delta_next,
  "deltaSeconds": $delta_seconds,
  "itemsPerMinute": $items_per_min,
  "flatlineStreak": $flatline_streak,
  "pressureGateEnabled": "$PRESSURE_GATING_ENABLED",
  "pressureGateAction": "$pressure_action",
  "pressureGateReason": "$pressure_reason",
  "pressureInFlight": $pressure_in_flight,
  "pressureLimit": $pressure_limit,
  "pressureQueueDepth": $pressure_queue_depth,
  "pressureShed": $pressure_shed,
  "pressureDegraded": $pressure_degraded,
  "pressureSuppressedRestarts": $pressure_suppressed_count,
  "backendSaturationSuppressedRestarts": $backend_saturation_suppressed_count
}
EOF
  printf '{"ts":"%s","workers":%d,"activeWorkers":%d,"restartPaused":"%s","restarts":%d,"restartBudgetRemaining":%d,"stalledWorkers":%d,"sumNextIndex":%d,"sumTotalRows":%d,"deltaNextIndex":%d,"deltaSeconds":%d,"itemsPerMinute":%s,"flatlineStreak":%d,"pressureGateEnabled":"%s","pressureGateAction":"%s","pressureGateReason":"%s","pressureInFlight":%d,"pressureLimit":%d,"pressureQueueDepth":%d,"pressureShed":%d,"pressureDegraded":%d,"pressureSuppressedRestarts":%d,"backendSaturationSuppressedRestarts":%d}\n' \
    "$cycle_ts" "${#workers[@]}" "$active_count" "$restart_paused" "$restart_count" "$restart_budget" "$stalled_count" "$sum_next" "$sum_total" "$delta_next" "$delta_seconds" "$items_per_min" "$flatline_streak" "$PRESSURE_GATING_ENABLED" "$pressure_action" "$pressure_reason" "$pressure_in_flight" "$pressure_limit" "$pressure_queue_depth" "$pressure_shed" "$pressure_degraded" "$pressure_suppressed_count" "$backend_saturation_suppressed_count" >> "$metrics_jsonl"

  log "cycle-summary workers=${#workers[@]} active=$active_count paused=$restart_paused restarts=$restart_count restart_budget_remaining=$restart_budget stalled=$stalled_count ipm=$items_per_min delta_next=$delta_next pressure_action=$pressure_action pressure_reason=$pressure_reason pressure_suppressed=$pressure_suppressed_count backend_saturation_suppressed=$backend_saturation_suppressed_count"
  sleep "$SLEEP_SECONDS"
done
