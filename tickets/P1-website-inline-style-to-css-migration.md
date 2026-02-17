# P1 — Website Inline Style to Class Migration

Status: Completed

## Problem
Inline `style=` attributes in website pages are blocking stricter CSP and make style governance difficult.

## Tasks
- Replace inline style usage in public website pages with class-based rules.
- Add route-level override class definitions where needed.
- Enforce CSP `style-src` without `unsafe-inline` for production-safe pages.

## Acceptance
- No remaining inline `style=` attributes in website public pages.
- New classes cover layout behavior for equivalent styling.
- CSP remains enforced with static stylesheet-driven styles.

## References
- `website/faq/index.html`
- `website/parking-page.shtml`
- `website/assets/css/styles.css`
- `website/assets/css/parking-overrides.css`
- `website/web.config`
