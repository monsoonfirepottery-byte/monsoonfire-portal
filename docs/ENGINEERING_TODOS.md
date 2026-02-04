# Engineering TODOs

Date: 2026-02-04
Owner: TBD
Status: Active

## Next up
- [ ] Investigate and remediate `npm audit` high severity vulnerability in `web/` dependencies.
  - Reported chain: `vite-plugin-pwa` -> `workbox-build` -> `glob` -> `minimatch` -> `@isaacs/brace-expansion`
  - `npm audit` currently reports no fix available. Track upstream updates.
- [ ] Replace the sample glaze matrix with the real CSV matrix data for `importGlazeMatrix`.

## Later
- [ ] Add a single-glaze tiles board (photos/notes per glaze, not just combos).

## Notes
- Vite + Vitest dev flow now uses `web/scripts/dev.mjs` (no `concurrently`).
