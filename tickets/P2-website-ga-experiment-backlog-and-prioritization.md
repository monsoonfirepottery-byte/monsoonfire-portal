# GA-backed website experiment backlog and prioritization

Status: Planned
Priority: P2
Severity: Sev3
Component: website
Impact: medium
Tags: website, experimentation, conversion, analytics

## Problem statement
Without a shared prioritization model, website optimization can drift into many small tests with unclear value.

## Prioritization framework
- Impact (1–5): expected lift potential
- Confidence (1–5): evidence strength and certainty
- Effort (1–5): person-days or equivalent complexity
- Risk (1–5): potential user trust, legal, or technical risk
- Score: `(Impact * Confidence) / (Effort + Risk)`

## Hypotheses and suggested experiments
1. Clarify primary CTA label and placement on top 3 services pages.
   - Impact: 4, Confidence: 4, Effort: 2, Risk: 2
2. Add phone-click CTA trust panel above fold on mobile.
   - Impact: 4, Confidence: 3, Effort: 2, Risk: 2
3. Add short "What to expect" block with 3 bullet trust cues under top CTA.
   - Impact: 3, Confidence: 4, Effort: 1, Risk: 1
4. Standardize campaign UTM fields and remove unstructured links on paid surfaces.
   - Impact: 5, Confidence: 5, Effort: 2, Risk: 2
5. Add/refresh FAQ snippets for highest-traffic inquiry pages.
   - Impact: 3, Confidence: 3, Effort: 3, Risk: 1
6. Simplify first form field set for contact starts to reduce friction.
   - Impact: 5, Confidence: 3, Effort: 3, Risk: 2

## Process
1. Pull ranked list weekly from GA and recalculate score with latest data.
2. Gate each experiment with:
   - owner
   - hypothesis statement
   - measurement window
   - target delta
3. Run up to 2 concurrent experiments to avoid sample contamination.
4. Document result and roll winner to static page after statistical confidence.

## Acceptance criteria
- Experiment backlog has at least 6 experiments with score and ranking.
- Top 3 experiments are linked to GA-derived drop points or channel inefficiencies.
- Every run includes hypothesis, success metric, and rollback condition.
- Each closed experiment has result summary (winner/loser/neutral) and artifact links.

## Dependencies
- Reliable funnel/instrumentation from `P1-website-ga-event-and-goal-instrumentation-completeness.md`
- Campaign hygiene ticket for source accuracy from `P1-website-ga-campaign-and-source-quality.md`

## Manual checklist
1. Score all proposed experiments and verify the top 3 are implemented first.
2. Confirm each has non-overlapping target pages/events.
3. Confirm results are logged in weekly reporting ticket.
