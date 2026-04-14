# Live Surface Audit — Website + Portal (2026-04-12)

Status: Completed
Date: 2026-04-12
Owner: Product + Design + Portal Ops
Related Epic: `docs/epics/EPIC-LIVE-SURFACE-TRUST-AND-SERVICE-OPERATING-SYSTEM.md`

This artifact turns the April 2026 live-surface review into a durable repo record. The audit target was the public website at `https://monsoonfire.com` and the member/staff portal at `https://portal.monsoonfire.com`.

Direct rendered inspection was partially blocked from the audit runner:

- `curl -I https://monsoonfire.com` returned `HTTP/1.1 403 Forbidden`.
- `curl -I https://portal.monsoonfire.com` returned `HTTP/1.1 403 Forbidden`.
- `npx playwright install chromium` failed with `403 Forbidden`, so full browser-driven visual review was not possible from that environment.

The findings below separate direct evidence from source-backed inference and call out what still requires manual verification in a real browser session.

# 1. Executive Summary

- Website overall: promising structure, weak operational confidence. The site explains the service categories, but mixed portal destinations, stale operational cues, and loader-first production states make it feel partially maintained instead of tightly run.
- Portal overall: capable but not yet authoritative enough. The portal has meaningful breadth, but first-use clarity, route readiness, and member-facing queue language still leave too much room for hesitation.
- Biggest strategic risk: a cautious artist perceives a black-box service. Mixed handoffs, stale timestamps, and vague status language make it harder to trust Monsoon Fire with fragile work that disappears into a multi-day workflow.
- Biggest strategic opportunity: make both surfaces behave like one calm studio operating system by standardizing the handoff, freshness model, terminology, and piece journey language.

# 2. Evidence Log

## Observed directly

- Live HTTP access from the audit runner was blocked with `403 Forbidden` for both production domains.
- The website source contains mixed portal destinations: some pages target `https://portal.monsoonfire.com`, while others still target `https://monsoonfire.kilnfire.com`.
- Website production markup includes loader-first states such as `Loading kiln status...` and `Loading public updates...`.
- The kiln status data file reports `lastUpdated: 2026-01-31 5:30 PM`, which was stale relative to the April 2026 audit date.
- Portal routing still includes a generic `PlaceholderView` fallback and `WareCheckInView` currently re-exports `ReservationsView`.
- The portal nav groups many tasks into broad buckets without an explicit first-action surface for new members.

## Strong inference

- Users are likely to hesitate when one page says “Open the portal” and another sends them to a legacy host because that reads like migration drift or account fragmentation.
- Stale timestamps, `TBD` public-event language, and visible loading placeholders likely weaken the sense that operations are actively monitored.
- Portal breadth probably exceeds first-time comprehension unless the product recommends a next action based on role and intent.
- Member confidence is still too dependent on reading text blocks instead of seeing a clear “your work journey” model.

## Needs manual verification

- Rendered production hierarchy, spacing, and polish in a real browser session.
- Authenticated portal flows for onboarding, membership, billing, queue visibility, and staff actions.
- Real small-screen behavior on phones and tablets.
- Whether live production currently masks or resolves some of the repo-observed trust leaks at runtime.

# 3. Gap Matrix

| Surface | Area | Current State | Gap | Why It Matters | Severity | Recommended Fix | Effort | Evidence Grade |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Website | Public to portal handoff | Mixed login and portal targets across pages | Canonical handoff is not enforced | Users question whether they are entering the right system | P0 | Standardize one portal host and route intent model everywhere | S | Observed |
| Website | Operational freshness | Kiln status timestamp is stale in source data | No hard freshness contract | Freshness is a proxy for competence in a service business | P0 | Add stale thresholds, freshness badges, and escalation copy | M | Observed |
| Website | Loading states | Production pages expose raw loading copy | Loader-first experience feels temporary | First impression becomes “unfinished” instead of “operational” | P1 | Replace raw loading text with skeletons and stale-safe fallback states | S | Observed |
| Website | Event certainty | Community/event surfaces include tentative language | Confidence model is unclear | Users do not know whether a public activity is real, tentative, or outdated | P1 | Add confirmed/tentative/cancelled chips with verified timestamps | S | Observed |
| Website | CTA clarity | Different pages imply different portal actions | Conversion path is fragmented | Users hesitate instead of moving forward | P1 | Normalize CTA language by intent: reserve, membership, support, dashboard | S | Inference |
| Portal | First-use mental model | Broad nav exists, but “what should I do first?” is weak | No task-first member start surface | First-time users must reverse-engineer the information architecture | P1 | Add member-first home with guided shortcuts and next actions | M | Observed |
| Portal | Ware Check-in semantics | `WareCheckInView` reuses `ReservationsView` | Intake flow language is blurred | Users cannot tell whether they are checking in, booking, or tracking | P1 | Give Ware Check-in a dedicated shell, copy, and step framing | M | Observed |
| Portal | Route readiness | Unknown routes fall back to generic placeholder copy | Production fallback is too generic | “Coming soon” in a member product is a direct trust leak | P0 | Replace placeholders with guided fallback states and support paths | M | Observed |
| Portal | Piece journey clarity | Status data exists but confidence is text-heavy | Queue and stage visibility are still opaque | Artists need proof their work has not vanished into a black box | P0 | Add explicit stage timeline, last touchpoint, and next-step messaging | M | Inference |
| Both | Shared vocabulary | Website and portal use overlapping but inconsistent language | Story and product terminology drift apart | Promise-to-product mismatch increases support burden and distrust | P1 | Publish a shared terminology contract and reuse it across both surfaces | M | Inference |

