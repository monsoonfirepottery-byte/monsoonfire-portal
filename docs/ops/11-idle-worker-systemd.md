# Studio Brain Idle-Worker Systemd Timers

This note captures the repo-backed version of the idle-worker timers discovered on the Studio Brain host during the 2026-05-06 ops-doctor pass. It is documentation and source control only; installing or restarting host timers still requires explicit approval.

## Tracked Units

| Unit | Source file | Cadence | Purpose |
| --- | --- | --- | --- |
| `studio-brain-idle-worker.service` | `config/studiobrain/systemd/studio-brain-idle-worker.service` | triggered by timer | Runs the idle profile for `memory,repo,harness,wiki` jobs. |
| `studio-brain-idle-worker.service.d/10-readonly-depth.conf` | `config/studiobrain/systemd/studio-brain-idle-worker.service.d/10-readonly-depth.conf` | service drop-in | Keeps the daytime worker on standard read-only repo depth. |
| `studio-brain-idle-worker.service.d/20-clean-lane.conf` | `config/studiobrain/systemd/studio-brain-idle-worker.service.d/20-clean-lane.conf` | service drop-in | Points the timer at `/home/wuff/monsoonfire-portal-clean-host-rebuild`, matching the live host lane. |
| `studio-brain-idle-worker.timer` | `config/studiobrain/systemd/studio-brain-idle-worker.timer` | 15 minutes after boot, then 4 hours after service inactivity with up to 20 minutes random delay | Keeps bounded daytime/idle maintenance moving. |
| `studio-brain-idle-worker.timer.d/10-cadence.conf` | `config/studiobrain/systemd/studio-brain-idle-worker.timer.d/10-cadence.conf` | timer drop-in | Narrows live cadence to 2 hours after service inactivity with up to 10 minutes random delay. |
| `studio-brain-idle-worker-overnight.service` | `config/studiobrain/systemd/studio-brain-idle-worker-overnight.service` | triggered by timer | Runs the overnight profile for `memory,repo,harness,wiki` jobs with standard repo depth. |
| `studio-brain-idle-worker-overnight.service.d/20-clean-lane.conf` | `config/studiobrain/systemd/studio-brain-idle-worker-overnight.service.d/20-clean-lane.conf` | service drop-in | Points the overnight timer at `/home/wuff/monsoonfire-portal-clean-host-rebuild`, matching the verified clean host lane. |
| `studio-brain-idle-worker-overnight.timer` | `config/studiobrain/systemd/studio-brain-idle-worker-overnight.timer` | 02:30 UTC daily with up to 45 minutes random delay | Gives the worker a predictable low-traffic maintenance window. |
| `studio-brain-idle-worker.sh` | `config/studiobrain/systemd/studio-brain-idle-worker.sh` | wrapper script | Resolves Node, validates the repo root, and runs the existing idle-worker script as `wuff` when invoked by root. |

## Safety Mode

- The units are `oneshot` workers, not long-running daemons.
- Both service units use lower priority scheduling with `Nice` and best-effort I/O scheduling.
- The wrapper defaults to `/home/wuff/monsoonfire-portal`, while the tracked daytime and overnight clean-lane drop-ins set `STUDIO_BRAIN_REPO_ROOT=/home/wuff/monsoonfire-portal-clean-host-rebuild` for the scheduled workers.
- The wrapper does not contain secrets. It relies on the repo/runtime environment already available to `scripts/studiobrain-idle-worker.mjs`.
- The install script enables and restarts the timers, but does not explicitly start either idle-worker service. Because the timers are persistent, first-time installation should still be treated as a host change.
- Live reconciliation on 2026-05-06 showed both timers already active and the daytime timer using the three drop-ins now tracked here. No reinstall was needed in that pass.

## Reconcile Checklist

1. Confirm the current host timer state:
   - `systemctl list-timers 'studio-brain-idle-worker*' --all --no-pager`
   - `systemctl status studio-brain-idle-worker.timer studio-brain-idle-worker-overnight.timer --no-pager`
2. Confirm no idle-worker run is currently active:
   - `systemctl status studio-brain-idle-worker.service studio-brain-idle-worker-overnight.service --no-pager`
3. Review the latest worker artifact before changing timer definitions:
   - `node ./scripts/studiobrain-idle-worker-effectivity-audit.mjs --current-only --json`
4. During an approved window, run the repo-backed host install/reconcile path.
5. Verify timers:
   - `systemctl show -p ActiveState -p SubState -p UnitFileState -p NextElapseUSecRealtime studio-brain-idle-worker.timer`
   - `systemctl show -p ActiveState -p SubState -p UnitFileState -p NextElapseUSecRealtime studio-brain-idle-worker-overnight.timer`

## Rollback

- Restore the previous unit files from the host backup or prior Git revision.
- Run `systemctl daemon-reload`.
- Restart only the affected timers after approval.
- If a worker run misbehaves, inspect the service journal and latest idle-worker JSON artifact before disabling the timer.
