# Studio Brain Administrator Effectivity Loop

This loop keeps administrator work focused on reusable infrastructure instead of one-off fixes. Each slice records intent, evidence, commands, artifacts, usefulness, and blockers. Every five slices, the audit command checks whether the work actually improved the operator system.

## Commands

Record a slice:

```bash
node scripts/ops/slice_ledger.mjs --append \
  --slice-id slice-20260507-001 \
  --run-id admin-effectivity-20260507 \
  --lane portal-ops \
  --title "Add slice ledger" \
  --intent "Make swarm work auditable" \
  --status completed \
  --changed-file scripts/ops/slice_ledger.mjs \
  --command "pass:node --check scripts/ops/slice_ledger.mjs" \
  --usefulness-score 0.8
```

Summarize the last five slices:

```bash
node scripts/ops/slice_ledger.mjs --summary --last 5 --json
```

For swarm waves or stacked branches, filter to the active run id so stale rows from another lane do not pollute the five-slice audit:

```bash
node scripts/ops/slice_ledger.mjs --summary --last 5 --run-id admin-effectivity-20260507 --json
node scripts/ops/admin_effectivity_audit.mjs --write --slice-run-id admin-effectivity-20260507
```

The summary includes `auditCadence.auditDue`, `slicesSinceLastAudit`, and `nextAuditAt`. With the default interval of 5, `auditDue=true` means stop the slice loop long enough to run `admin_effectivity_audit.mjs`, inspect usefulness/no-op rate, and then continue with the next safe infrastructure slice.

Inventory local tool availability:

```bash
node scripts/ops/installed_tool_inventory.mjs --json --write
```

Run the every-five-slices audit:

```bash
make ops-admin-effectivity-audit
```

The Make target writes JSON and Markdown under `output/ops/effectivity/`, which is ignored by Git. Curated summaries can be copied into docs or tickets when they become durable operator evidence.

Generate the next safe ops work packets:

```bash
node scripts/studiobrain-ops-work-packet.mjs --json --write
```

The work-packet generator still uses the durable docs as its baseline, then enriches packets from ignored current artifacts when present:

- `--admin-audit output/ops/effectivity/admin-effectivity-audit-latest.json`
- `--slice-ledger output/ops/effectivity/slice-ledger-latest.json`
- `--tool-inventory output/ops/effectivity/installed-tool-inventory-latest.json`
- `--max-age-hours 24`

Missing, invalid, or stale fresh artifacts degrade to warnings and docs-only packet generation. The generator should not run the audit itself; run `make ops-admin-effectivity-audit` first when fresh steering is needed.

Validate generated ops artifacts against their committed schemas:

```bash
node scripts/ops/validate_ops_artifacts.mjs --json --write
```

Missing ignored artifacts are warnings. Schema mismatches are failures because they mean a dashboard, swarm packet consumer, or future automation would be reading a contract it cannot trust.

Preflight a swarm worker lane before delegation:

```bash
node scripts/ops/swarm_lane_preflight.mjs --lane tooling --base origin/main --json --write
make ops-swarm-lane-preflight OPS_SWARM_LANE=docs OPS_SWARM_BASE=origin/main
```

The preflight is read-only. It checks the branch, base ref, integration-base diff, dirty files, changed files, and rename sources against a lane-owned write scope so out-of-lane edits are caught before a worker starts. Use `--base origin/main` for delegation unless you are intentionally validating a stacked branch boundary.

Work packets consume the latest preflight report by default:

```bash
node scripts/studiobrain-ops-work-packet.mjs --json --write --swarm-preflight output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json
```

Missing preflight evidence downgrades the packet report to `warn`; failed preflight evidence makes the report `fail` and marks packets `approval_gated` until the lane scope problem is fixed.

Run the ordered safe wave when refreshing dependent latest artifacts:

```bash
node scripts/ops/ops_wave_runner.mjs --json --write
node scripts/ops/ops_wave_runner.mjs --dry-run --json --write
node scripts/ops/ops_wave_runner.mjs --allow-tool-install --json --write
node scripts/ops/ops_wave_runner.mjs --max-packets 8 --json --write
```