# 4. Top 10 Highest-Value Improvements

1. Improvement: standardize every public portal/login handoff to one canonical destination.
   Why it matters: removes immediate “is this the right account/system?” hesitation.
   Affects: trust, conversion, clarity.
   Where: both.
   Severity: P0.
   Effort: S.

2. Improvement: add a production freshness contract for kiln status, public updates, and event certainty.
   Why it matters: stale operational signals look like neglect.
   Affects: trust, operational confidence.
   Where: website.
   Severity: P0.
   Effort: M.

3. Improvement: replace generic placeholder routes with guided fallback states.
   Why it matters: “coming soon” language in a live member surface damages confidence fast.
   Affects: trust, usability.
   Where: portal.
   Severity: P0.
   Effort: M.

4. Improvement: create a member-first start surface that recommends the next action.
   Why it matters: first-use uncertainty is still too high.
   Affects: clarity, usability, conversion.
   Where: portal.
   Severity: P1.
   Effort: M.

5. Improvement: separate Ware Check-in from Reservations in language and flow framing.
   Why it matters: the current reuse leaks internal structure into the member journey.
   Affects: trust, clarity, usability.
   Where: portal.
   Severity: P1.
   Effort: M.

6. Improvement: introduce a unified “your work journey” timeline across website and portal.
   Why it matters: users need chain-of-custody confidence, not just generic status text.
   Affects: trust, operational confidence, delight.
   Where: both.
   Severity: P0.
   Effort: M.

7. Improvement: normalize CTA language by user intent.
   Why it matters: “get started,” “open the portal,” and legacy links currently create drift.
   Affects: conversion, clarity.
   Where: website.
   Severity: P1.
   Effort: S.

8. Improvement: give event and update surfaces confidence labels instead of vague text.
   Why it matters: public programming should feel curated and current, not provisional.
   Affects: trust, clarity.
   Where: website.
   Severity: P1.
   Effort: S.

9. Improvement: add automation that fails on legacy portal links, stale public status data, and generic placeholders.
   Why it matters: these are trust leaks that should not depend on memory to catch.
   Affects: trust, release confidence.
   Where: both.
   Severity: P1.
   Effort: M.

10. Improvement: standardize a small trust-oriented component set across both surfaces.
    Why it matters: shared states create family resemblance and operational coherence.
    Affects: trust, clarity, delight.
    Where: both.
    Severity: P2.
    Effort: M.

# 5. Trust Leaks

1. Mixed portal hosts in production-facing website pages.
   Why it weakens confidence: it implies split systems or a migration that is not under control.
   Severity: P0.
   Recommended fix: remove all legacy `monsoonfire.kilnfire.com` login/create-account links from public surfaces and enforce parity in tests.

2. Stale operational timestamp on kiln status data.
   Why it weakens confidence: users infer that the queue or firing board may not be actively watched.
   Severity: P0.
   Recommended fix: add freshness thresholds, stale messaging, and an owner update cadence.

3. Raw loading placeholders in public production markup.
   Why it weakens confidence: if content loads slowly or fails, the site feels unfinished instead of resilient.
   Severity: P1.
   Recommended fix: show structured skeletons and explicit fallback copy rather than raw “Loading...” text.

