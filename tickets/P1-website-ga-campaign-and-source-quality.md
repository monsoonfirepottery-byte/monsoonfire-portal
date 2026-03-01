# Website GA campaign and acquisition quality

Status: Completed
Priority: P1
Severity: Sev2
Component: website
Impact: high
Tags: website, acquisition, analytics, seo, paid

## Problem statement
Traffic growth is difficult to evaluate without consistent campaign/source quality signals and landing-page context.

## Proposed solution
Normalize acquisition metadata and prioritize high-intent traffic sources, while reducing low-intent noise.

## Tasks
1. Audit current `utm_*` usage and hardcoded links for consistent campaign conventions.
1. Classify top acquisition channels:
   - organic search
   - paid social/search
   - referral
   - direct
   - email
1. Add missing UTM tagging policy for all outbound campaigns and short-links.
1. Compare source/medium with landing-page conversion to identify misaligned entry points.
1. Propose and execute quick wins for strongest-performing acquisition combos.

## Acceptance criteria
- UTM taxonomy is documented and shared with marketing and automation owners.
- Campaign links in at least 80% of current paid/referral/email touchpoints carry standardized tags.
- Low-converting channels have clear remediation actions defined by page and owner.
- Weekly acquisition quality report exists with top 10 source/medium by (sessions, conversion rate, assisted revenue).

## Dependencies
- Marketing ownership of outgoing campaign links and templates.
- Access to GA acquisition reports and campaign settings.

## Manual test checklist
1. Open 3 marketing links from each major channel in incognito and verify tracked parameters in query string.
1. Confirm GA source/medium captures appear correctly on next-session start.
1. Verify conversion events are attributed to the expected campaign row.

## Unblock update (2026-02-25)
- Added UTM/source taxonomy foundation doc and runbook alignment:
  - `docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md`
  - `docs/runbooks/WEBSITE_GA_SPRINT1_FOUNDATIONS.md`
- Added deterministic foundations check command:
  - `npm run website:ga:sprint1:check`
  - artifact: `artifacts/website-ga-sprint1-foundations.json`
- Remaining blocker:
  - campaign attribution validation requires live GA acquisition data exports.

## Progress update (2026-02-28)
- Added acquisition quality report automation from exported baseline CSVs:
  - `scripts/build-website-ga-baseline-report.mjs`
  - `npm run website:ga:baseline:report`
- Report output now standardizes top-10 `source/medium` rollups with sessions, conversion rate, and assisted revenue when available:
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.json`
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.md`

## Completion evidence (2026-02-28)
- Added campaign touchpoint auto-tagging (`utm_source`, `utm_medium`, `utm_campaign`) for known outbound campaign hosts:
  - `website/assets/js/main.js`
  - `website/ncsitebuilder/assets/js/main.js`
- Added deterministic campaign-link audit + remediation artifact:
  - `scripts/audit-website-ga-campaign-links.mjs`
  - `npm run website:ga:campaign:audit -- --strict`
- Latest acquisition/campaign evidence:
  - `artifacts/ga/reports/website-ga-campaign-link-audit-latest.json`
  - `artifacts/ga/reports/website-ga-campaign-link-audit-latest.md`
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.json`
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.md`
- Current strict audit result:
  - `effectiveCoveragePct = 100` (minimum required `80`)
