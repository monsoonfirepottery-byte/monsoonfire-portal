# Proactive Admin Loop Wave 3

Generated: 2026-05-08

## Current Evidence Baseline

- Main commit `bd14e992` includes the latest command classification, radar, selector, and selector-status documentation slices.
- `npm run ops:next-slice:selector` currently reports `blocked_on_approval` with `actionableTaskCount: 0`.
- Current approval gates are explicit and non-critical for this run:
  - PR #492 conflict packet, approval-gated.
  - Stacked draft PR backlog, approval-gated owner decision packets.
- Command manifest status is `ok`: 63 Make targets, 32 npm ops scripts, 8 npm-only commands, 0 high findings.
- Npm-only command safety is now machine-classified, and proactive radar can flag future `unclassified_npm_only` regressions.

## Operating Contract

- Start each implementation branch from `origin/main`.
- Prefer one small PR per 1-3 related slices.
- Use ignored `output/ops/...` artifacts for transient evidence; promote only durable docs, scripts, tests, or policy files into Git.
- Keep approval-gated work visible but do not execute destructive cleanup, host restarts, package upgrades, firewall/SSH/sudoers changes, DB schema changes, restore-over-production, or secret rotation.
- Audit value after roughly every 5 slices: keep work that changes an operator decision, removes false readiness, catches drift, or makes rollback safer.

## Next 50 Slices

