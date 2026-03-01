# P1 — Policy Single Source of Truth for Website, Portal, and Reports

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Policy Ops + Portal + Website
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Reports module depends on an "active published Code of Conduct" policy state that can diverge from what is already published on the website, creating false blocking errors and operator confusion.

## Objective

Create a single policy source of truth with shared publication state so website content and portal/report enforcement resolve from the same canonical policy version.

## Scope

1. Canonical policy storage and publication-state contract.
2. Shared reader path for website rendering and portal/reports checks.
3. Migration/backfill from current split sources with parity validation.

## Tasks

1. Define canonical policy model (version, status, effectiveAt, slug, body/source pointer).
2. Refactor reports policy checks to read canonical policy state.
3. Refactor website policy pages to consume the same canonical source.
4. Add parity checker to fail when website/portal disagree on active policy.
5. Add runbook for policy publishing workflow and rollback.

## Acceptance Criteria

1. Website and portal/reports resolve active policy from one canonical source.
2. Reports no longer raises false "no active policy" when website has active canonical policy.
3. Policy publish flow updates both surfaces consistently in one operation.
4. Automated parity check exists and alerts on drift.

## Implementation Log

1. Added canonical policy source constants and fallback record in `functions/src/policySourceOfTruth.ts` (website slug/version/url + canonical version).
2. Updated policy readers to use canonical fallback when active moderation policy is missing or unconfigured:
   - `functions/src/reports.ts`
   - `functions/src/moderationPolicy.ts`
3. Added policy source parity guard script + workflow:
   - `scripts/policy-single-source-of-truth-check.mjs`
   - `.github/workflows/policy-single-source-of-truth-parity.yml`
4. Kept publishing/runbook documentation in sync:
   - `docs/runbooks/POLICY_SINGLE_SOURCE_OF_TRUTH_WEBSITE_PORTAL_REPORTS.md`
   - `docs/policies/README.md`
   - `docs/COMMUNITY_REPORTING_ARCHITECTURE.md`

## Evidence

1. Canonical source model + fallback policy: `functions/src/policySourceOfTruth.ts`
2. Canonical fallback wiring in reports + moderation policy endpoints:
   - `functions/src/reports.ts`
   - `functions/src/moderationPolicy.ts`
3. Parity checker + workflow:
   - `scripts/policy-single-source-of-truth-check.mjs`
   - `.github/workflows/policy-single-source-of-truth-parity.yml`
4. Runbook + policy architecture docs:
   - `docs/runbooks/POLICY_SINGLE_SOURCE_OF_TRUTH_WEBSITE_PORTAL_REPORTS.md`
   - `docs/policies/README.md`
   - `docs/COMMUNITY_REPORTING_ARCHITECTURE.md`

## Validation

1. `npm --prefix functions run build` passes with canonical fallback + moderation-policy typing updates.
2. `npm --prefix functions run test -- policySourceOfTruth.test.ts` passes.
3. Website/portal drift guard is runnable in CI via `policy-single-source-of-truth-parity` workflow.
