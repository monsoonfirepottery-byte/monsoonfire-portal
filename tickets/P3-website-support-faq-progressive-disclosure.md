# P3 — Website Support FAQ Progressive Disclosure

Status: Completed
Priority: P3
Severity: Sev3
Component: website
Impact: med
Tags: website, support, faq, ux

## Problem statement
Support content is comprehensive but dense for first-time visitors. Long FAQ and policy listings can create cognitive load before users understand basics.

## Proposed solution
- Rework support page into progressive disclosure layers:
  - quick-start answers for first-time visitors
  - expandable detailed FAQ entries
  - policy archive as a secondary layer
- Add clearer topical grouping and scannable labels for common tasks (pricing, firing requests, membership, pickup, safety).
- Keep portal as the source of record, while making website answers easier to skim.

## Acceptance criteria
- Support page shows a short "start here" block for new users above deep policy content.
- FAQ entries are grouped by task/topic and are easy to scan on mobile.
- Policy archive remains accessible but does not dominate first-view content.
- Users can find answers to top questions in under 30 seconds without opening every item.

## Manual test checklist
1. Open `/support/` and locate "how to start" guidance in first viewport.
2. Validate FAQ grouping and search/filter behavior (if present).
3. Confirm policy links still resolve correctly.
4. Test at desktop and 390x844 mobile viewport for readability.

## Dependencies
- `tickets/P2-website-new-user-primary-cta-and-start-path.md`
- `tickets/P1-website-a11y-motor-cognitive-and-neurodiverse.md`

## Notes
- Prefer short answers with links to deeper portal-backed details.

## Completion notes (2026-02-17)
- Reworked `website/support/index.html` into clearer progressive disclosure layers:
  - quick-start cards for first-time visitors
  - task shortcut filters for common intents (portal setup, kiln, scheduling, memberships, pricing, studio access)
  - detailed search/filter area for full FAQ and policy content
- Updated FAQ presentation to grouped task sections in `website/assets/js/faq.js`:
  - Start here
  - Kiln firing and handling
  - Studio access and memberships
  - Pricing and payments
  - Policies and safety
  - More questions (fallback)
- Kept policy archive available as a secondary deep-detail layer with updated section framing.
- Playwright visual evidence:
  - `output/playwright/final-support-desktop.png`
  - `output/playwright/final-support-mobile.png`
