# 30-day GA optimization roadmap (priority execution plan)

Status: Blocked
Priority: P1
Severity: Sev2
Component: website
Impact: high
Tags: website, roadmap, analytics, conversion

## Goal
Within 30 days, stabilize measurement, identify top drop-offs, and ship 3 high-confidence conversion experiments with full reporting.

## Sprint 1 (Days 1-7): Measurement stabilizer
- Deliver:
  - `P1-website-ga-data-package-template-and-access.md`
  - `P1-website-ga-event-and-goal-instrumentation-completeness.md`
  - `P1-website-ga-campaign-and-source-quality.md`
- DoD:
  - Canonical event/goal mapping approved
  - Campaign tags standardized for active outbound traffic
  - Baseline report in shared location

Sprint 1 update (2026-02-25):
- Foundation templates and execution runbook are now in-repo:
  - `docs/runbooks/WEBSITE_GA_SPRINT1_FOUNDATIONS.md`
  - `docs/analytics/WEBSITE_GA_DATA_PACKAGE_TEMPLATE.md`
  - `docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP_TEMPLATE.md`
  - `docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md`
- Deterministic foundation check + artifact path added:
  - `npm run website:ga:sprint1:check`
  - `artifacts/website-ga-sprint1-foundations.json`
- Remaining blocker for Sprint 1 completion:
  - real GA property export access + baseline report handoff from owner environment.

Sprint 1 progress update (2026-02-28):
- Added baseline acquisition quality report builder:
  - `scripts/build-website-ga-baseline-report.mjs`
  - `npm run website:ga:baseline:report`
- Added report outputs for deterministic handoff once exports are available:
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.json`
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.md`

Sprint 1 completion update (2026-02-28):
- Sprint 1 measurement stabilizer deliverables are now completed:
  - `P1-website-ga-data-package-template-and-access.md` -> `Completed`
  - `P1-website-ga-event-and-goal-instrumentation-completeness.md` -> `Completed`
  - `P1-website-ga-campaign-and-source-quality.md` -> `Completed`
- New deterministic Sprint 1 evidence commands:
  - `npm run website:ga:event-goal:check`
  - `npm run website:ga:campaign:audit -- --strict`
  - `npm run website:ga:data-package:check -- --strict`
  - `npm run website:ga:sprint1:check`
- Latest evidence artifacts:
  - `artifacts/ga/reports/website-ga-event-goal-check-latest.json`
  - `artifacts/ga/reports/website-ga-campaign-link-audit-latest.json`
  - `artifacts/ga/reports/website-ga-data-package-check-latest.json`
  - `artifacts/website-ga-sprint1-foundations.json`

Sprint 2 completion update (2026-02-28):
- Funnel drop-off audit and intervention plan now automated:
  - `scripts/build-website-ga-funnel-friction-report.mjs`
  - `artifacts/ga/reports/website-ga-funnel-friction-latest.json`
- Ranked experiment queue now automated:
  - `scripts/build-website-ga-experiment-backlog.mjs`
  - `artifacts/ga/reports/website-ga-experiment-backlog-latest.json`

Sprint 3 completion update (2026-02-28):
- Content and engagement opportunity queue now automated:
  - `scripts/build-website-ga-content-opportunities.mjs`
  - `artifacts/ga/reports/website-ga-content-opportunities-latest.json`

Sprint 4 completion update (2026-02-28):
- Weekly dashboard, threshold alerts, and handover template now automated:
  - `scripts/build-website-ga-weekly-dashboard.mjs`
  - `docs/analytics/WEBSITE_GA_WEEKLY_REPORT_TEMPLATE.md`
  - `docs/analytics/WEBSITE_GA_ALERT_THRESHOLDS.md`
  - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.json`

## Sprint 2 (Days 8-14): Funnel recovery
- Deliver:
  - `P2-website-ga-funnel-friction-and-conversion-drops.md`
  - `P2-website-ga-experiment-backlog-and-prioritization.md`
  - Execute top 1–2 funnel experiments
- DoD:
  - Top drop-off steps named with intervention owners
  - Interim impact tracking started
  - One hypothesis closed with direction decision

## Sprint 3 (Days 15-21): Content and trust polish
- Deliver:
  - `P2-website-ga-content-and-engagement-polish.md`
  - Additional experiment cycles for top 2 ranked opportunities
- DoD:
  - At least 4 pages updated with measurable objective
  - Mobile and desktop deltas documented

## Sprint 4 (Days 22-30): Operating rhythm lock
- Deliver:
  - `P2-website-ga-dashboard-alerts-and-handover.md`
  - Final readout deck and next-quarter backlog
- DoD:
  - Weekly reporting process started
  - Alert thresholds signed off by owner
  - 30-day comparison posted with wins, losses, and next actions

## Risk register
- GA access lag or permission limits.
- Inconsistent event schema between pages.
- Seasonal traffic distortion in first two weeks.
- Cross-team coordination delays on content/design changes.

## Escalation and owner mapping
- Lead analytics: owns KPI definitions and weekly report.
- Marketing lead: owns campaign tagging and source quality.
- Web/content lead: owns copy/design experiments.
- Product lead: owns final scope and go/no-go decision.

## Success metrics by day 30
- +10% confidence in funnel coverage (measured by event completeness against top 3 funnels).
- Identified top 3 conversion blockers with assigned owners.
- Executed at least 2 high-confidence experiments.
- Clear go-forward backlog with quantized expected lift.

## Status note (2026-02-28)
- Sprint 1-4 automation deliverables are complete and evidenced by artifacts in `artifacts/ga/reports/`.
- Roadmap completion is blocked on live-traffic execution data:
  - run monthly/weekly operating cadence against real GA exports,
  - ship and evaluate at least 2 live experiments,
  - post day-30 wins/losses and next-quarter backlog outcomes.
