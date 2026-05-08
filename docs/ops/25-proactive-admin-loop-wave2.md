# Proactive Admin Loop Wave 2

Generated: 2026-05-08

## Current Evidence Baseline

- Main commit `4f36915e` passed deploy, post-deploy promotion, smoke, Lighthouse, intent, iOS, and Swift gates.
- Dependency scout status is `ok`: open Dependabot alerts `0`, active alerts `0`, stale alerts `0`, high/critical audit count `0`, total audit count `0`.
- Dependency upstream watch status is `ok`: no high/critical upstream watch items remain after the `basic-ftp` lockfile refresh.
- Command surface guard status is `ok`: high findings `0`, medium findings `0`, classified intentionally undocumented Make targets `10`.
- Remaining open authored work is old draft ops stack work; treat it as historical until individually revalidated from current `origin/main`.

## Operating Contract

- Prefer fresh worktrees from `origin/main`.
- Keep changes PR-sized: one tool, one evidence packet, one guard, or one small dependency/security fix.
- Read-only discovery first; mutation only through reviewed repo PRs.
- No host restarts, Docker pruning, package upgrades on the Ubuntu host, firewall/SSH/sudoers changes, DB schema changes, restore-over-production, or secret rotation without explicit approval.
- Audit value after every 5 slices: prove the output changed an operator decision, removed noise, or closed a real risk.

## Next 50 Slices

