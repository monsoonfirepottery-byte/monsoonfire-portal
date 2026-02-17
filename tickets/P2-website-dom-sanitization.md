# P2 — Website DOM Sink Sanitization

Status: Completed
Date: 2026-02-17

## Problem
Several marketing pages render JSON payload fields via `innerHTML`/string concatenation, including values that can be set by data files (`/data/*.json` and FAQ/policy content). This is a DOM XSS risk if those data sources are ever modified externally.

## Scope
- `website/assets/js/faq.js`
- `website/assets/js/kiln-status.js`
- `website/assets/js/highlights.js`
- `website/parking-page.shtml` (inline click handlers / javascript links)

## Tasks
- Replace string-format `innerHTML` rendering for text fields with `textContent` or `createElement` flows where possible.
- Introduce safe DOM escaping for any intentionally rich HTML content.
- Remove/replace inline event-handler patterns in static pages (`onclick`, `javascript:` URLs) with delegated listeners.
- Ensure any remaining HTML formatting is created from trusted templates or explicit whitelist sanitization.
- Add a short regression test or CSP audit checklist verifying no high-risk inline-script sinks remain in marketing assets.

## Acceptance
- Sensitive DOM injection sinks are eliminated or explicitly sanitized.
- No functionality regression for FAQ/policy/timeline rendering.
- Security checklist marks static JSON rendering as safe-by-default.
- This ticket is complete: static grep plus `rg` checks found no remaining high-risk sink patterns in `website` (no inline `style=`, `innerHTML` insertion, `onclick`, `javascript:` URLs).

## References
- `website/assets/js/faq.js`
- `website/assets/js/kiln-status.js`
- `website/assets/js/highlights.js`
- `website/parking-page.shtml`
