# Proactive Administrator Loop Wave 1

This wave turns the Studio Brain administrator from a set of useful checks into an iterative operating loop: plan, implement, audit, verify value, recommend, and repeat. The focus is proactive issue discovery and tooling that helps future agents notice drift before it becomes an incident.

## Operating Rules

- Use clean worktrees from `origin/main` for implementation.
- Keep primary discovery read-only.
- Prefer scripts, reports, runbooks, and issue-ready tickets over live host mutation.
- Do not run destructive cleanup, service restarts, package upgrades, firewall or SSH changes, schema changes, secret rotation, or live Docker recreates without explicit approval.
- Every wave should leave behind an artifact under `docs/ops/` or `output/ops/` that a later operator can verify.
- After every 5 slices, run an effectiveness audit and decide whether the work is producing real leverage.

## 50-Slice Plan

| # | Slice | Lane | Deliverable / Acceptance |
| ---: | --- | --- | --- |
| 1 | Proactive radar command | Tooling | Read-only command summarizes PR risk, stale evidence, dirty worktrees, hidden scripts, and next recommendations. |
| 2 | Wave 1 plan artifact | Docs | This 50-slice plan exists under `docs/ops/` with safety gates and acceptance notes. |
| 3 | Radar Makefile wrapper | Tooling | `make ops-proactive-radar` runs the radar and writes ignored artifacts. |
| 4 | Radar README entry | Docs | `docs/ops/README.md` lists the new command and sharing rules. |
| 5 | Wave audit 1 | SRE | Run syntax checks and radar; verify output is actionable rather than noise. |
| 6 | PR stack merge-order packet | GitHub ops | Report draft stack bases, merge order, stale branches, and blockers without closing PRs. |
| 7 | Dirty PR conflict packet | GitHub ops | For PR #492 and future dirty PRs, generate issue-ready conflict-resolution notes. |
| 8 | Draft stack stale-age policy | GitHub ops | Define stale draft thresholds and owner actions. |
| 9 | Draft stack dashboard artifact | Tooling | Store latest PR stack summary under `output/ops/pr-stack/`. |
| 10 | Wave audit 2 | SRE | Confirm PR tooling reduces ambiguity and does not overstate mergeability. |
| 11 | Evidence freshness thresholds | Ops docs | Formalize warning/critical age thresholds for inventory, risk, capacity, DBA, Docker, backup docs. |
| 12 | Evidence freshness checker | Tooling | Script exits warn when critical docs are stale or missing. |
| 13 | Evidence freshness admin import | Mission Control bridge | Produce JSON shape suitable for admin task import. |
| 14 | Stale evidence backlog export | Docs/backlog | Issue-ready entries for refreshing stale artifacts. |
| 15 | Wave audit 3 | SRE | Verify stale-evidence findings cite file mtimes and safe refresh commands. |
| 16 | Host privileged-evidence status contract | Ubuntu | Normalize `sudo_unavailable` and privileged capture availability into machine-readable status. |
| 17 | AIDE/livepatch capture checklist refresh | Ubuntu | Approval-gated exact commands and expected artifacts. |
| 18 | Reboot/update evidence bridge | Ubuntu | Read current non-privileged update/reboot evidence where available; privileged slots remain gated. |
| 19 | Open-port evidence bridge | Security | Normalize available listener/firewall evidence and missing privileged captures. |
| 20 | Wave audit 4 | SRE | Ensure security posture reports do not imply unaudited host safety. |
| 21 | Docker live-apply readiness packet | Docker | Document exact service-window steps for applying merged healthchecks. |
| 22 | Docker compose drift radar | Docker | Compare tracked compose files with generated config where Docker is available; degrade gracefully. |
| 23 | Docker log growth radar | Docker | Summarize available json-log sizing and missing privileged reads. |
| 24 | Docker cleanup approval queue refresh | Docker/docs | Rebuild cleanup candidates grouped by approval level. |
| 25 | Wave audit 5 | SRE | Verify Docker reports never prune, stop, or recreate containers. |
| 26 | Postgres visibility matrix | DBA | Matrix of available vs missing DBA evidence: sizes, locks, pg_stat_statements, backups. |
| 27 | Postgres slow-query task export | DBA | Convert top query families into issue-ready performance tasks when data exists. |
| 28 | Postgres restore-confidence radar | DBA/backup | Report backup artifact age plus restore-drill evidence age. |
| 29 | Postgres bloat uncertainty notes | DBA | Document what current dead-tuple/bloat probes can and cannot prove. |
| 30 | Wave audit 6 | SRE | Verify DBA output is read-only and marks missing data as unknown. |
| 31 | Backup component confidence model | Backup | Score Postgres, Redis, MinIO, config, restore drill independently. |
| 32 | Backup failure task export | Backup/docs | Generate issue-ready tasks for stale/missing backup evidence. |
| 33 | Backup encryption/retention evidence slots | Backup/security | Separate known facts from approval-gated evidence needs. |
| 34 | Restore drill operator checklist v2 | Backup | Human-safe disposable-target checklist with hard stop before production restore. |
| 35 | Wave audit 7 | SRE | Confirm backup confidence cannot pass solely from backup file presence. |
| 36 | Dependency risk radar | App ops | Summarize npm audit inventory, outdated packages, pinned risky packages, and fix boundaries. |
| 37 | Secret reference drift radar | Security | List secret names and config references only; no values. |
| 38 | Env example coverage checker | App ops | Compare documented env names with references, without printing values. |
| 39 | Runtime endpoint exposure matrix | Security/perf | Map public/local/LAN/admin endpoints and risk notes from tracked config. |
| 40 | Wave audit 8 | SRE | Verify app/security reports avoid secret leakage and false certainty. |
| 41 | Incident bundle coverage matrix | SRE | Show which lanes incident bundle v2 covers and which are missing. |
| 42 | Incident bundle redaction test | SRE/security | Add automated check for token/env/private-key leakage in generated bundles. |
| 43 | Post-deploy verifier coverage matrix | SRE | Clarify which live paths are verified after deploy and which are advisory. |
| 44 | Value audit scorecard | SRE | Score each slice as useful, no-op, blocked, or needs follow-up. |
| 45 | Wave audit 9 | SRE | Stop or redirect any lane that is producing noisy artifacts. |
| 46 | Admin issue import packet | Mission Control bridge | Produce import-ready JSON for top risks, stale evidence, backups, and approval gates. |
| 47 | Approval queue copy refresh | UX/docs | Make cleanup/security/package approval cards owner-friendly with rollback notes. |
| 48 | 30/60/90 roadmap refresh | Docs | Reorder roadmap based on actual findings from this wave. |
| 49 | Loop handoff generator | Automation | One command emits latest artifacts, blockers, next 10 slices, and recommended swarm roles. |
| 50 | Wave closeout and next loop seed | Lead | Audit value, publish/PR safe changes, save handoff, and create the next 50-slice seed. |

## First Implementation Artifacts

- `scripts/ops/proactive_issue_radar.mjs`
- `make ops-proactive-radar`
- `output/ops/proactive-radar/latest.json`
- `output/ops/proactive-radar/latest.md`

## Value Test

This wave is valuable only if it reduces operator uncertainty. A slice should be kept when it:

- finds a real stale, dirty, missing, blocked, or risky state;
- names evidence and safe next step;
- avoids printing secrets;
- avoids service-impacting mutation;
- helps the next agent choose work without re-reading the whole ops folder.

If a slice only creates decorative status text, mark it as no-op and redirect.
