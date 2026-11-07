# Proactive Admin Loop Wave 4

Generated: 2026-05-13

## Current Evidence Baseline

- Current implementation lane: `codex/ops-selector-status-fixtures` in `D:\monsoonfire-portal-producer-refresh-runner`.
- Selector fixture work is now verified locally with coverage for `action_ready`, `blocked_on_approval`, `manual_review`, `ok`, and `blocked`.
- `npm run ops:dependency:cadence` reports `action_needed`: 30 active dependency alerts, 11 high/critical npm audit findings, 3 upstream lockfile-refresh candidates, and 7 zero-baseline findings.
- `npm run ops:pr-backlog:packets` refreshed current PR-stack owner packets: 96 open PRs, 76 drafts, 70 stacked drafts under root #600, 5 stale draft close candidates, and 1 dirty non-draft handoff.
- `npm run ops:output:retention` reports `ok`: 341 files, 5.08 MB under `output/ops`, 0 stale files, and 18 producer policies.
- `npm run ops:command-manifest` reports `ok`: 63 Make targets, 32 npm ops scripts, 18 producer policies, and 0 high findings.
- Latest selector state is `blocked_on_approval`: stale producer count is 0, actionable task count is 0, and the remaining current work is owner review of approval-gated PR packets.

## Operating Contract

- Keep host, database, Docker, firewall, SSH, package, schema, secret, and service-impacting changes behind explicit approval.
- Prefer one branch and PR for each 1-3 related slices.
- Treat ignored `output/ops/...` artifacts as evidence cache, not durable source. Promote only scripts, tests, policies, docs, fixtures, or curated packets.
- When PR-stack work is approval-gated, keep the loop moving with read-only producer, manifest, retention, dependency, CI, or docs improvements.
- Every five slices, audit actual value: did the work change an operator decision, reduce false readiness, improve rollback, or expose a real blocker?

## Next 50 Slices

