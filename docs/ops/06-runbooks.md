# Studio Brain Operations Runbooks

These runbooks are written for cautious operation. Prefer read-only diagnostics first. Do not restart services, prune Docker resources, rotate secrets, modify firewall/SSH, or run package upgrades without explicit approval.

## Restart App Safely

1. Capture current state:
   - `npm run studio:ops:status`
   - `curl -fsS http://192.168.1.226:8787/healthz`
   - `curl -fsS http://192.168.1.226:8787/readyz`
2. Check current user service:
   - `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status studio-brain.service`
3. Confirm there is an approved service window.
4. Restart:
   - `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart studio-brain.service`
5. Verify:
   - `/healthz`, `/readyz`, and `/health/dependencies`
   - `/api/status` scheduler and latest job status
6. Rollback:
   - If restart fails after a deploy, redeploy the last known-good artifact or restore the previous service command from systemd history.

## Restart Docker Stack Safely

1. Capture inventory:
   - `docker compose -f studio-brain/docker-compose.yml ps`
   - `docker system df`
   - `docker volume ls`
2. Confirm backup evidence for Postgres and MinIO.
3. Restart only the affected service when possible:
   - `docker compose -f studio-brain/docker-compose.yml restart <service>`
4. Avoid `down -v`.
5. Verify container health and app dependencies.
6. Rollback:
   - Restore prior Compose file and restart the affected service.

## PostgreSQL Backup

1. Confirm live database and size:
   - `docker exec -u postgres studiobrain_postgres psql -d monsoonfire_studio_os -c "select pg_size_pretty(pg_database_size(current_database()));"`
2. Capture unified evidence before changing anything:
   - `make ops-backup-evidence`
   - or `bash scripts/ops/backup_evidence.sh`
3. Use the tracked backup tooling when available:
   - `npm run backup:verify`
4. For a manual approved dump, write outside the repo and restrict permissions:
   - `install -d -m 700 /var/backups/studio-brain/postgres`
   - `docker exec -u postgres studiobrain_postgres pg_dump -Fc monsoonfire_studio_os > /var/backups/studio-brain/postgres/<stamp>.dump`
   - `chmod 600 /var/backups/studio-brain/postgres/<stamp>.dump`
5. Record checksum and manifest.
6. Rerun `make ops-backup-evidence` and confirm the report separates config archives, PostgreSQL dump evidence, Redis evidence, MinIO evidence, freshness, and restore-drill status.
7. Never paste credentials or dump contents into chat or tickets.

## PostgreSQL Restore Drill

1. Capture restore-prerequisite evidence:
   - `make ops-backup-evidence`
2. Use a disposable target database/container.
3. Do not restore over production.
4. Verify dump metadata:
   - `pg_restore --list <dump>`
5. Restore into disposable target.
6. Run smoke queries:
   - database size
   - table count
   - key relation row counts
   - app migration table status
7. Record restore duration and result.
8. Rerun `make ops-backup-evidence` so the latest restore-drill summary is visible in the unified report.
9. Rollback:
   - Drop only the disposable target after approval.

## Disk Pressure Emergency Response

1. Identify pressure:
   - `df -hT`
   - `df -ih`
   - `sudo du -xhd1 /home/wuff /var/lib/docker /var/log | sort -h`
2. Safe first actions:
   - rotate or compress known logs if logrotate is broken
   - clear clearly temporary files under approved temp paths
3. Approval-required actions:
   - remove Docker volumes
   - prune Docker system
   - delete backups
   - delete imports
4. Verify app health after cleanup.

## Container Unhealthy Response

1. Inspect without restarting:
   - `docker ps`
   - `docker inspect <container> --format '{{json .State.Health}}'`
   - `docker logs --tail 100 <container>`
2. Check dependent app endpoint.
3. Identify whether the issue is healthcheck-only or service-impacting.
4. Restart only with approval when production impact is possible.
5. Rollback:
   - restore prior Compose/image if a recent deploy caused the issue.

## Network Exposure Review And Hardening

1. Capture the read-only report:
   - `make ops-network-review`
   - or `bash scripts/ops/network_exposure_review.sh`
2. Capture privileged read-only firewall and SSH facts before changing anything:
   - `sudo ufw status numbered verbose`
   - `sudo nft list ruleset`
   - `sudo sshd -T`
   - `sudo fail2ban-client status sshd`
