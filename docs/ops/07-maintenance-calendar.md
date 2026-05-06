# Studio Brain Maintenance Calendar

Use this as an operating rhythm. Treat risky actions as approval-gated.

## Daily Checks

- `curl -fsS http://192.168.1.226:8787/healthz`
- `curl -fsS http://192.168.1.226:8787/readyz`
- `npm run studio:ops:status`
- `systemctl --failed --no-pager`
- Confirm `studio-brain-healthcheck.timer`, `studio-brain-disk-alert.timer`, and `studio-brain-reboot-watch.timer` are active.
- Review backup freshness evidence.

## Weekly Checks

- Run `make ops-check` on the host or a comparable Ubuntu shell.
- Attach `make ops-backup-evidence` output to any backup/restore-confidence ticket before changing backup paths.
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
- Review host checkout drift against source control.
  - `make ops-host-drift`
  - keep a restricted backup branch/patch bundle before cleanup

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
