# Website GA funnel friction and conversion drop investigation

Status: Proposed
Priority: P2
Severity: Sev3
Component: website
Impact: medium
Tags: website, conversion, funnels, analytics

## Problem statement
Recent analytics snapshots should expose where users leave high-value journeys, but funnel steps and drop-offs are not yet mapped to actionable design changes.

## Proposed solution
Run a conversion-path audit on top journeys and implement short-cycle fixes on the most lossy steps.

1. Identify the top 3 high-traffic conversion journeys.
1. Map each journey to explicit GA funnel stages.
1. Flag the top 20% step transitions with the highest drop-off.
1. For each drop-off, propose one UX/policy/test intervention (clarify copy, trust signal, CTA visibility, field simplification, speed).
1. Implement and prioritize a two-week experimentation queue.

## Acceptance criteria
- At least 3 named funnels are documented with step-level conversion rates.
- Top-drop step set is reduced with at least one intervention per step.
- Each intervention has hypothesis + expected impact + owner.
- Post-change comparison period is defined for remeasurement.

## Dependencies
- Event + goal consistency from `P1-website-ga-event-and-goal-instrumentation-completeness.md`.
- Design and copy input from web/content owners.

## Manual test checklist
1. Launch one low-friction control/test experiment per top-drop area.
1. Validate instrumented success/fail events in both desktop and mobile sessions.
1. Publish post-change report with before/after funnel rates.
