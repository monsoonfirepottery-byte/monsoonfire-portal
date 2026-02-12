Status: Completed

# P1 - A11y for nav toggles and chip controls

- Repo: portal
- Area: A11y
- Evidence: `web/src/App.tsx`, `web/src/views/ReservationsView.tsx` custom controls without explicit ARIA.
- Recommendation: add `aria-expanded`, `aria-controls`, and focus styles.
- Effort: M
- Risk: Low
- What to test: keyboard-only navigation across nav + estimator.
