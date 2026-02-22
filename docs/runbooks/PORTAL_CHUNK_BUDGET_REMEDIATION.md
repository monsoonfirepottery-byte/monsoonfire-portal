# Portal Chunk Budget Remediation Playbook

## Purpose
Use this runbook when `npm --prefix web run perf:chunks` fails locally or in CI.

## Fast Triage
1. Run:
   - `npm --prefix web run build`
   - `npm --prefix web run perf:chunks`
2. Capture failing chunk names and sizes from console output.
3. Confirm whether failure is:
   - oversized budgeted bundle
   - missing required route chunk (route became eagerly loaded)
   - aggregate JS/CSS growth

## Fix Patterns
1. If a route chunk is missing:
   - verify route remains lazy-loaded via `React.lazy(...)` in `web/src/App.tsx`
   - move route-only imports out of the app shell
2. If a route chunk is oversized:
   - split heavy route-only features with dynamic imports
   - move shared utilities to smaller modules consumed only where needed
   - avoid broad barrel imports from large feature trees
3. If vendor chunk is oversized:
   - verify `web/vite.config.js` manual chunk assignments are still effective
   - remove accidental eager imports of heavy firebase/analytics surfaces

## Verification
1. Re-run:
   - `npm --prefix web run build`
   - `npm --prefix web run perf:chunks`
   - `npm --prefix web run test:run`
2. Confirm route transitions still work for:
   - dashboard
   - reservations
   - kiln launch
   - kiln schedule
   - messages

## CI Reference
- `.github/workflows/ci-smoke.yml` (`Web chunk budgets` step)
