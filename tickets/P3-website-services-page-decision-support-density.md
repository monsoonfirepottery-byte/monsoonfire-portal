# P3 — Website Services Page Decision-Support Density

Status: Completed
Priority: P3
Severity: Sev3
Component: website
Impact: med
Tags: website, services, conversion, content

## Problem statement
The services page communicates studio offerings, but first-time visitors still need to infer key decisions (what to choose, what it costs, and what happens next). This slows conversion.

## Proposed solution
- Add a concise "choose your path" decision block near the top of `/services/`.
- Surface critical constraints and expectations inline (reservation required, who each path is for, rough starting point).
- Add trust cues (policy summaries and direct links to pricing/policies/support) without bloating the page.

## Acceptance criteria
- Services page includes a visible decision-support section that helps users choose between kiln rentals, studio access, and community options.
- Each path includes plain-language "best for" and "next step" guidance.
- Key trust details are visible without requiring deep navigation.
- Page remains readable and scannable on mobile.

## Manual test checklist
1. Open `/services/` as a new visitor and confirm the path-choice guidance is understandable in under 20 seconds.
2. Verify each offering links to a concrete next action.
3. Verify policy/pricing/support links are visible and functional.
4. Verify layout and readability at 390x844 viewport.

## Dependencies
- `tickets/P3-website-polish-conversion-trust.md`
- `tickets/P2-website-new-user-primary-cta-and-start-path.md`

## Notes
- Keep copy concise and avoid introducing legal-style text walls.

## Completion notes (2026-02-17)
- Added an above-the-fold decision-support block to `website/services/index.html`:
  - explicit path choices for kiln rentals, studio access, and membership/community
  - plain-language `Best for` and `Next step` guidance in each path card
- Added trust and expectation cues directly on-page:
  - appointment-only scheduling reminder
  - address/access disclosure timing
  - pricing/policy source clarity
  - support response-time expectation
- Added direct trust-link actions:
  - `/support/`
  - `/policies/`
  - `/contact/`
