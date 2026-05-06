# Studio Brain Administrator Effectivity Audit

Snapshot time: 2026-05-06 18:37 UTC.

This packet audits the effect of the latest Studio Brain administrator slices after an overnight lull and the 2026-05-06 deploy/sync pass. All checks below are read-only except the already-approved deploy/sync actions noted as evidence.

## Executive Result

- Status: improved and operating.
- Studio Brain API: healthy and ready.
- Mission Control admin surface: deployed and reachable.
- Idle-worker effectivity: current run `pass`, history `pass`, complete score `97`.
- Harness-ticket coverage: `missing=0`, `open=1`, `closed=9`.
- Backup evidence: fresher and clearer, but still missing proven PostgreSQL/Redis/MinIO backup artifacts.
- Failed units: classifier now distinguishes one-shot success from true failed units.

## Deployed Or Synced Changes

| Area | Evidence | Result |
| --- | --- | --- |
| Mission Control admin wall | release `mission-control-20260506-admin-1faf72a` deployed to `/home/wuff/studio-brain-mission-control/app` | `/mission-control/admin` returned `200` |
| Mission Control health | `GET /api/mission-control/health` at 18:36 UTC | `ok=true`, `storage=postgres`, `serviceScope=systemd` |
| Ops support sync | `npm run studio:ops:sync` at 18:36 UTC | uploaded 58 support paths, including backup, Docker, Postgres, and failed-unit probes |
| Ops PR branch | PR #596, branch `codex/ops-admin-remediation-20260506` | latest commit `9eb7cc8c` pushed |

## Live Health And Pressure

| Check | Evidence | Result |
| --- | --- | --- |
| Studio Brain health | `curl http://192.168.1.226:8787/healthz` | `ok=true` |
| Studio Brain readiness | `curl http://192.168.1.226:8787/readyz` | Postgres connected, snapshot age 11 minutes |
| Mission Control ingest | health telemetry | 56 accepted requests, 343 accepted events, 0 empty payloads, 0 rate-limited requests, skip ratio 0 |
| Mission Control memory | `systemctl --user show studio-brain-mission-control.service` | active/running, `NRestarts=0`, `MemoryCurrent` about 492MB |
| Studio Brain API memory | `systemctl --user show studio-brain.service` | active/running, `NRestarts=0`, `MemoryCurrent` about 368MB |
| Host capacity | `df`, `free`, `uptime` | root 15%, inodes 2%, 26Gi available RAM, 321Mi swap used, load `0.94, 0.67, 0.59` |

## Idle-Worker Effectivity

Command:

```bash
node scripts/studiobrain-idle-worker-effectivity-audit.mjs \
  --run-root /home/wuff/monsoonfire-portal-clean-host-rebuild/output/studio-brain/idle-worker \
  --json
```

Result:

- Complete status: `warn`.
- Complete score: `97`.
- Current health: `pass`, score `100`.
- History health: `pass`, score `100`.
- Latest run: `idle-worker-2026-05-06T17-58-13-096Z`, `passed`, age 38 minutes.
- Runs audited: 20.
- Pass rate: 1.0.
- Failed runs: 0.
- Skipped runs: 0.
- Current actionable warnings: 0.
- Remaining warning: 21 human-gated wiki claims, which require owner approval rather than autonomous mutation.

Effectivity conclusion: the idle worker is no longer looping uselessly in this snapshot. It completed all planned jobs, recorded useful outcomes, and leaves only human-approval work in the queue.

## Mission Control Harness Effectivity

Command:

```bash
npm run mission:harness-learn -- --api-url http://127.0.0.1:14100
```

Result:

- Events sampled: 20,000.
- Failure events: 675.
- Proposal groups: 287.
- Proposals shown: 10.
- Missing tickets: 0.
- Open tickets: 1.
- Closed tickets: 9.

Effectivity conclusion: the harness now routes known failure patterns to existing tasks instead of repeatedly surfacing missing-ticket gaps. The remaining open ticket is `Stabilize exec_command tool-output failures: logs.1.error=ENOENT`.

## Backup Evidence Effectivity

Command:

```bash
bash scripts/ops/backup_evidence.sh
```

Result:

- Application backup manifest: `pass`, generated at `2026-05-06T18:10:46.755Z`, age 26 minutes.
- Root-owned backup metadata: present, schema `studio-brain-backup-metadata.v1`, generated at `2026-05-06T18:11:11.323579+00:00`.
- Config archive count listed: 20.
- PostgreSQL readiness and tools: `pg_isready`, `pg_dump`, and `pg_restore` available.
- PostgreSQL dump artifacts: missing directory.
- Redis backup artifacts: missing directory.
- MinIO backup artifacts: missing directory.
- Latest restore-drill summary: still old, from 2026-02-23.

Effectivity conclusion: the work improved backup observability and freshness checks, but restore confidence remains incomplete until real PostgreSQL/Redis/MinIO backup artifacts and a current restore drill are proven.

## Failed-Unit Effectivity

Command:

```bash
bash scripts/ops/ubuntu_failed_units.sh
```

Result:

- `apt-daily-upgrade.service`: `completed_oneshot_ok`, `Result=success`.
- `unattended-upgrades.service`: `running_ok`.
- `dailyaidecheck.service`: `failed_requires_triage`.
- `snap.canonical-livepatch.canonical-livepatchd.service`: `failed_requires_triage`.
- `systemd-networkd-wait-online.service`: `failed_requires_triage`.

Effectivity conclusion: the classifier prevents false alarms on successful one-shots while keeping the three true failed units visible and approval-gated.

## Remaining Approval Gates

- Prove PostgreSQL dump backup and restore drill against a disposable target.
- Prove Redis and MinIO backup artifacts or explicitly document why they are non-authoritative.
- Privileged read of Docker json-log sizes under `/var/lib/docker/containers`.
- Privileged review of AIDE, Livepatch, and network-online failed-unit journals.
- Any SSH, firewall, package, restart, prune, or data cleanup action.

## Next Safe Slices

1. Add a restore-prerequisite drill packet that proves PostgreSQL dump presence without restoring over production.
2. Add a Docker json-log privileged-read checklist and evidence slot to the incident bundle.
3. Add a Mission Control admin card for backup confidence gaps.
4. Add a failed-unit trend artifact so the classifier can distinguish old unchanged failures from new regressions.
5. Add a weekly effectivity report command that combines idle-worker audit, harness coverage, backup evidence, and host pressure into one Markdown packet.
