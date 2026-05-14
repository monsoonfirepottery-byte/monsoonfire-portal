# Studio Brain Maintenance Calendar

Use this as an operating rhythm. Treat risky actions as approval-gated.

## Daily Checks

- `curl -fsS http://192.168.1.226:8787/healthz`
- `curl -fsS http://192.168.1.226:8787/readyz`
- `make ops-app-review` when working from the host or through the local Mission Control tunnel.
- `npm run studio:doctor` from `/home/wuff/monsoonfire-portal` on the Studio Brain host.
- `npm run studio:ops:status` is the agent-compatible alias for the same doctor output.
- `systemctl --failed --no-pager`
- Confirm `studio-brain-healthcheck.timer`, `studio-brain-disk-alert.timer`, `studio-brain-reboot-watch.timer`, `studio-brain-idle-worker.timer`, and `studio-brain-idle-worker-overnight.timer` are active.
- Review backup freshness evidence.

## Weekly Checks

- Run `make ops-check` on the host or a comparable Ubuntu shell.
- Run `make ops-incident-bundle` before any non-trivial incident cleanup or service restart, then review the generated bundle before sharing it.
- Attach `make ops-backup-evidence` output to any backup/restore-confidence ticket before changing backup paths.
- Run `make ops-portal-bridge-review` and compare the tunnel restart count against the prior snapshot.
- Run `make ops-import-pressure` and compare `/home/wuff/imports` size, age buckets, and approval-only candidates against the prior snapshot.
- Run `make ops-cleanup-candidates` and attach the read-only candidate packet before any prune, deletion, truncation, or import/archive cleanup discussion.
- Run PostgreSQL size report:
  - `make ops-postgres-review`
- Review Docker:
  - `docker ps`
  - `docker system df`
  - `docker volume ls`
- Review failed units and apt state:
  - `make ops-ubuntu-review`
  - `apt list --upgradable`
  - `journalctl -u apt-daily-upgrade.service -n 100 --no-pager`
- Review `/home/wuff/imports`, repo artifact growth, Docker growth, and `/var/log`.

## Monthly Checks

- Run a restore drill against a disposable target.
- Review pg_stat_statements with redaction.
- Review Docker image pins and available updates.
- Review SSH/fail2ban status.
- Review open ports and firewall posture.
  - `make ops-network-review`
- Classify anonymous Docker volumes.
- Review cleanup candidate classifications and close any stale approval-only cleanup proposals that lack backup or rollback evidence.
- Review host checkout drift against source control.
  - `make ops-host-drift`
  - keep a restricted backup branch/patch bundle before cleanup
- Review idle-worker cadence, latest artifact, and warning/failure trend.
  - `node ./scripts/studiobrain-idle-worker-effectivity-audit.mjs --current-only --json`

## Quarterly Checks

- Validate backup retention against storage and restore objectives.
- Test full app rollback from a known-good artifact.
- Review OS release lifecycle for Ubuntu 25.10.
- Review package sources, pinned packages, and deprecated packages.
- Review access list for SSH, sudo, Docker group, and operational secrets.
- Review capacity trend and update 30/60/90 day forecast.

## Upgrade Windows

Recommended cadence:

- Security updates: weekly review, apply in an approved window.
- Kernel/Docker/systemd updates: approved maintenance window with pre/post health checks.
- PostgreSQL major upgrades: separate project with dump/restore drill and rollback host.
- Docker image updates: one service group per PR or approved maintenance change.

Pre-checks:

- health/readiness/dependencies pass
- backup evidence current
- Docker and systemd inventory captured
- rollback artifact identified

Post-checks:

- health/readiness/dependencies pass
- Mission Control reachable
- key scheduled timers active
- failed-unit list reviewed
- backup evidence still valid

## Backup Restore Drill Schedule

- Monthly: restore-prerequisite drill.
- Quarterly: full PostgreSQL restore into disposable target.
- After schema migrations: targeted restore/check drill.
- After backup tooling changes: immediate restore drill.

## Log Retention Review

- Weekly: `journalctl --disk-usage`, `/var/log`, Docker json log sizes.
- Monthly: confirm logrotate status and Docker log driver limits.
- Emergency threshold: logs above 10% of root filesystem.

## Dependency Review

- Weekly: `apt list --upgradable`.
- Monthly: Docker image updates and Node/npm package posture.
- Quarterly: base OS release lifecycle, Docker Engine support, PostgreSQL minor updates.

## Database Maintenance Review

- Weekly: table/index size, dead tuples, active sessions, locks.
- Monthly: pg_stat_statements and slow-query candidates.
- Quarterly: backup restore duration, autovacuum posture, index usage, and bloat estimates.
