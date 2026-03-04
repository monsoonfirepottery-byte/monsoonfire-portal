# Industry Events Curation Runbook

Last reviewed: 2026-03-01
Owner: Program Ops + Community

## Purpose

Keep Events page industry listings accurate, useful, and fresh for studio members seeking local and remote opportunities.

## Curation Checklist (Before Publish)

1. Source is official or high-trust community channel.
2. Event title/date/timezone/location are explicit.
3. `mode` is set correctly: `local`, `remote`, or `hybrid`.
4. Registration URL is present and accessible.
5. `verifiedAt` (or `sourceVerifiedAt`) is set to current review date.
6. Duplicate check passed (`sourceUrl` + normalized title/date).
7. Card copy avoids over-promising and uses source-attributed language.

## Data + API Contract

Firestore collection: `industryEvents`

Required fields for published feed:

1. `title`
2. `summary`
3. `mode` (`local`, `remote`, `hybrid`)
4. `status` (`published`)
5. `startAt` (recommended), `endAt` (optional), `timezone` (recommended)
6. At least one outbound link (`registrationUrl`, `remoteUrl`, or `sourceUrl`)

Portal functions:

1. `listIndustryEvents` (POST) for member/staff browse feed
2. `getIndustryEvent` (POST) for detail lookup by `eventId`
3. `upsertIndustryEvent` (POST, staff-only) for curation writes
4. `runIndustryEventsFreshnessNow` (POST, staff-only) for manual freshness sweeps

`upsertIndustryEvent` validation highlights:

1. `title` and `summary` cannot be blank after trimming.
2. `eventId` cannot contain `/`.
3. `remoteUrl`, `registrationUrl`, and `sourceUrl` must be valid `http(s)` URLs when provided.
4. Published events require `startAt` and at least one outbound link.

## Seeding + Preflight

Fast local checks:

1. `npm run events:industry:check`

Seed starter marquee rows (defaults to draft status unless `--publish` is passed to the underlying function script):

1. `npm run events:industry:seed:dry`
2. `npm run events:industry:seed`

## Featured Event Policy

Use featured/pinned slots for:

1. Marquee national events (for example NCECA).
2. High-relevance regional conventions for member geography.
3. Time-sensitive events with short registration windows.

## Freshness Policy

1. Upcoming events without verification in the last 21 days are flagged.
2. Past events are retired from member feed within 48 hours.
3. Cancelled events are retired immediately and annotated in audit logs.

Automation contract:

1. Scheduled job `sweepIndustryEvents` runs every 6 hours (America/Phoenix).
2. Sweep sets `freshnessState` (`fresh`, `stale_review`, `retired`, `non_published`) and `needsReview`.
3. Published events older than 48 hours past end/start are auto-transitioned to `cancelled` with `retiredReason: past_event_auto_retire`.

## Weekly Operating Rhythm

1. Review new source candidates.
2. Triage connector imports and resolve malformed rows.
3. Verify featured list still reflects upcoming member value.
4. Run canary/regression checks and archive artifacts.

## Incident Triggers

Escalate when:

1. Member feed is empty while approved events exist.
2. Outbound links fail for two or more featured events.
3. Duplicate listings exceed threshold in one cycle.
4. Expired events remain visible after freshness job.

## Related Tickets

- `tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md`
- `tickets/P1-events-staff-curation-source-review-and-publishing.md`
- `tickets/P2-events-sourcing-connectors-and-freshness-automation.md`
- `tickets/P2-events-qa-runbook-and-canary-regression-gate.md`
