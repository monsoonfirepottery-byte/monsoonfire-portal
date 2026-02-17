# P0: Local Dashboard for StudioState + Diffs

## Goal
Expose a local dashboard surface for latest StudioState and recent audit events/diffs.

## Non-goals
- No new public/member portal route changes.
- No decision execution controls in P0.

## Acceptance Criteria
- Local HTTP server serves `/dashboard`, `/api/studio-state/latest`, `/healthz`.
- Dashboard shows snapshot timestamp, core counts, and recent audit entries.
- Works when no snapshot exists (clear empty state).
- Does not affect existing portal routing/behavior.

## Files/Dirs
- `studio-brain/src/http/server.ts`
- `studio-brain/src/http/dashboard.ts`
- `studio-brain/src/index.ts`

## Tests
- Rendering logic test for empty + populated dashboard state.
- Endpoint smoke check (optional in P0; mandatory in P1).

## Security Notes
- Local-only surface.
- Read-only output.
- No secrets displayed.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`
- `P0-v3-studio-state-readonly-computation.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- HTTP access logs include route + status only.
- Snapshot retrieval misses logged as non-fatal informational events.

## Rollback
- Stop local server process.
- Remove local endpoint exposure with no cloud impact.