4. Generic portal placeholder route.
   Why it weakens confidence: “coming soon” language inside a member/staff portal reads as incomplete product surface area.
   Severity: P0.
   Recommended fix: provide guided fallback cards with available next actions, support contact, and route-specific ownership.

5. Ware Check-in and Reservations sharing the same implementation shell.
   Why it weakens confidence: member language reflects internal reuse instead of the user’s actual task.
   Severity: P1.
   Recommended fix: split copy, entry framing, and progress language even if data plumbing stays shared initially.

6. Public event certainty is not explicit enough.
   Why it weakens confidence: tentative or outdated programming makes the studio feel loosely operated.
   Severity: P1.
   Recommended fix: add certainty chips, verified timestamps, and expiry/fallback rules.

# 6. Motion + Interaction Recommendations

1. Page or component: public status cards.
   Current weakness: freshness and liveness are not visually differentiated.
   Proposed pattern: subtle live/stale status transition with timestamp emphasis.
   Why it helps: communicates whether the operator has touched the data recently.
   Complexity: S.

2. Page or component: website-to-portal handoff CTA.
   Current weakness: handoff is abrupt and inconsistent.
   Proposed pattern: brief transition state that confirms destination and task intent.
   Why it helps: reassures users they are entering the correct system.
   Complexity: S.

3. Page or component: Ware Check-in.
   Current weakness: flow semantics are blurred.
   Proposed pattern: intake stepper with persistent summary and “what happens next” copy.
   Why it helps: lowers hesitation during a meaningful handoff of artwork.
   Complexity: M.

4. Page or component: queue and piece status cards.
   Current weakness: status comprehension is text-heavy.
   Proposed pattern: stage chips plus expanding history/timeline rows.
   Why it helps: makes piece progress legible at a glance.
   Complexity: M.

5. Page or component: placeholder and empty states.
   Current weakness: generic or sparse fallback messaging.
   Proposed pattern: guided fallback cards with retry, support, and alternate route.
   Why it helps: keeps failure states from feeling like dead ends.
   Complexity: S.

6. Page or component: event/update cards.
   Current weakness: certainty and recency are under-signaled.
   Proposed pattern: verified-at microcopy with confirmed/tentative state chips.
   Why it helps: public operations feel curated and current.
   Complexity: S.

# 7. Design System / Reusable Component Recommendations

- Component name: Status chip.
  Where it should appear: website updates, kiln status, event cards, portal queue states.
  Gap it solves: inconsistent language for live, stale, confirmed, tentative, ready, delayed.
  Priority: essential now.

- Component name: Freshness row.
  Where it should appear: any data-backed surface with operational timestamps.
  Gap it solves: missing or vague “last updated” handling.
  Priority: essential now.

- Component name: Service journey timeline.
  Where it should appear: public “how it works,” reservations, my pieces, pickup states.
  Gap it solves: black-box workflow perception.
  Priority: essential now.

- Component name: Guided empty/fallback state.
  Where it should appear: portal routes, empty lists, failed async blocks.
  Gap it solves: generic placeholders and dead ends.
  Priority: essential now.

- Component name: Task-first shortcut card.
  Where it should appear: portal home/start surfaces.
  Gap it solves: first-use navigation overload.
  Priority: essential now.

- Component name: Confidence label set for public programming.
  Where it should appear: events, updates, community programming.
  Gap it solves: uncertainty around whether public programming is confirmed.
  Priority: essential now.

- Component name: Evidence/checkpoint card.
  Where it should appear: piece detail and staff/member status history.
  Gap it solves: missing proof-of-care moments for fragile work.
  Priority: later.

# 8. Website Recommendations by Page/Section

## Home

- What works: service categories and a portal-forward entry path exist.
- What is weak: loader-first operational modules and generic CTA phrasing reduce confidence.
- What is missing: an explicit “new here / returning / need support” start decision.
- Concrete fix: add intent-based entry cards plus freshness-aware status modules.

## Services

- What works: major service buckets are present.
- What is weak: the page still feels category-driven more than decision-driven.
- What is missing: fast answers to “what should I do next?”
- Concrete fix: restructure top content around user intents, not just service labels.

## Kiln Firing

- What works: clear service specialization exists.
- What is weak: turnaround and queue confidence are not strong enough.
- What is missing: a simple lifecycle explanation with typical timing bands.
- Concrete fix: add a queue-to-pickup timeline and explicit turnaround expectations.

## FAQ / Community

- What works: community/programming context is visible.
- What is weak: tentative or stale event language looks provisional.
- What is missing: confidence labels and a visible update cadence.
- Concrete fix: ship confirmed/tentative labels and verified timestamps.

