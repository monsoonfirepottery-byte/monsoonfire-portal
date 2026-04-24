# Epic: Membership Decommission and Studio Feature Focus (Portal + Website)

## Epic Summary
Monsoon Fire will decommission the membership feature across both the Portal product (`web/`) and the marketing Website (`website/`), then re-center product and content experience around proven studio workflows.

Primary intent:
- Remove confusing or partially-operational membership paths.
- Reduce support burden and edge-case failures.
- Keep users focused on working features that are already delivering value in studio operations.

## Problem Statement
The membership surface creates product complexity and expectation mismatch relative to what is currently stable and actively operated in-studio. This causes:
- UX fragmentation between Portal and Website.
- Extra maintenance burden (copy, flows, support responses, and potential dead-end routes).
- Operational drag that distracts from core batch-first kiln workflow quality.

## Goals
1. Remove membership acquisition, management, and promotional surfaces from Portal and Website in controlled phases.
2. Preserve continuity for existing users by providing clear messaging and safe redirects (no blank screens, no broken nav).
3. Reallocate product attention to working studio features:
   - Active batches
   - History
   - Continue journey
   - Timeline
4. Keep architecture and contracts mobile-forward (stateless, explicit, defensive).

## Non-Goals
- Replacing membership with a net-new paid product in this epic.
- Refactoring unrelated authentication infrastructure.
- Broad design overhaul beyond decommission UX and studio-focus copy alignment.

## Scope
### In Scope
- Portal UI removal/hiding of membership feature entries, routes, and CTAs.
- Website removal/hiding of membership marketing pages, links, and conversion elements.
- Redirects and fallback UX for removed URLs.
- Support/comms updates for the transition.
- Lightweight data retention + archival decision for historical membership records.

### Out of Scope
- Pricing/commerce redesign beyond membership shutdown messaging.
- New backend monetization APIs.
- iOS client membership support (deprioritized by strategy).

## Success Metrics
- 0 production blank-screen incidents tied to membership route removal.
- 0 broken primary-nav links in Portal and Website after cutover.
- Membership-related support tickets trend down within 30 days of launch.
- Increased engagement concentration on studio workflows (Active/History/Timeline/Continue Journey).

## Risks and Mitigations
1. **Risk: Existing users land on removed pages.**
   - Mitigation: maintain route-level redirects + contextual messaging for at least one release cycle.
2. **Risk: Hidden dependency in nav/layout causes runtime error.**
   - Mitigation: phased flagging, smoke checks, and top-level error boundary verification before each phase close.
3. **Risk: Content mismatch between Portal and Website during rollout.**
   - Mitigation: shared cutover checklist and same-day content freeze/cutover window.
4. **Risk: Team uncertainty about historical membership data policy.**
   - Mitigation: explicit archive/retention decision checkpoint in Phase 1.

## Phase Plan

## Phase 0 — Discovery and Freeze (1–2 days)
**Objective:** Prevent further expansion of membership and inventory current surfaces.

### Deliverables
- Membership touchpoint inventory (Portal routes/components, Website pages/links, support docs).
- Freeze policy: no new membership work merged unless explicitly approved.
- Owner-approved decommission messaging draft.

### Exit Criteria
- Complete inventory with owner sign-off.
- Decommission timeline and announcement window agreed.

## Phase 1 — Contract and Data Decisions (1–2 days)
**Objective:** Lock down backend and data handling posture before UI removal.

### Deliverables
- Decision record for membership data retention (archive, read-only retention window, or purge schedule).
- Cloud Functions behavior plan for deprecated membership endpoints (return explicit deprecation response where applicable).
- Monitoring checklist for any residual membership traffic.

### Exit Criteria
- Written decision on retention and endpoint behavior approved.
- Backward-compatible response strategy confirmed for any in-flight clients.

## Phase 2 — Portal Decommission (2–4 days)
**Objective:** Remove membership from the Portal without breaking existing stable studio workflows.

### Work Items
- Remove/hide membership navigation entries and CTAs.
- Remove or deprecate membership-specific routes; add safe redirects to core studio destinations.
- Update empty states and dashboard copy to emphasize operational studio actions.
- Validate that Active/History/Continue Journey/Timeline remain unaffected.
- Ensure errors are explicit and recoverable if deprecated endpoints are hit.

### QA Focus
- No white-screen on direct navigation to legacy membership URLs.
- Authenticated and unauthenticated route behavior remains intentional.
- Continue Journey contract and existing auth headers remain unchanged.

### Exit Criteria
- Portal smoke pass complete with no severity-1 regressions.
- Legacy membership entry points resolve to safe destinations.

## Phase 3 — Website Decommission (2–3 days)
**Objective:** Remove membership marketing UX and align site narrative around working studio offerings.

### Work Items
- Remove membership hero sections, plan cards, dedicated membership page links, and footer references.
- Add replacement messaging highlighting active studio offerings and pathways.
- Configure redirects for removed membership pages.
- Refresh sitemap/internal links to remove membership destinations.

### QA Focus
- No dead links from homepage/nav/footer/blog references.
- SEO-safe redirects and crawl continuity for retired URLs.
- Mobile layout remains stable after section removal.

### Exit Criteria
- Website navigation and content fully membership-free.
- Redirect checks pass for known legacy membership URLs.

## Phase 4 — Communications and Operational Readiness (1–2 days)
**Objective:** Ensure users/staff understand the transition and support has a single answer.

### Deliverables
- User-facing transition notice copy (Portal + Website).
- Staff support response template (email/DM/in-person script).
- Internal FAQ: what changed, what to use now, and where to escalate edge cases.

### Exit Criteria
- Support team confirms script readiness.
- Transition messaging deployed in both surfaces.

## Phase 5 — Stabilization and Follow-Through (7–14 days)
**Objective:** Confirm decommission success and reinvest attention into working studio feature quality.

### Work Items
- Monitor logs and analytics for legacy URL hits, 404s, and deprecation responses.
- Resolve lingering references in docs/content.
- Open follow-up tickets for studio-feature improvements discovered during cutover.

### Exit Criteria
- No critical issues for one full monitoring window.
- Post-epic review published with lessons and next studio-priority roadmap slice.

## Delivery Checklist
- [ ] Membership touchpoint inventory completed.
- [ ] Data retention/deprecation decision recorded.
- [ ] Portal membership routes removed or redirected.
- [ ] Website membership pages/links removed or redirected.
- [ ] Shared communications package published.
- [ ] Stabilization review completed and next studio-focused backlog queued.

## Dependencies
- Portal deploy path readiness.
- Website deploy path readiness.
- Owner approval on messaging + data retention policy.

## Rollback Strategy
- Keep redirects and deprecation handlers reversible for one release cycle.
- Preserve a lightweight feature flag or controlled revert patch for critical path restoration.
- If unforeseen production regressions appear, restore prior navigation entries while retaining warning copy until fix is verified.

## Definition of Done
This epic is complete when:
1. Membership no longer appears as an active product path in Portal or Website.
2. Legacy membership URLs fail safely via redirect/message (not crash or blank page).
3. Users and staff are clearly directed to currently working studio workflows.
4. Stabilization window closes without critical decommission-related incidents.
