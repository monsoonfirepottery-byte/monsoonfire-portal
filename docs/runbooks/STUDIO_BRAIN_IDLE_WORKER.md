# Studio Brain Idle Worker

The idle worker turns spare Studio Brain host time into safe, bounded maintenance. It starts with four lanes:

- Memory ops: runs Studio Brain memory consolidation with idle or overnight budgets.
- Repo health: runs read-only repo audit commands behind the branch/status guard.
- Agent harness: writes one bounded next-work packet plus success/failure metrics for the next Codex session.
- Wiki intelligence: loops through the Postgres-backed wiki information lanes in report-only mode by default: source indexing, deterministic extraction, contradiction scanning, context-pack generation, export drift checks, idle-task queue planning, and query-plan probes.

The worker is a one-shot command by default. Schedule it with a timer instead of leaving an extra permanent process around.

Repo-backed systemd assets live in:

```text
config/studiobrain/systemd/studio-brain-idle-worker.*
config/studiobrain/systemd/studio-brain-idle-worker-overnight.*
```

## Commands

```bash
npm run studio:ops:idle-worker:dry
npm run studio:ops:idle-worker
npm run studio:ops:idle-worker:overnight
npm run studio:ops:idle-worker:wiki
npm run studio:ops:agent-harness
npm run wiki:gate
```

The default npm commands print a terse operator summary and always write the full JSON report to `output/studio-brain/idle-worker/latest.json`. Use the `:json` variants when a caller needs the full report on stdout:

```bash
npm run studio:ops:idle-worker:dry:json
npm run studio:ops:idle-worker:json
npm run studio:ops:idle-worker:overnight:json
```

Direct examples:

```bash
node ./scripts/studiobrain-idle-worker.mjs --profile idle --jobs memory,repo,harness,wiki
node ./scripts/studiobrain-idle-worker.mjs --profile overnight --jobs memory,repo,harness,wiki --repo-depth standard
node ./scripts/studiobrain-idle-worker.mjs --profile idle --jobs wiki --wiki-mode check
node ./scripts/studiobrain-idle-worker.mjs --profile overnight --jobs wiki --wiki-mode refresh --dry-run --json
node ./scripts/studiobrain-idle-worker.mjs --jobs repo --repo-depth deep --dry-run --json
node ./scripts/studiobrain-agent-harness-work-packet.mjs --write --json
```

Artifacts are written under:

```text
output/studio-brain/idle-worker/
output/studio-brain/agent-harness/
output/wiki/
```

The latest consolidated report is:

```text
output/studio-brain/idle-worker/latest.json
output/studio-brain/agent-harness/next-work.json
output/studio-brain/agent-harness/success-metrics.json
```

## Wiki Lane Modes

The wiki lane is deliberately split into modes:

- `check`: default for systemd and npm idle-worker commands. It writes only ignored JSON report artifacts under `output/` and does not mutate Postgres or tracked wiki markdown.
- `refresh`: writes deterministic tracked markdown/wiki exports for human git-diff review, but does not write Postgres.
- `apply`: writes wiki rows to Postgres and refreshes markdown exports. Use only when intentionally applying reviewed wiki state.

The default lane sequence is:

```text
wiki-source-index-check
wiki-claim-extraction-check
wiki-contradiction-scan
wiki-context-pack-refresh
wiki-export-drift-check
wiki-idle-task-queue
wiki-db-probe-plan
```

`wiki-contradiction-scan` can make the overall idle-worker result `passed_with_warnings`; that is expected when it finds open conflicts for human review. If a current `OPERATIONAL_TRUTH` claim wins but the losing evidence is isolated to a paused owner surface, the contradiction is `blocked` and remains visible without entering the ready queue.

`wiki:gate` is the local/CI guard for the wiki loop. It runs the wiki-related tests, validates the scaffold, checks deterministic export drift, and runs the effectiveness audit. A passing gate means git markdown matches generated wiki state and the loop is not hiding its blocked work.

## Agent Harness Success Metric

The harness is intentionally tiny. It does not create a new daemon, database, dashboard, or autonomous patch loop. Each run writes:

- `next-work.json`: at most three recommended packets for the next Codex session.
- `success-metrics.json`: readiness score plus real-use verdict.
- `outcomes.jsonl`: only when a human/Codex records whether a packet helped.

The harness consumes the wiki lane only through deterministic JSON artifacts. In particular, hard wiki contradictions create a human-gated next-work packet; they do not auto-edit verified pages, promote claims, or decide customer-facing truth.

Record real use after a session:

```bash
node ./scripts/studiobrain-agent-harness-work-packet.mjs \
  --record-outcome wp-example \
  --outcome helpful \
  --minutes-saved 5
```

Decision rule:

- Candidate success: the generated packet set has fresh enough sources, at least one bounded action, and no new infrastructure.
- Real success: after at least 3 recorded outcomes, helpful rate is at least 50% or total saved orientation time is at least 15 minutes, and stale/misleading outcomes stay at or below 25%.
- Failure: after at least 3 recorded outcomes, it misses both usefulness thresholds or stale/misleading outcomes exceed 25%.

## Safety Model

Safe automatic actions:

- memory consolidation through the Studio Brain API,
- read-only repo inventories,
- branch/status guarded repo audits,
- agent harness next-work packet generation,
- report-only wiki source/extraction/contradiction/context checks,
- ignored local report artifact writes.

Approval required:

- service restarts,
- process kills,
- database mutation or repair,
- wiki apply mode or autonomous promotion to operational truth,
- tracked wiki markdown refreshes unless intentionally requested,
- file deletion outside ignored report artifacts,
- autonomous code edits or pull requests,
- live deploys or production data writes.

## Scheduling Shape

Use the tracked systemd timers on the Ubuntu host for one-shot execution. They are installed by the existing Studio Brain host support installer:

```bash
sudo bash ./scripts/install-studiobrain-healthcheck.sh
```

For manual inspection after install:

```bash
systemctl status studio-brain-idle-worker.timer --no-pager
systemctl status studio-brain-idle-worker-overnight.timer --no-pager
```

The checked-in idle service shape is:

```ini
[Unit]
Description=Studio Brain idle worker

[Service]
Type=oneshot
WorkingDirectory=/home/wuff/monsoonfire-portal
ExecStart=/usr/bin/npm run studio:ops:idle-worker
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
```

Example timer:

```ini
[Unit]
Description=Run Studio Brain idle worker

[Timer]
OnBootSec=15min
OnUnitInactiveSec=4h
Persistent=true

[Install]
WantedBy=timers.target
```

For the overnight pass, create a second timer that calls:

```bash
npm run studio:ops:idle-worker:overnight
```

## Current Repo Health Depths

- `quick`: agentic inventory, ephemeral artifact guard, harness next-work packet, and wiki report-only information lanes.
- `standard`: quick plus write-surface and destructive-surface inventories.
- `deep`: standard plus security history marker scan.

The worker intentionally does not run build/test sweeps yet because some build surfaces can update tracked generated output. Add those as a later lane once the report-only worker has a clean operating history.