| # | Slice | Lane | Artifact / Acceptance |
|---:|---|---|---|
| 1 | Wave 4 seed artifact | Docs | This 50-slice plan exists with current evidence, gates, rollback notes, and next implementation lanes. |
| 2 | Selector fixture PR closeout | Automation | Land the verified selector fixture harness with tests and CLI main guard. |
| 3 | Selector README drift check | Docs/test | Add or verify a guard that README status semantics match selector fixture vocabulary. |
| 4 | Selector packet path hermeticity | Automation | Keep tests from overwriting real ignored evidence artifacts. |
| 5 | Wave 4 first audit | SRE | Record whether slices 1-4 improved loop safety or only added paperwork. |
| 6 | Dependency remediation packet refresh | Dependency | Refresh issue-ready remediation evidence without install/update/audit-fix. |
| 7 | Dependency zero-baseline triage packet | Dependency | Group the 7 regressions by owner package, update path, and rollback notes. |
| 8 | Dependency alert aging summary | Security | Separate active, stale, unavailable, and duplicate dependency alerts. |
| 9 | Lockfile refresh candidate plan | Dependency | Turn the 3 lockfile-refresh candidates into a reviewable no-install plan. |
| 10 | Dependency wave audit | SRE | Verify dependency evidence supports decisions without mutating packages. |
| 11 | PR conflict packet refresh | GitHub ops | Refresh #492 dirty non-draft packet against current PR-stack evidence. |
| 12 | Stacked PR root decision packet | GitHub ops | Make root #600 keep/rebuild/supersede/close choices easy to review. |
| 13 | Stale draft disposition sheet | GitHub ops | Summarize #512, #525, #527, #530, and #550 with evidence and replacement links. |
| 14 | PR packet approval wording pass | Docs | Ensure packets read as owner decisions, not executable automation. |
| 15 | PR-stack wave audit | SRE | Confirm packet refreshes reduce release planning ambiguity and avoid PR mutation. |
| 16 | Command manifest compact output | Ops tooling | Add concise summary mode for counts, high findings, approval gates, and npm-only commands. |
| 17 | Command manifest README sync | Docs | Document compact mode and when operators should prefer it over full JSON. |
| 18 | Command policy schema test | Automation | Validate approval/operator classes against a single vocabulary. |
| 19 | Npm-only command task filter | Automation | Emit tasks only for commands that matter operationally. |
| 20 | Command tooling wave audit | SRE | Check false positives and whether command output is easier to scan. |
| 21 | Producer policy schema guard | Automation | Validate required producer fields: path, command, freshness, retention, cleanup approval. |
| 22 | Producer refresh dry-run summary | Automation | Show stale/skipped/approval-gated producers without executing commands. |
| 23 | Producer fallback scoring tune | Automation | Prefer high-leverage safe fallback evidence over repetitive freshness churn. |
| 24 | Producer artifact source manifest | Observability | Record source command and generated time for each producer in one packet. |
| 25 | Producer wave audit | SRE | Verify stale producer count stays meaningful and not noisy. |
| 26 | Output retention threshold rationale | Docs | Explain 250 MB / 1000 MB and stale-day thresholds with rollback notes. |
| 27 | Output retention cleanup packet | Ops tooling | Generate approval-required cleanup candidates without deleting anything. |
| 28 | Artifact retention class docs | Docs | Define latest-plus-history, decision-packet, trend, self-audit, and incident retention. |
| 29 | Evidence cache size trend | Observability | Compare current 5.08 MB baseline against future snapshots. |
| 30 | Retention wave audit | SRE | Confirm retention work prevents sprawl without encouraging unsafe cleanup. |
| 31 | PostgreSQL snapshot availability pass | DBA | Refresh or classify postgres evidence as measured, missing credentials, Docker unavailable, or query failure. |
| 32 | PostgreSQL packet schema guard | DBA/test | Ensure DBA packets include measured facts, unknowns, safe next steps, and rollback notes. |
| 33 | Backup confidence packet refresh | Backup | Refresh backup/restore prerequisite evidence without restore-over-production. |
| 34 | Restore drill approval matrix | Backup | Split read-only prerequisites from approval-gated restore drills. |
| 35 | DBA/backup wave audit | SRE | Verify evidence separates real risk from unavailable inputs. |
| 36 | Docker posture unavailable semantics | Docker | Distinguish Docker missing, permission denied, no containers, and true OK. |
| 37 | Docker tag policy current refresh | Docker | Refresh floating tag evidence and generate reviewable follow-ups only. |
| 38 | Docker cleanup candidate classes | Docker | Normalize do-not-touch, backup-first, service-window, and approval-only classes. |
| 39 | Docker evidence retention links | Docker | Ensure Docker producers have freshness and cleanup policy coverage. |
| 40 | Docker wave audit | SRE | Prove Docker outputs never suggest prune/remove without approval. |
| 41 | Incident bundle source manifest v2 | SRE | Include command names, timestamps, and redaction status for each bundle section. |
| 42 | CI validate fresh run | CI | Refresh `ci-validate` evidence and classify failures as code, tool, or environment. |
| 43 | CI duration trend packet | CI | Track ops validation duration without treating slowness as failure. |
| 44 | Redaction fixture expansion | Security | Add synthetic secret cases for incident and command evidence paths. |
| 45 | SRE/CI wave audit | SRE | Confirm validation reduces log spelunking and catches real regressions. |
| 46 | Mission Control selector import contract | Mission Control | Define UI-safe fields for selector/radar/effectivity artifacts. |
| 47 | Mission Control approval-gate copy | Mission Control | Ensure `blocked_on_approval` reads as waiting on owner, not system failure. |
| 48 | Mission Control evidence freshness tile | Mission Control | Specify age/status display without raw JSON overload or secrets. |
| 49 | Wave 4 evidence bundle | SRE | Collect selector, radar, command, retention, dependency, and PR packet evidence. |
| 50 | Wave 4 closeout and wave 5 seed | Lead | Audit actual value, list blockers, preserve rollback notes, and create the next 50-slice plan. |

## Immediate Next Slice

Close out slice 2 by committing the selector fixture harness and opening a reviewable PR. Then review the current approval-gated PR packets before any PR close, branch delete, force-push, restack, or rebuild work.

## Risks And Rollback

- Dependency findings are action-needed but not authorization to update packages; rollback for future remediation remains reverting the focused dependency PR.
- PR-stack packets are approval-gated; rollback for a bad owner decision is reopening/restoring a preserved PR branch, not automated cleanup.
- Ignored evidence refreshes can be discarded by removing regenerated `output/ops/...` artifacts.
- Docs/test changes in this wave roll back by reverting the PR.

## Value Audit Questions

- Did the slice make the next operator decision clearer?
- Did it distinguish active risk from stale, approval-gated, unavailable, or unknown evidence?
- Did it preserve a reviewable rollback path?
- Did it avoid destructive, live, or secret-bearing operations?
- Did it reduce future loop work rather than merely refresh a timestamp?
