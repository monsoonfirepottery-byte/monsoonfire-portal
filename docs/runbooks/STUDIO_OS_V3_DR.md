# Studio OS V3 DR, Recovery, and Rebuild Playbook

## Purpose
Provide deterministic steps to restore local Studio Brain state from cloud truth and keep staff operations safe when local services degrade.

## Scenarios Covered
1. Local Studio Brain outage (process down, API unreachable).
2. Postgres corruption / empty state store.
3. Connector outage (cloud reads degraded, snapshots stale).

## Preconditions
- Firebase Admin + Stripe read access configured.
- Postgres reachable (`PG*` env vars set).
- `STUDIO_BRAIN_ADMIN_TOKEN` set for rebuild authorization.
- Staff member with Firebase staff claim for audit logging.

## Immediate Response Checklist
- Confirm Staff Console degraded/local-offline banner.
- Pause any write-capable workflows.
- Capture timestamps and incident notes.

## Scenario A: Local Studio Brain Outage
1. Verify status:
   - `GET /healthz` and `GET /readyz` (local).
2. Restart Studio Brain process.
3. Recheck readiness.
4. If still degraded, proceed to rebuild (Scenario B).

## Scenario B: Postgres Corruption or Empty State
1. Validate Postgres connectivity (pgcheck or logs).
2. Run rebuild command (rehydrate snapshot from cloud truth):
   ```bash
   npm --prefix studio-brain run rebuild -- --actorId=<staff-uid> --confirm=true --adminToken=<STUDIO_BRAIN_ADMIN_TOKEN>
   ```
   Optional flags:
   - `--projectId=<firebase-project-id>`
   - `--scanLimit=2000`
   - `--correlationId=<uuid>`
3. Verify:
   - `/readyz` returns 200.
   - Staff Console Studio Brain status shows `ok`.
4. Record rebuild in audit timeline (automatic events).

## Scenario C: Connector Outage / Stale Snapshot
1. Check `/readyz` response for snapshot age and connector health.
2. Confirm external service status (Stripe, Firestore).
3. If cloud truth is reachable, run rebuild.
4. If external outage persists, keep staff in degraded mode, avoid decisioning on drafts.

## Degraded Mode Guidance
- Staff console will flag `degraded` or `offline` and log entry/exit events.
- Pause action proposals and publish steps while degraded.

## Validation Steps
- `GET /readyz` returns `ok: true`.
- Studio Brain audit timeline shows:
  - `studio_ops.rebuild_started`
  - `studio_ops.rebuild_completed`
- Staff console warning clears.

## Tabletop Exercise Log
| Date | Scenario | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-02-13 | Local brain outage + rebuild | Completed | Verified degraded banner + rebuild command path. |
