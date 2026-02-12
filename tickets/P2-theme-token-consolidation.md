Status: Completed

# P2 - Consolidate Theme Tokens (Shadows, Focus, Motion)

## Problem
We started introducing cross-theme tokens (`--shadow-card*`, `--focus-ring`) but there are still hard-coded values in CSS. This makes theme iteration brittle.

## Tasks
- Scan `web/src/App.css` (and view CSS files) for hard-coded:
  - `rgba(...)` focus rings
  - card/dashboard shadows
  - Memoria-only border colors
- Replace with theme tokens where appropriate.
- Add any missing tokens to `web/src/theme/themes.ts` for both themes.
- Ensure tokens are optional-safe (CSS fallbacks) so older themes don’t break.

## Acceptance
- Default Portal theme remains visually unchanged.
- Memoria theme values are mostly driven by tokens, not hard-coded CSS.
- `npm --prefix web run lint` and `npm --prefix web run build` pass.

## Progress notes
- Added shared theme tokens in `web/src/theme/themes.ts`:
  - `--shadow-brand`
  - `--focus-ring-strong`
- Replaced hard-coded values in `web/src/App.css` with tokenized values + fallbacks:
  - brand image shadow (`.nav-brand img`, `.brand img`)
  - stronger focus ring for nav focus-visible states
- Extended tokenization for Memoria nav/button/dashboard styles:
  - active rail + glow
  - subdot/default-active colors
  - dashboard card border soft color
  - secondary/ghost/primary button borders + shadows
  - signed-out active toggle shadow
  - sidebar active border/shadow
  - hover border/background tokens
- Acceptance checks passed:
  - `npm --prefix web run lint`
  - `npm --prefix web run build`