The wave runner executes read-only checks in dependency order: preflight, tooling quality, tooling findings export, tool inventory, tool-install recommendation refresh, admin effectivity audit, work packet generation, packet outcome report generation, preliminary artifact schema validation, PR readiness packet generation, then final artifact schema validation. Use it when a downstream command consumes a `*-latest.json` artifact from an upstream command.
The default run does not install or fetch missing optional validators. Use `--allow-tool-install` only on a tooling lane where ephemeral runners such as `npx` or `uv tool run` are acceptable; the mode still writes only under `output/ops`. Use `--max-packets <n>` when the default three-packet window hides lower-priority ready work behind approval-gated P0/P1 tasks.
If a run fails or the laptop is interrupted, inspect the failed receipt and resume from the failed step with `--from-step <step-id>`. Failed manifests now include `resumeCommand`, for example `node scripts/ops/ops_wave_runner.mjs --json --write --from-step work-packet`.
The Makefile wrapper passes through `OPS_WAVE_FLAGS`, `OPS_WAVE_FROM_STEP`, `OPS_WAVE_MAX_PACKETS`, `OPS_WAVE_STEPS`, and space-separated `OPS_WAVE_SKIP` values, so common resumes can stay in the standard command shape: `make ops-wave-runner OPS_WAVE_FROM_STEP=work-packet OPS_WAVE_MAX_PACKETS=8`.
Wave runner manifests include `registryConsistency`, which checks that every planned output is registered and that full-wave managed registry artifacts are still produced by the plan. Restricted runs from `--steps`, `--skip`, or `--from-step` are marked as intentionally partial.
Dry-run wave artifacts are timestamped only and do not replace `ops-wave-runner-latest.json`; latest is reserved for executable wave evidence.
Tooling findings export converts fresh `tooling-quality` findings into GitHub-copy-ready cleanup tasks, keeping validator output from becoming a one-off terminal observation.
The effectivity audit compares tool inventory sources against the start of the selected slice window, so validators run during the wave are not falsely marked stale just because the slice ledger is appended after validation completes.

Work packets should steer from fresh evidence only. Missing, invalid, stale, or invalid-timestamp latest artifacts stay visible in `freshEvidence`, but they are excluded from packet `sourceSignals`. Tool inventory coverage gaps are kept as `signalClass=coverage_gap` so missing validators remain visible without being treated as actionable defect evidence. Tool-install recommendations are refreshed by the wave runner after installed-tool inventory and before packet generation. They use `signalClass=tool_install_recommendation` only for install-now candidates, and emit a separate `signalClass=approval_gate` when any recommended tool still needs human approval or a remote lane. Work packets also treat stale upstream inventory as stale recommendation evidence.
Work packet reports include `sourceSignalAudit`: every source signal must carry a known `signalClass`, exact duplicate signals are removed from emitted packets, and any duplicate or unclassified signal is surfaced as a warning instead of quietly inflating packet payloads.
Use `node scripts/ops/work_packet_quality_lint.mjs --json --write` to lint the latest work-packet artifact for operational quality: duplicate packet ids, weak branch or PR title suggestions, markdown-wrapped branch names, thin verification, low source-signal counts, unsafe constraints, and potentially service-impacting terms without approval gates.
The latest work-packet artifact also includes `nextExecutablePacket`, a compact pointer to the first ready packet after priority and approval-gate sorting. Use it as the quick assignment view before opening the full packet list.
Artifact validation reads its default catalog from `scripts/ops/artifact_registry.mjs`; add new latest-artifact contracts there first, assign the right freshness tier, producer command, safe write root, consumers, and `requiredFor` tags, then let validators and downstream reports consume the shared registry. Current tiers are `loop` (6 hours), `daily` (24 hours), and `weekly` (168 hours).
Tooling findings export is included in work-packet evidence as `fresh-tooling-findings`; issue-ready validator tasks are tagged `signalClass=issue_ready_task` so agents can pick them up without scraping terminal output.
When the export contains task entries, the work-packet generator also emits them as normal `ops-wp-*` packets with scoped write sets and validator-focused acceptance criteria.
Packets are sorted by priority first, then readiness, so a ready P1 diagnostic/tooling task is visible before an approval-gated P1 cleanup task.
PR readiness packets include the latest wave runner packet window and top work-packet titles so reviewers can tell whether a PR was prepared from the default three-packet view or a widened slice window. When `--packet-id <ops-wp-id>` is supplied, the readiness packet also includes a ready-to-run `--record-outcome` command for the work-packet outcome ledger and warns if that packet id is not in the latest suggested window. When `--slice-ids` is supplied, readiness compares those IDs to the latest slice-ledger window and warns if the PR cites slices outside the recorded evidence window. Work-packet reports summarize that ledger by outcome, useful/stale rates, latest outcome by packet, and stale/misleading or blocked packet IDs. The report status itself warns when mature packet outcomes exceed the stale/misleading threshold or any latest packet outcome is blocked. The admin effectivity audit reads the latest work-packet report and carries that outcome health into the five-slice audit, warning when mature packet outcomes show stale/misleading or blocked work.
PR readiness also consumes `output/ops/swarm/packet-outcome-report-latest.json` by default, so reviewers see compact packet outcome status, maturity, score, orphaned current-packet rate, reset guidance, and up to three packet-outcome warnings without opening a separate artifact.
Use `node scripts/ops/packet_outcome_report.mjs --json --write` for a compact operator-facing view of the outcome ledger, current suggested packet ids, stale/blocked outcome health, and packet outcomes whose ids are no longer in the current work-packet window. If more than half of at least three latest packet outcomes are orphaned from the current window, the report warns and recommends recording fresh outcomes against current packet ids before steering from outcome rates. The same report includes read-only retention pressure for the append-only outcome ledger: file existence, bytes, line count, oldest/newest record, historical entries beyond latest-per-packet outcomes, and non-destructive compaction guidance. It also reads the latest PR readiness packet by default and warns when readiness/work-packet evidence exists but no outcomes have been recorded, so `warming_up` does not become a permanent blind spot. Outcome adoption now includes ready-to-edit `--record-outcome` helper commands for the readiness packet when current, or the first ready packet in the current window when the readiness packet has gone stale.

