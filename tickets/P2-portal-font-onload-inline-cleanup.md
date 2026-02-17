# P2 — Portal Font Load Inline Event Cleanup

Status: Completed

Date: 2026-02-17

Problem
- `web/index.html` still used inline `onload` on the Google Fonts stylesheet link.

Scope
- `web/index.html`

Tasks
- Remove inline `onload` behavior.
- Replace with static stylesheet link strategy (`preload` + `stylesheet`) without inline handlers.
- Verify render timing/FOIT behavior remains acceptable for first paint.
- Keep analytics and CSP behavior consistent with existing policy.

Acceptance
- No inline event-handler attributes remain on stylesheet links in portal entry HTML.
- No regression in font rendering on first page load.
- CSP remains enforceable with strict `script-src` and no event-handler exceptions.

Completion Notes
- Completed in this branch: `web/index.html` now loads the Google Fonts stylesheet via `<link rel="preload" as="style">` plus `<link rel="stylesheet">`.
- No inline `onload` attribute remains.

References
- `web/index.html`
