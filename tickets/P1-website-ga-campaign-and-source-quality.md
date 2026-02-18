# Website GA campaign and acquisition quality

Status: Planned
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
