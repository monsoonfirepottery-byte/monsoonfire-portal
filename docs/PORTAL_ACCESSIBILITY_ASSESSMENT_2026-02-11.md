# Portal Accessibility Assessment (Monsoon Fire Portal)

Date: 2026-02-11  
Scope: `web/src` Portal application (not marketing `website/`)
Target standard: WCAG 2.2 AA

## Summary
- The portal already has meaningful a11y work (focus styles, error boundary, multiple `aria-*` attributes).
- There are still structural gaps that can block keyboard and assistive-tech users in key flows.
- Highest-priority gaps are navigation bypass, interactive semantics, and form/status semantics.

## Findings (Prioritized)

### 1) Missing bypass block / skip link in app shell (High)
- Evidence:
  - `web/src/App.tsx:1359` app shell starts with sidebar/nav first; no skip link before nav.
  - `web/src/App.css` has no `.skip-link` styles.
- WCAG mapping:
  - 2.4.1 Bypass Blocks
- Impact:
  - Keyboard and screen-reader users must traverse full nav repeatedly to reach page content.

### 2) Non-semantic interactive containers and nested interactive controls (High)
- Evidence:
  - `web/src/App.tsx:1365` uses a `div` with `role="button"` + `tabIndex` for home navigation.
  - `web/src/views/KilnScheduleView.tsx:408` uses `div role="button"` row containing nested button (`Add to my calendar`).
- WCAG mapping:
  - 4.1.2 Name, Role, Value
  - 2.1.1 Keyboard
- Impact:
  - Inconsistent keyboard interaction and potential AT confusion; nested interactive patterns are fragile.

### 3) Form/search semantics and status announcements incomplete (High)
- Evidence:
  - `web/src/views/SupportView.tsx:277` search input relies on placeholder text and has no explicit label.
  - `web/src/views/SupportView.tsx:287` filter chips have visual active state but no `aria-pressed`.
  - `web/src/views/SignedOutView.tsx:214` sign-in status uses plain `div` without live region semantics.
- WCAG mapping:
  - 3.3.2 Labels or Instructions
  - 4.1.3 Status Messages
  - 1.3.1 Info and Relationships
- Impact:
  - Screen-reader users get weaker context for search/filter state and authentication feedback.

### 4) Collapsed nav discoverability relies on hover-only tooltips (Medium)
- Evidence:
  - `web/src/App.css:3011` hides nav labels when collapsed.
  - `web/src/App.css:3015` tooltip uses pseudo-content; shown on hover only.
  - `web/src/App.css:3032` tooltip visibility only on `:hover`.
- WCAG mapping:
  - 1.3.1 Info and Relationships
  - 2.1.1 Keyboard
- Impact:
  - Keyboard users in collapsed mode may not get equivalent visual label affordance as mouse users.

### 5) Some control targets are below 44x44 guidance (Medium)
- Evidence:
  - `web/src/App.css:3244` `.signout-icon` is `40x40`.
  - `web/src/App.css:683` `.btn-small` has `min-height: 30px`.
  - `web/src/App.css:752` `.chip` uses compact paddings and may fall below minimum target size.
- WCAG mapping:
  - 2.5.8 Target Size (Minimum) (WCAG 2.2)
- Impact:
  - Harder to activate controls for motor-impaired users and on small touch devices.

### 6) Button-type consistency debt across app shell/views (Low/Medium)
- Evidence:
  - Multiple buttons without explicit `type`, e.g. `web/src/App.tsx:1396`, `web/src/views/SignedOutView.tsx:111`, `web/src/views/SupportView.tsx:234`.
- WCAG mapping:
  - 3.2.4 Consistent Identification (indirect predictability risk)
- Impact:
  - Not always a bug today, but can cause accidental submit behavior when markup evolves.

## Assessment Method
- Static audit of key app shell and high-traffic views:
  - `App.tsx`, `App.css`, `SupportView.tsx`, `SignedOutView.tsx`, `KilnScheduleView.tsx`
- Pattern scan for interactive semantics and a11y attributes via `rg`.
- This pass is code-based; follow-up manual/AT pass is required for final conformance.

## Next Step
- Execute linked remediation tickets:
  - `tickets/P1-portal-a11y-baseline-and-policy.md`
  - `tickets/P1-portal-a11y-navigation-and-bypass-blocks.md`
  - `tickets/P1-portal-a11y-forms-and-status-semantics.md`
  - `tickets/P1-portal-a11y-interactive-semantics-and-nested-controls.md`
  - `tickets/P1-portal-a11y-target-size-and-operability.md`
  - `tickets/P2-portal-a11y-regression-guardrails.md`
