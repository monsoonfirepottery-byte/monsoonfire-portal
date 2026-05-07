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

Missing or invalid fresh artifacts degrade to warnings and docs-only packet generation. The generator should not run the audit itself; run `make ops-admin-effectivity-audit` first when fresh steering is needed.

Validate generated ops artifacts against their committed schemas:

```bash
node scripts/ops/validate_ops_artifacts.mjs --json --write
```

Missing ignored artifacts are warnings. Schema mismatches are failures because they mean a dashboard, swarm packet consumer, or future automation would be reading a contract it cannot trust.

## Scoring

- `usefulness`: average slice usefulness score, 0 to 1.
- `verification`: passing command checks divided by total recorded command checks.
- `noOpRate`: share of rows with no changed file, artifact, command evidence, or an explicit no-op status.
- `blockedLaneClarity`: blocked slices with a fixed blocker class and safe next step.
- `toolInventoryFreshness`: 1 when the inventory command can run; 0 when unavailable.

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
