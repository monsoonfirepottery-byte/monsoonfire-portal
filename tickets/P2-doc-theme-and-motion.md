Status: Open (2026-02-10)

# P2 - Document Theme + Motion System (Portal)

## Problem
We now have multiple UI modes (Portal default + Memoria) and a motion setting. Without documentation, future changes risk regressions and “why does this look different” confusion.

## Tasks
- Add a short doc in `docs/` covering:
  - Theme names and persistence (localStorage + Firestore profile)
  - Motion setting persistence and heuristic default
  - DOM hooks (`data-portal-theme`, `data-portal-motion`)
  - How to add theme tokens safely
  - How to implement motion without continuous animations
- Link to the doc from `AGENTS.md` (briefly).

## Acceptance
- A new contributor can add a themed component without reading the entire CSS file.
- No secrets included.

