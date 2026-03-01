# P1 — Events: Industry Feed Contract and Normalization

Status: Active
Date: 2026-03-01
Priority: P1
Owner: Platform + Functions + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

The current `events` model is workshop/checkout-oriented and not designed for external industry discovery content.

## Objective

Define and ship a dedicated industry-events contract that supports local/remote discovery, source attribution, and deterministic card rendering.

## Scope

1. New `industryEvents` domain model (Firestore + TypeScript contracts).
2. Required fields for list cards and detail drilldown.
3. Normalization rules for source imports and manual entries.
4. Expiry and verification metadata.

## Proposed Contract Surface

1. Required:
   - `title`, `startAt`, `timezone`, `mode` (`local`|`remote`|`hybrid`), `sourceUrl`, `sourceName`, `lastVerifiedAt`, `status`
2. Optional:
   - `endAt`, `venueName`, `city`, `state`, `region`, `country`, `registrationUrl`, `tags`, `priceHint`, `description`
3. Quality:
   - `qualityScore`, `curationState`, `dedupeHash`, `ingestedAt`

## Tasks

1. Add `IndustryEventSummary` and `IndustryEventDetail` contracts to portal contracts.
2. Add backend read route(s) for member-safe listing and detail retrieval.
3. Add normalization helpers for date/timezone, mode, and location labels.
4. Add unit tests for malformed rows and duplicate normalization.

## Acceptance Criteria

1. Contract supports both local and remote events without workshop coupling.
2. Missing/extra fields are tolerated defensively without white-screen risk.
3. Invalid/malformed imported rows are filtered with clear diagnostics.
4. Tests cover contract parsing and normalization edge cases.