## Support

- What works: support path exists.
- What is weak: support risks being copy-heavy and operationally cold.
- What is missing: quick triage by intent such as status, pickup, billing, or policy.
- Concrete fix: put action cards ahead of dense explanation blocks.

## Policies / Updates

- What works: policy and updates surfaces exist separately.
- What is weak: last-updated language is easy to let drift.
- What is missing: explicit ownership and cadence.
- Concrete fix: add freshness handling and a small “what changed” summary pattern.

# 9. Portal Recommendations by Product Area

## Onboarding / first-use experience

- Likely user goal: understand what the portal is for and where to begin.
- Current weakness: nav breadth outpaces guidance.
- Trust / workflow issue: first-time members must guess.
- Recommended change: add a member-first start surface with role-aware shortcuts.

## Ware Check-in

- Likely user goal: submit work with confidence.
- Current weakness: check-in semantics are coupled to reservations.
- Trust / workflow issue: the user is not sure what they are committing to.
- Recommended change: give Ware Check-in its own shell, step framing, and confirmation language.

## Queues / Firings

- Likely user goal: know where submitted work is and what happens next.
- Current weakness: status is present but not confidence-forward.
- Trust / workflow issue: users still experience the queue as a black box.
- Recommended change: show stage, last touchpoint, next expected step, and exception language.

## My Pieces / piece status

- Likely user goal: confirm work has not disappeared.
- Current weakness: timeline proof is thinner than it should be.
- Trust / workflow issue: text alone does not establish chain of custody.
- Recommended change: add a member-facing journey timeline with recent history.

## Studio & Resources

- Likely user goal: reserve the right thing quickly.
- Current weakness: related tasks can feel spread across module names.
- Trust / workflow issue: users expend attention on navigation instead of action.
- Recommended change: introduce segmented “book / review / manage” entry paths.

## Glaze Board

- Likely user goal: make a confident material decision.
- Current weakness: audit runner could not verify live render quality.
- Trust / workflow issue: if discovery is weak, material decisions feel risky.
- Recommended change: prioritize searchable filters and result-comparison patterns.

## Membership

- Likely user goal: understand value, approval, and next steps.
- Current weakness: membership can get lost in broader portal IA.
- Trust / workflow issue: signup friction feels higher than it should.
- Recommended change: create a simple compare/apply/status path with clearer approval timing.

## Billing

- Likely user goal: understand what they owe and why.
- Current weakness: direct live render was not verified here.
- Trust / workflow issue: billing confusion can erase product confidence quickly.
- Recommended change: tie charges to service milestones and make status explicit.

## Community

- Likely user goal: know what changed and how to participate.
- Current weakness: community can fragment across multiple surfaces.
- Trust / workflow issue: users may miss important updates or feel there is no active pulse.
- Recommended change: show a concise “since your last visit” feed and stronger freshness semantics.

## Staff/operator-facing areas

- Likely user goal: triage quickly without leaking internal jargon into member experience.
- Current weakness: staff abstractions risk shaping member language.
- Trust / workflow issue: member-facing surfaces can inherit internal wording.
- Recommended change: keep a hard copy boundary between staff control language and member reassurance language.

# 10. Fast Wins vs Strategic Rebuilds

## Fast wins this week

- Standardize all public portal/login links to `portal.monsoonfire.com`.
- Add stale-state badges and fallback copy for public status modules.
- Replace raw loading copy and generic placeholder messaging.
- Add one task-first member start card set in the portal.

## Medium-size improvements this month

- Ship the Ware Check-in semantic split from Reservations.
- Add queue and piece journey confidence UI.
- Standardize cross-surface terminology and trust-oriented UI states.
- Add automated parity guards for legacy host links and placeholder regressions.

## Larger strategic redesign items

- Build one shared service journey model across marketing, intake, queue, firing, cooling, and pickup.
- Add piece-level evidence and checkpoint artifacts.
- Mature a cross-surface design system centered on trust, clarity, and operational confidence.

# 11. Hard Verdict

- Production-credible now: Monsoon Fire already has real product surface area, meaningful service intent, and the beginnings of a multi-stage studio operating system.
- Underbuilt now: handoff confidence, freshness signaling, first-use clarity, and member-facing chain-of-custody communication.
- Must fix first: canonical public-to-portal handoff, stale/placeholder production trust leaks, and a clearer member journey through Ware Check-in, queue visibility, and piece status.