| # | Slice | Lane | Artifact / Acceptance |
|---:|---|---|---|
| 1 | Wave 3 seed artifact | Docs | This 50-slice plan exists with current evidence, safety gates, and acceptance notes. |
| 2 | Selector status fixture harness | Automation | Add committed fixture tests for `action_ready`, `blocked_on_approval`, `manual_review`, `ok`, and `blocked`. |
| 3 | Selector status regression docs | Docs | README links status names to operator behavior and fixture coverage. |
| 4 | Radar npm-only regression fixture | Automation | Test that synthetic `unclassified_npm_only` commands produce a low-risk radar finding. |
| 5 | Wave 3 first audit | SRE | Record whether slices 1-4 reduced loop ambiguity or only added paperwork. |
| 6 | Command manifest compact mode | Usability | Add a concise JSON/Markdown mode summarizing counts and findings without full command dumps. |
| 7 | Command manifest docs gap tasking | Automation | Generate issue-ready tasks only for high-value undocumented commands. |
| 8 | Command safety vocabulary file | Ops tooling | Centralize approval classes/operator classes in a small documented policy artifact. |
| 9 | Command safety drift check | CI/ops | Fail/warn when a new approval class appears without policy documentation. |
| 10 | Command surface wave audit | SRE | Verify command tooling catches real ambiguity and has low false-positive risk. |
| 11 | Producer policy schema guard | Automation | Validate `docs/ops/output-artifact-producers.json` shape and required fields. |
| 12 | Producer policy stale-threshold review | Docs | Explain why each freshness window is 1/7/30 days and what stale means. |
| 13 | Producer refresh dry-run summary | Automation | Emit a compact plan of stale producers, skipped approval lanes, and safe commands. |
| 14 | Producer refresh value scoring | Automation | Prefer producers by operational value, safety, and staleness rather than raw age only. |
| 15 | Producer wave audit | SRE | Confirm refresh tooling avoids loops and does not hammer just-refreshed evidence. |
| 16 | Effectivity ledger PR backfill | Automation | Record recently merged ops PRs #720-#723 into the slice ledger with evidence. |
| 17 | Effectivity audit false-positive review | SRE | Ensure docs-only slices are useful when they prevent operator confusion. |
| 18 | Handoff packet generator | Automation | Generate latest commits, merged PRs, selector state, gates, and next 10 slices. |
| 19 | Loop closeout markdown template | Docs | Standardize wave closeout sections for value, risks, rollback, and next actions. |
| 20 | Effectivity wave audit | SRE | Verify ledger and audit outputs are actionable, not ritual status text. |
| 21 | Ubuntu privileged gap matrix v2 | Ubuntu | Map each remaining `sudo_unavailable` fact to exact safe capture command and approval owner. |
| 22 | Host evidence importer stub | Ubuntu | Consume privileged evidence when present and otherwise emit `sudo_unavailable`, not failure. |
| 23 | Failed unit trend fixture | Ubuntu | Add sample classifier evidence for completed one-shots versus persistent failed units. |
| 24 | Package posture stale evidence task | Ubuntu | Produce issue-ready task only when update/reboot evidence is stale or missing. |
| 25 | Ubuntu wave audit | SRE | Confirm host posture work stays read-only and identifies exact privileged gaps. |
| 26 | Docker evidence unavailable semantics | Docker | Distinguish Docker unavailable, permission denied, and no containers from true OK. |
| 27 | Docker cleanup candidate schema | Docker | Normalize safe/backup-first/service-window/approval-only/do-not-touch classes. |
| 28 | Docker tag policy regression check | Docker | Flag new floating tags without cadence/rollback notes. |
| 29 | Docker output retention linkage | Docker | Ensure Docker evidence producers have retention/freshness policies. |
| 30 | Docker wave audit | SRE | Verify Docker outputs never suggest prune/remove without approval. |
| 31 | PostgreSQL unavailable semantics | DBA | Distinguish credentials missing, Docker missing, psql missing, and read-only query failure. |
| 32 | DBA query packet schema guard | DBA | Validate generated PostgreSQL packets include measured facts, unknowns, and rollback notes. |
| 33 | pg_stat_statements visibility task | DBA | Generate issue-ready task only when extension/query visibility is unavailable. |
| 34 | Backup confidence threshold policy | Backup | Document age/status thresholds for Postgres, Redis, MinIO, and restore drill evidence. |
| 35 | DBA/backup wave audit | SRE | Verify DBA outputs separate measured risk from missing evidence. |
| 36 | Incident bundle source manifest | SRE | Include command names, timestamps, and redaction status for every bundle section. |
| 37 | Incident bundle redaction fixture | Security | Add a synthetic secret fixture and prove the bundle/redaction audit does not leak it. |
| 38 | Post-merge verification packet v2 | SRE | Generate PR, commit, checks, selector, and rollback notes after each merge. |
| 39 | CI duration trend slot | CI | Capture smoke/build/lighthouse durations to spot gate slowdown without treating it as failure. |
| 40 | SRE wave audit | SRE | Confirm incident/CI tooling reduces manual log spelunking. |
| 41 | Mission Control evidence import contract | Mission Control | Define read-only import shape for selector/radar/effectivity artifacts without schema changes. |
| 42 | Mission Control approval gate wording | Mission Control | Ensure approval-gated tasks read as waiting on owner, not system failure. |
| 43 | Mission Control artifact freshness display | Mission Control | Show latest artifact age/status without exposing raw secrets or huge JSON. |
| 44 | Mission Control loop health tile | Mission Control | Display `action_ready`, `blocked_on_approval`, `manual_review`, and `ok` semantics clearly. |
| 45 | Mission Control wave audit | SRE/UI | Verify admin UI encourages safe next actions and not automation overreach. |
| 46 | Backlog exporter gate hygiene | Docs/backlog | Export only current evidence-backed tasks and suppress superseded/no-op tasks. |
| 47 | Risk register freshness pass | Docs | Add evidence age and source command names to top risks. |
| 48 | 30/60/90 roadmap wave 3 refresh | Docs | Reflect shipped loop infrastructure and remaining approval gates. |
| 49 | Wave 3 evidence bundle | SRE | Collect radar, selector, manifest, producer, effectivity, and CI evidence into one packet. |
| 50 | Wave 3 closeout and wave 4 seed | Lead | Merge safe PRs, audit actual value, document blockers, and create the next 50-slice plan. |

## Immediate Next Slice

Start with slice 2, selector status fixture harness. The selector now has meaningful statuses, and committed fixtures will keep future loop changes from accidentally turning review-only or approval-gated work back into false `action_ready` signals.

## Value Audit Questions

- Did the slice reduce operator uncertainty or prevent a false automation loop?
- Did it produce a durable artifact, test, policy, or reviewable PR?
- Does the output distinguish active risk from approval-gated, stale, unknown, or unavailable evidence?
- Is rollback just reverting the PR?
- Did it avoid destructive or live service-impacting action?
