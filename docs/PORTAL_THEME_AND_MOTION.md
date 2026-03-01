# Portal Theme + Motion

## Theme Names

Portal currently supports:
- `portal` (default): Monsoon Fire current graphics (light)
- `mono`: high-contrast black/white (light, minimal styling)
- `memoria`: monochrome dark "Memoria design system"

## Where Theme Is Stored

Precedence (highest first):
1. Firestore (signed-in): `profiles/{uid}.uiTheme`
2. Local storage: `localStorage["mf:portalTheme"]`
3. Default: `portal`

Notes:
- Theme changes apply instantly and are persisted to both local storage and the user profile.
- Firestore rules must allow `uiTheme` on `/profiles/{uid}`.

## Motion Modes

Two modes:
- `enhanced`: event-driven reveals + desktop-only hover/press motion
- `reduced`: no reveal animations or transitions (also used when OS reduced-motion is enabled)

## Where Motion Is Stored

Precedence (highest first):
1. OS setting: `prefers-reduced-motion: reduce` forces `reduced`
2. Firestore (signed-in): `profiles/{uid}.uiEnhancedMotion` (boolean)
3. Local storage: `localStorage["mf:enhancedMotion"]` (`"1"` or `"0"`)
4. Heuristic default (first run only):
   - Defaults OFF on likely-mobile and low-power signals (narrow viewport, Save-Data, low cores/memory).

## DOM Hooks

`App.tsx` writes:
- `html[data-portal-theme="portal|mono|memoria"]`
- `html[data-portal-motion="enhanced|reduced"]`
- `html.style.colorScheme = "light" | "dark"`

CSS can key off these attributes to scope theme and motion overrides without JS conditionals.

## Motion Guidelines (Non-Negotiables)

- No continuous/looping animations for Memoria.
- Prefer event-driven transitions:
  - reveal on viewport enter (IntersectionObserver)
  - short hover/press motion on desktop only
- Always respect:
  - OS reduced-motion
  - user toggle (Enhanced motion)

## Using `RevealCard`

`RevealCard` should wrap top-level sections/cards, not repeated list items.

Good:
- wrap 2-10 major cards in a view

Avoid:
- wrapping every row in long lists (too many observers)
