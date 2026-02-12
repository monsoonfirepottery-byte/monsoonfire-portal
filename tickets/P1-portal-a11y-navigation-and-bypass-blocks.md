# P1 — Portal A11y: Navigation + Bypass Blocks

Status: Planned

## Problem
- App shell lacks a skip-link pattern and puts dense navigation before content.
- Collapsed nav labels are hidden and tooltips are hover-only.
- Mobile nav toggle state is not fully exposed.

## Goals
- Ensure keyboard and assistive-tech users can bypass navigation quickly.
- Ensure nav state and labels are available regardless of pointer hover.

## Scope
- `web/src/App.tsx`
- `web/src/App.css`

## Tasks
1. Add skip link:
   - first focusable element in shell
   - targets `main` content region and is visible on focus
2. Use semantic home control in sidebar:
   - replace `div role="button"` with `button` or `a`
3. Improve collapsed-nav accessibility:
   - preserve accessible names
   - show tooltip/label on keyboard focus (not hover-only)
4. Improve mobile menu semantics:
   - `aria-expanded`, `aria-controls`, and controlled region id
5. Validate landmarks:
   - clear `aside`, `nav`, `main` relationships per shell state

## Acceptance
- Keyboard users can skip to content in one action.
- Collapsed nav remains understandable with keyboard-only interaction.
- Mobile nav state is fully announced by AT.

## Evidence
- `web/src/App.tsx:1365`
- `web/src/App.tsx:1561`
- `web/src/App.css:3011`
- `web/src/App.css:3015`
- `web/src/App.css:3032`
