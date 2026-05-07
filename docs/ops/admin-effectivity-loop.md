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
```

The wave runner executes read-only checks in dependency order: preflight, tooling quality, tooling findings export, tool inventory, admin effectivity audit, work packet generation, preliminary artifact schema validation, PR readiness packet generation, then final artifact schema validation. Use it when a downstream command consumes a `*-latest.json` artifact from an upstream command.
The default run does not install or fetch missing optional validators. Use `--allow-tool-install` only on a tooling lane where ephemeral runners such as `npx` or `uv tool run` are acceptable; the mode still writes only under `output/ops`.
Tooling findings export converts fresh `tooling-quality` findings into GitHub-copy-ready cleanup tasks, keeping validator output from becoming a one-off terminal observation.
The effectivity audit compares tool inventory sources against the start of the selected slice window, so validators run during the wave are not falsely marked stale just because the slice ledger is appended after validation completes.

Work packets should steer from fresh evidence only. Missing, invalid, stale, or invalid-timestamp latest artifacts stay visible in `freshEvidence`, but they are excluded from packet `sourceSignals`. Tool inventory coverage gaps are kept as `signalClass=coverage_gap` so missing validators remain visible without being treated as actionable defect evidence. Tool-install recommendations are tracked as a separate fresh source and use `signalClass=tool_install_recommendation` only when the recommendation artifact has install-now candidates; approval-required tools remain evidence for planning, not automatic installation.
Tooling findings export is included in work-packet evidence as `fresh-tooling-findings`; issue-ready validator tasks are tagged `signalClass=issue_ready_task` so agents can pick them up without scraping terminal output.
When the export contains task entries, the work-packet generator also emits them as normal `ops-wp-*` packets with scoped write sets and validator-focused acceptance criteria.

## Scoring

- `usefulness`: average slice usefulness score, 0 to 1.
- `verification`: passing command checks divided by total recorded command checks.
- `noOpRate`: share of rows with no changed file, artifact, command evidence, or an explicit no-op status.
- `blockedLaneClarity`: blocked slices with a fixed blocker class and safe next step.
- `toolInventoryFreshness`: 1 when the inventory command can run and both the inventory and its upstream tooling-quality source are fresh enough for the selected slice window; 0 when unavailable, stale, invalid, or older than the audited slices.

The audit fails if required tools are missing or a slice failed. It warns when no slices are recorded, no-op rate is high, or the underlying ops effectivity report cannot run.

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
