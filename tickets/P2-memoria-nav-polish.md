Status: Completed

# P2 - Memoria Nav Polish (Active Rail + Collapsed Tooltips)

## Problem
Memoria nav is close, but the “active” state and collapsed-nav ergonomics can be more intentional (Apple-like clarity, monochrome, calm).

## Tasks
- Tune Memoria active rail:
  - Ensure rail aligns visually with icon baseline.
  - Ensure it doesn’t overlap icons on narrow widths.
- Collapsed nav tooltips:
  - Use Memoria surfaces (`--surface-2`, `--border`) and text tokens.
  - Increase readability and spacing without adding animation.
- Icon rendering:
  - Verify SVG stroke widths read well on dark background for all nav icons.
- Add a Memoria-only subtle divider between primary sections (no gradients).

## Acceptance
- Active item is unambiguous in both expanded and collapsed nav.
- Tooltips are readable and feel “native” to Memoria.
- No additional motion beyond existing hover/press.

## Progress notes
- Updated Memoria active rail alignment in `web/src/App.css`:
  - adjusted active rail in expanded nav (`left/top/bottom`) for cleaner icon baseline alignment.
- Improved collapsed tooltip readability (Memoria only):
  - stronger surface contrast, border, shadow, spacing, and typography.
- Added Memoria-only subtle section divider between primary nav sections:
  - `.sidebar .nav-primary > .nav-section + .nav-section`
- Tuned nav icon rendering on dark surfaces:
  - Memoria SVG icon stroke width set to `1.9` for clearer legibility.