3. Identify every legitimate PostgreSQL client before changing Docker port binds, firewall rules, or `pg_hba.conf`.
4. Verify a second SSH session, a second key, or console access before SSH hardening.
5. Do not reload SSH, restart Docker containers, edit firewall rules, or change PostgreSQL config without approval.
6. Rollback:
   - restore prior Compose port mapping, SSH config, firewall rule, or PostgreSQL config
   - keep the original admin session open until post-checks pass
   - rerun `make ops-network-review` and app health checks after rollback

## Live Host Checkout Drift Review

1. Capture the read-only drift report:
   - `make ops-host-drift`
   - or `TARGET_REPO=/home/wuff/monsoonfire-portal bash scripts/ops/host_drift_inventory.sh`
2. Do not run `git reset`, `git clean`, `git checkout`, or `git stash` on the live host without approval.
3. Create a backup branch or patch bundle before cleanup:
   - `git -C /home/wuff/monsoonfire-portal branch backup/live-drift-<date>`
   - `git -C /home/wuff/monsoonfire-portal diff > /restricted/path/live-drift-<date>.patch`
4. Classify paths as generated artifact, source/config/docs, sensitive path name, or unknown.
5. Review source/config diffs locally; do not paste secret values into tickets.
6. Rollback:
   - restore the backup branch or patch bundle
   - rerun `make ops-host-drift`
   - verify Studio Brain health after any approved cleanup

## Idle-Worker Timer Reconcile

1. Review the tracked timer notes:
   - `docs/ops/11-idle-worker-systemd.md`
2. Confirm current host state before changing anything:
   - `systemctl list-timers 'studio-brain-idle-worker*' --all --no-pager`
   - `systemctl status studio-brain-idle-worker.timer studio-brain-idle-worker-overnight.timer --no-pager`
3. Confirm no worker service is already running.
4. During an approved maintenance window, run the repo-backed install/reconcile path.
5. Verify the timers are active and note the next scheduled run.
6. Rollback:
   - restore the previous unit files from Git or host backup
   - run `systemctl daemon-reload`
   - restart only the affected timers after approval

## High Memory / OOM Response

1. Capture evidence:
   - `free -h`
   - `swapon --show`
   - `journalctl -k --since "24 hours ago" | grep -Ei "oom|killed process"`
   - `ps aux --sort=-rss | head`
2. Identify the victim and trigger.
3. For apt OOM, do not rerun unattended upgrades blindly; inspect apt logs first.
4. Consider service-level memory trends before adding caps.
5. Rollback:
   - Remove experimental caps or scheduler changes if they cause service instability.

## Apt OOM And Failed Unit Triage

1. Capture the read-only triage report:
   - `make ops-ubuntu-review`
   - or `bash scripts/ops/ubuntu_failed_units.sh`
2. For `apt-daily-upgrade.service`, confirm whether the OOM happened during unattended upgrades and attach:
   - kernel OOM lines
   - apt/unattended-upgrades logs
   - pending package list
   - reboot-required state
3. For each failed unit, write one disposition:
   - repair
   - disable intentionally with reason
   - ignore as harmless with reason
4. Do not reset failed units merely to make the dashboard green; keep the failure until the cause is understood or documented.
5. Do not run upgrades, disable AIDE/livepatch, or change network-online behavior without approval.
6. Use the maintenance-window checklist from `scripts/ops/ubuntu_failed_units.sh` before package changes.

## Slow App Response Triage

1. Check app endpoints:
   - `/healthz`
   - `/readyz`
   - `/health/dependencies`
   - `/api/status`
2. Check Postgres activity:
   - `scripts/ops/postgres_readonly_review.sql`
3. Check CPU/memory:
   - `top`, `free -h`, service memory from `systemctl show`.
4. Check Docker health.
5. Escalate only after identifying whether the bottleneck is app, database, storage, or network.

## Failed Migration Response

1. Do not rerun migrations blindly.
2. Capture:
   - migration command
   - error text
   - current migration table
   - DB backup evidence
3. Determine if failure happened before or after a transaction boundary.
4. Prepare rollback SQL only in a PR or approved incident note.
5. Verify with tests and restore drill before production fix.

## Rollback Procedure

1. Stop making changes.
2. Capture current evidence and error messages.
3. Identify last known-good commit/artifact/service config.
4. Restore the smallest affected surface:
   - app service config
   - Compose file
   - image tag
   - code artifact
   - database migration
5. Verify health, dependencies, and user-visible path.
6. Write a handoff with what changed, what was restored, and what remains unknown.
