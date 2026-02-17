Status: Completed

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

## Progress notes
- Existing theme/motion contributor documentation already covers this scope:
  - `docs/PORTAL_THEME_AND_MOTION.md`
  - Includes theme names, persistence precedence, DOM hooks, token guidance, and motion implementation constraints.
- AGENTS guide links the doc for contributor discovery:
  - `AGENTS.md` → Theme + Motion section references `docs/PORTAL_THEME_AND_MOTION.md`.
