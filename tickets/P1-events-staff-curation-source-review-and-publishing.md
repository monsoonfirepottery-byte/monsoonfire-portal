# P1 — Events: Staff Curation, Source Review, and Publishing

Status: Active
Date: 2026-03-01
Priority: P1
Owner: Staff Console + Program Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

Without curation controls, external event listings can become noisy, stale, or low trust.

## Objective

Provide staff workflow to approve, promote, edit, and retire industry-event listings with clear provenance.

## Scope

1. Staff-only event curation queue and publish controls.
2. Source-review checklist and verification metadata.
3. Pinned marquee event controls for high-value national/regional events.
4. Retirement flow for expired/cancelled entries.

## Tasks

1. Add staff curation actions and state model (`draft`, `published`, `cancelled`) plus `featured` pinning.
2. Require publish-time quality gates: at least one outbound URL (`registrationUrl`, `remoteUrl`, or `sourceUrl`) and `verifiedAt` review metadata.
3. Add bulk stale-review actions for events crossing freshness thresholds.
4. Add audit events for publish/unpublish/feature actions.

## Acceptance Criteria

1. Staff can curate without editing code or Firestore manually.
2. Featured events can be pinned deterministically for member browse.
3. Cancelled events disappear from member feed but remain auditable.
4. Every published event has source attribution and verification metadata (`verifiedAt` preferred).
