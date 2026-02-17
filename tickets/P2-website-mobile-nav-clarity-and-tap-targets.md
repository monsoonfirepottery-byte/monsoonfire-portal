# P2 — Website Mobile Nav Clarity + Tap Targets

Status: Completed
Priority: P2
Severity: Sev2
Component: website
Impact: high
Tags: website, mobile, nav, ux

## Problem statement
On small viewports, the menu affordance is visually ambiguous and easy to miss. This can block navigation discovery for new users and reduce conversion.

## Proposed solution
- Redesign the mobile nav trigger to be unmistakably interactive.
- Ensure tap target size and spacing meet accessibility guidance.
- Validate open/close states, focus states, and contrast for the trigger and drawer/menu items.

## Acceptance criteria
- Mobile nav trigger is visually clear in default, hover/focus, and open states.
- Tap target is at least 44x44 CSS pixels.
- Menu opens/closes reliably with touch and keyboard.
- Primary paths (`The Studio`, `Kiln Firing`, `Community`, `Support`, `Gallery`, `Login`) are reachable in two taps or fewer.

## Manual test checklist
1. Test at 390x844 and 375x812 viewports.
2. Verify nav trigger discoverability with no prior context.
3. Verify keyboard navigation and focus visibility.
4. Verify there are no accidental taps due to cramped controls.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`
- `tickets/P1-website-a11y-motor-cognitive-and-neurodiverse.md`

## Progress notes (2026-02-17)
- Updated global mobile nav trigger styling for clearer affordance and states:
  - stronger default/hover/focus/open states
  - 48x48 minimum target sizing
  - open-state icon transition for clear menu state
- Improved mobile menu panel readability and tap ergonomics:
  - bounded menu panel container on small viewports
  - 48px minimum link tap targets
  - focus-visible treatment for keyboard users
- Added JS menu reliability improvements:
  - centralized menu open/close state sync with `aria-expanded`
  - outside-click close behavior
  - `Escape` close behavior with focus return to trigger
  - auto-collapse when switching to desktop breakpoint

## Completion notes (2026-02-17)
- Playwright mobile smoke captures generated for key pages:
  - `output/playwright/nav-pass-home-mobile.png`
  - `output/playwright/nav-pass-services-mobile.png`
  - `output/playwright/nav-pass-kiln-mobile.png`
  - `output/playwright/nav-pass-memberships-mobile.png`
  - `output/playwright/nav-pass-contact-mobile.png`
- Visual checks confirm clearer menu trigger affordance and maintained tap-target spacing on key flows.