| # | Slice | Lane | Artifact / Acceptance |
|---:|---|---|---|
| 1 | Dependency zero-baseline guard | Security tooling | Add a read-only check that records the current all-clean dependency baseline and flags regressions without running `npm audit fix`. |
| 2 | Dependency freshness cadence | Security docs | Document daily/weekly dependency scout cadence, stale-alert handling, and lockfile-only refresh workflow. |
| 3 | Dependency issue exporter refresh | Security/backlog | Generate issue-ready tickets only when dependency scout is non-OK; no tickets for clean state. |
| 4 | Upstream-watch historical snapshots | Security tooling | Store timestamped ignored upstream-watch summaries so future vulnerable-chain movement is visible. |
| 5 | Dependency wave closeout audit | SRE | Verify dependency scout, upstream-watch, command guard, and main CI remain green; record shipped PRs and residual risk. |
| 6 | Draft PR stack triage packet | PR ops | Classify old draft PRs as keep, supersede, rebase, or close-candidate without mutating branches. |
| 7 | Draft PR dependency map | PR ops | Map draft PR write sets and conflicts so stacked work can be resumed safely. |
| 8 | Draft PR freshness guard | PR ops | Report stale drafts older than 24h/72h/7d with suggested next action. |
| 9 | Draft PR cleanup checklist | Docs/backlog | Create issue-ready cleanup cards for superseded draft stacks. |
| 10 | PR stack wave audit | SRE | Verify no ready non-draft PR is blocked by stale draft work. |
| 11 | Ops output retention scanner | Ops tooling | Report ignored `output/ops/*` artifact growth, latest file age, and suggested retention. |
| 12 | Ops artifact producer map | Ops tooling | Map each `make ops-*` command to produced files and expected freshness windows. |
| 13 | Artifact freshness to backlog bridge | Automation | Generate issue-ready refresh tasks only for stale critical evidence. |
| 14 | Ops command help index | Usability | Generate a compact command index with purpose, risk, output path, and required privileges. |
| 15 | Ops command usability audit | SRE | Run command guard plus help index and verify no operator command is mysterious or stale. |
| 16 | Host privileged evidence gap audit | Ubuntu | Re-evaluate `sudo_unavailable` lanes and identify which facts still require privileged capture. |
| 17 | Privileged capture sample validator | Ubuntu tooling | Validate captured privileged artifact shape without requiring root on agent machines. |
| 18 | Failed unit evidence refresh | Ubuntu | Refresh failed-unit trend packet and classify one-shot versus persistent failure. |
| 19 | Package posture evidence refresh | Ubuntu | Refresh pending update/reboot/unattended-upgrades evidence without applying packages. |
| 20 | Ubuntu wave audit | SRE | Verify Ubuntu evidence gaps are explicit and approval-gated. |
| 21 | Docker image tag drift refresh | Docker | Re-run tag policy and classify remaining floating tags by risk and update cadence. |
| 22 | Docker compose drift packet | Docker | Compare tracked Compose with live config where available; degrade cleanly if Docker unavailable. |
| 23 | Docker cleanup queue refresh | Docker | Produce approval-only cleanup candidates with no prune/remove commands. |
| 24 | Docker log growth evidence | Docker | Add/read log-size evidence slots and thresholds where accessible. |
| 25 | Docker wave audit | SRE | Verify Docker recommendations remain evidence-backed and non-destructive. |
| 26 | PostgreSQL size trend refresh | DBA | Run/read DB/table/index size snapshot where credentials are available; otherwise emit exact missing evidence. |
| 27 | PostgreSQL lock/connection refresh | DBA | Run/read long transaction, lock, and connection count packet. |
| 28 | PostgreSQL autovacuum recency refresh | DBA | Refresh stale stats and autovacuum posture report. |
| 29 | PostgreSQL backup restore confidence | DBA/backup | Tie backup artifacts, age, metadata, and restore drill prerequisites into one status. |
| 30 | DBA wave audit | SRE | Verify DBA packets distinguish measured facts from unknowns. |
| 31 | Incident bundle dependency section | SRE tooling | Ensure incident bundle includes dependency scout/upstream-watch summaries. |
| 32 | Incident bundle redaction spot-check | Security | Verify incident bundle does not print tokens, `.env` values, or private keys. |
| 33 | Incident bundle freshness metadata | SRE | Add timestamps and source command names for each bundle section. |
| 34 | Post-deploy audit packet | SRE | Standardize post-merge proof: PR, commit, CI gates, deploy gate, focused tool outputs. |
| 35 | SRE wave audit | SRE | Verify incident and deploy packets reduce manual reverse-engineering. |
| 36 | Mission Control ops artifact import plan | Mission Control | Plan import/display shape for clean dependency and ops evidence without schema changes. |
| 37 | Mission Control stale-alert card | Mission Control | Show stale external alerts as verification cards, not active failures. |
| 38 | Mission Control approval-only task labels | Mission Control | Ensure destructive/privileged actions are visibly approval-gated. |
| 39 | Mission Control top-risk signal hygiene | Mission Control | Prevent stale/clean evidence from dominating current top risks. |
| 40 | Mission Control wave audit | SRE/UI | Verify admin surfaces reduce noise and do not encourage unsafe actions. |
| 41 | Work-packet quality refresh | Automation | Revalidate old work-packet draft PRs against current main and classify salvage value. |
| 42 | Next executable work selector | Automation | Pick the next safe slice from clean evidence, not stale draft order. |
| 43 | Outcome ledger cleanup | Automation | Record shipped, superseded, blocked, and no-op work outcomes from the dependency wave. |
| 44 | Loop effectiveness metric | Automation | Track useful work versus false starts, including the rejected `firebase-tools` bump. |
| 45 | Automation wave audit | SRE | Verify automation helps choose work rather than creating ritual paperwork. |
| 46 | Security posture owner handoff | Docs | Summarize dependency zero state, remaining GitHub alerts, and next security watch items. |
| 47 | Ops roadmap refresh | Docs | Update 30/60/90 roadmap with shipped dependency and command-surface outcomes. |
| 48 | Backlog refresh | Docs/backlog | Remove closed dependency tasks and add only current evidence-backed tasks. |
| 49 | Full-loop evidence bundle | SRE | Collect reports for dependency, command surface, PR stack, host gaps, and CI state. |
| 50 | Wave 2 closeout | Lead | Merge ready PRs, verify main, audit value, save handoff, and seed the next 50-slice plan. |

## Immediate Next Slice

Start with slice 1, dependency zero-baseline guard, because the dependency lane is currently clean and that clean state is worth preserving before the loop pivots back into host/Docker/PostgreSQL evidence.

## Audit Questions

- Did this slice reduce operational risk or merely create another report?
- Can a human owner act on the output without reading code?
- Does the output separate active risk from stale, blocked, approval-gated, or unknown evidence?
- Is rollback just reverting a PR?
- Did the slice avoid destructive or service-impacting actions?