## Scoring

- `usefulness`: average slice usefulness score, 0 to 1.
- `verification`: passing command checks divided by total recorded command checks.
- `noOpRate`: share of rows with no changed file, artifact, command evidence, or an explicit no-op status.
- `blockedLaneClarity`: blocked slices with a fixed blocker class and safe next step.
- `toolInventoryFreshness`: 1 when the inventory command can run and both the inventory and its upstream tooling-quality source are fresh enough for the selected slice window; 0 when unavailable, stale, invalid, or older than the audited slices.
- `workPacketOutcomeHealth`: 1 when the latest work-packet report is fresh and its outcome ledger is clean or still warming up; 0.4 when mature outcomes show too many stale/misleading packets; 0.6 when blocked packet outcomes need triage.

The audit fails if required tools are missing or a slice failed. It warns when no slices are recorded, no-op rate is high, the underlying ops effectivity report cannot run, or the latest work-packet outcome health is degraded.
Use `node scripts/ops/admin_effectivity_trend.mjs --json --write --limit 10` after checkpoint audits to compare recent five-slice windows. The trend report is read-only and highlights usefulness/no-op movement, tool freshness drift, work-packet outcome health drift, and the latest audit status.

## Blocker Classes

Use fixed classes so blocked work is searchable and does not become vague:

- `approval_required`
- `missing_auth`
- `sudo_unavailable`
- `dirty_worktree`
- `merge_conflict`
- `cross_repo_boundary`
- `missing_tool`
- `live_endpoint_down`
- `test_failure`
- `data_safety_gate`
- `external_service`
- `unclear_owner`

## Tooling Roadmap

The first tool inventory is intentionally read-only. Recommended next tool gates are:

1. Shell LF guard and ShellCheck report for Ubuntu-targeted scripts.
2. PSScriptAnalyzer for Windows PowerShell deployment and watcher helpers.
3. SQLFluff parser-only checks for PostgreSQL inspection packets.
4. actionlint for GitHub Actions.
5. Docker Compose rendered-config validation on Ubuntu or the host.

Each new tool should be audited after roughly five slices: count actionable findings, false positives, and whether it prevented a broken script, failed CI run, unsafe recommendation, or operator confusion.
