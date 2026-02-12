Status: Open (2026-02-10)

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

