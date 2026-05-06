# Studio Brain Risk Register

Snapshot time: 2026-05-06 00:16-00:20 UTC. Findings are separated from fixes. No destructive action was taken.

## Critical

No immediate critical data-loss or outage condition was observed in the read-only pass. The high findings below are still worth treating as near-term operational work because several affect backup confidence, patching, and network exposure.

## High

### Backup Evidence Is Split And Restore Confidence Is Incomplete

- Affected component: backups, restore posture, PostgreSQL/Redis/MinIO data.
- Evidence: `studio-brain-backup.timer` runs daily and root-owned config archives exist through 2026-05-05 under `/var/backups/studio-brain/daily`, but `/home/wuff/monsoonfire-portal/output/backups/latest.json` still points to 2026-04-28. The tracked system backup script archives host and Studio Brain config, not an obvious PostgreSQL dump, Redis snapshot, or MinIO object backup.
- Likely impact: operators may believe full service backups are fresh while only config-level archives are demonstrably current; restore time and data-loss exposure are unknown.
- Recommended action: unify backup evidence into one current manifest that distinguishes config archive, PostgreSQL dump, Redis state, MinIO data, and restore-drill status.
- Safe next step: add a read-only backup evidence script and run a non-destructive restore-prerequisite drill.
- Rollback/undo notes: documentation/script additions can be reverted; do not delete existing backups.
- PR can address it: yes, for documentation and read-only verification scripts. Full backup changes require approval.

### Live Host Checkout Is On A Gone Branch With 512 Dirty Or Untracked Paths

- Affected component: deployment source of truth and drift control.
- Evidence: `make ops-host-drift` on 2026-05-06 reports `/home/wuff/monsoonfire-portal` on `codex/next-fix-20260312...origin/codex/next-fix-20260312 [gone]` with 512 dirty or untracked paths: 211 modified tracked paths and 301 untracked paths. Path-name classification found 486 source/config paths, 10 sensitive-looking path names, and 16 unknown paths.
- Likely impact: deploys and reconciliations may package host-only drift, hide unreviewed runtime changes, or make rollback hard to reason about.
- Recommended action: inventory dirty host changes, classify them as accepted source changes, generated artifacts, or discardable runtime drift, then reconcile through PRs.
- Safe next step: create a host backup branch and restricted patch bundle, then compare the manifest against `host-drift-allowlist.json`.
- Rollback/undo notes: do not reset the host checkout until the diff manifest is reviewed and backed up.
- PR can address it: yes, for the audit/reporting tool. Cleanup requires human approval.

### PostgreSQL Is Bound To All Interfaces While Firewall Rule Coverage Is Unverified

- Affected component: PostgreSQL network exposure.
- Evidence: `make ops-network-review` on 2026-05-06 shows `0.0.0.0:5433` and `[::]:5433` listening via Docker, PostgreSQL `listen_addresses='*'`, and `pg_hba_file_rules` allowing `host all all all scram-sha-256`. `systemctl` reports `ufw` enabled and active, but non-root `ufw status`, `nft`, and `iptables` rules required a privileged read. Compose default is `"${PGPORT:-5433}:5432"`.
- Likely impact: the database is reachable from more than localhost. If credentials or LAN trust assumptions are weak, this increases blast radius.
- Recommended action: confirm all legitimate clients and privileged firewall rules, then bind Postgres to `127.0.0.1:5433` or add an explicit host firewall allowlist.
- Safe next step: run `make ops-network-review`, capture `sudo ufw status numbered verbose`, and identify every direct PostgreSQL client before hardening.
- Rollback/undo notes: changing bind address is reversible but can break remote clients; requires service window and approval.
- PR can address it: yes, detection and documentation. Actual bind/firewall change needs human approval.

### Unattended Upgrade Failed Due OOM While Security Updates Are Pending

- Affected component: Ubuntu patching and package hygiene.
- Evidence: `apt-daily-upgrade.service` failed with `Result=oom-kill`; kernel log shows `unattended-upgr` killed after about 29GB RSS. Pending upgrades include kernel, Docker, curl, systemd, nodejs, snapd, and containerd.
- Likely impact: security updates may not apply reliably; unattended upgrade can create memory pressure or fail silently between admin reviews.
- Recommended action: inspect apt logs, determine why unattended upgrade consumed excessive memory, then run updates in a supervised maintenance window.
- Safe next step: capture apt/unattended-upgrades logs and create a maintenance checklist.
- Rollback/undo notes: package upgrades need normal apt rollback planning; do not upgrade automatically from this PR.
- PR can address it: yes, runbook and diagnostic script. Host update execution needs approval.

## Medium

### SSH Password And Keyboard-Interactive Auth Are Enabled

- Affected component: SSH access posture.
- Evidence: SSH listens on `0.0.0.0:22` and `[::]:22`. Readable config fragments include `PasswordAuthentication yes`, `KbdInteractiveAuthentication yes`, `AuthenticationMethods any`, and `UsePAM yes`; the 2026-05-06 non-root run could not obtain effective `sshd -T` output. `fail2ban` is active, but jail details required a privileged read.
- Likely impact: password auth increases remote brute-force exposure, especially with `ssh` listening on all interfaces.
- Recommended action: confirm any legitimate password-based access, then plan key-only SSH with fail2ban retained.
- Safe next step: run `make ops-network-review`, capture privileged effective SSH config with `sudo sshd -T`, verify at least two key-based access paths, and then prepare a key-only SSH migration checklist.
- Rollback/undo notes: keep an out-of-band console or verified second key before changing SSH auth.
- PR can address it: documentation only; host SSH changes require approval.

### Live Idle-Worker Timers Are Host-Only Drift

- Affected component: systemd timer source of truth.
- Evidence: host has `studio-brain-idle-worker.timer` and `studio-brain-idle-worker-overnight.timer`; PRs through #577 now track matching unit, drop-in, and wrapper files under `config/studiobrain/systemd`. `scripts/ops/systemd_drift_review.sh --ssh-host studiobrain` reported 23 tracked files matched, 0 drift, 0 missing, 0 unreadable, 2 generated remote candidates, and 0 untracked remote candidates.
- Likely impact: reinstall or reconcile paths may drop or fail to recreate important scheduled work.
- Recommended action: keep the systemd drift review in weekly checks, then run the install/reconcile path only in an approved host maintenance window if host files drift again.
- Safe next step: confirm timer state with `systemctl list-timers 'studio-brain-idle-worker*' --all --no-pager` during the next host review.
- Rollback/undo notes: source-controlled units can be reverted; do not remove live timers until replacement is verified.
- PR can address it: yes.

### Portal Bridge Tunnel Has High Restart History

- Affected component: Studio Brain portal bridge, reverse SSH tunnel, admin reachability.
- Evidence: `scripts/ops/portal_bridge_review.sh --ssh-host studiobrain` on 2026-05-06 showed `studio-brain-control-tower-proxy.service` active with `NRestarts=0`, and `studio-brain-namecheap-tunnel.service` active with `NRestarts=354`. The proxy was listening on `127.0.0.1:18788`.
- Likely impact: the bridge can appear healthy at a point in time while historical restart churn hides transient tunnel instability, remote port conflicts, network interruption, SSH keepalive issues, or key permission problems.
- Recommended action: keep the portal bridge review in weekly checks and inspect journal/remote endpoint evidence if the restart counter continues increasing.
- Safe next step: run `make ops-portal-bridge-review` or `bash scripts/ops/portal_bridge_review.sh --ssh-host studiobrain` and compare the tunnel restart count to the prior snapshot before considering any service action.
- Rollback/undo notes: documentation/script changes can be reverted; do not restart or rekey the tunnel just to reset counters.
- PR can address it: yes, for monitoring/reporting and runbook coverage. Tunnel endpoint, key, or service changes require approval.

### Several System Units Are Failed

- Affected component: base OS hygiene.
- Evidence: failed units include `dailyaidecheck.service`, `snap.canonical-livepatch.canonical-livepatchd.service`, and `systemd-networkd-wait-online.service`.
- Likely impact: integrity scanning, livepatch reporting, and network-online semantics may be unreliable or noisy.
- Recommended action: inspect each unit's journal and decide whether to repair, disable intentionally, or document as irrelevant.
- Safe next step: add failed-unit triage to maintenance runbook.
- Rollback/undo notes: unit resets are reversible; do not disable security/integrity services without approval.
- PR can address it: documentation and diagnostics only.

### Docker Images Use Floating Tags

- Affected component: Docker update predictability.
- Evidence: tracked Compose uses `minio/minio:latest` and `otel/opentelemetry-collector-contrib:latest`; running stack includes `searxng/searxng:latest`, `netdata/netdata:stable`, and `louislam/uptime-kuma:1`.
- Likely impact: future pulls may change behavior without a clear review point.
- Recommended action: pin operationally sensitive images by version or digest after checking update cadence.
- Safe next step: create a ticket to pin and document image update policy.
- Rollback/undo notes: image pinning is reversible through Compose; roll back by restoring prior image tags.
- PR can address it: yes.

### Healthcheck Coverage Is Incomplete

- Affected component: Docker and monitoring reliability.
- Evidence: `monitoring-proxy`, `studiobrain_otel_collector`, `searxng-searxng-1`, and `searxng-redis-1` have no Docker healthcheck.
- Likely impact: Docker can report containers as `Up` even when the service is unresponsive.
- Recommended action: add obvious read-only healthchecks where commands are stable.
- Safe next step: add healthcheck coverage for monitoring proxy and SearXNG in a small PR.
- Rollback/undo notes: remove healthcheck stanzas if they flap; no data rollback needed.
- PR can address it: yes.

### PostgreSQL Memory Tables And Indexes Dominate Storage

- Affected component: PostgreSQL capacity and query performance.
- Evidence: `monsoonfire_studio_os` is about 8.3GB. Largest relations are `public.swarm_memory` 3.1GB, `public.memory_relation_edge` 2.3GB, `public.memory_pattern_index` 1.3GB, and `public.memory_entity_index` 1.0GB. Largest indexes include several 240MB-590MB memory lookup indexes.
- Likely impact: growth in memory tables can dominate backup time, query plans, and cache pressure.
- Recommended action: add growth trend reporting and pg_stat_statements review before changing indexes.
- Safe next step: commit read-only DBA SQL and schedule weekly size snapshots.
- Rollback/undo notes: read-only reporting is reversible; index changes require PR, tests, and rollback SQL.
- PR can address it: yes, diagnostics only.

## Low

### Docker Cleanup Candidates Exist But Are Not Urgent

- Affected component: Docker storage.
- Evidence: Docker reports 8 local volumes but only 5 active; build cache has 300.3MB reclaimable. No exited containers or dangling images were observed.
- Likely impact: small storage waste today; can grow if left unmanaged.
- Recommended action: document volume ownership before pruning anything.
- Safe next step: run `docker volume inspect` and map anonymous volumes to prior Compose projects.
- Rollback/undo notes: volume deletion is not safely reversible unless backed up.
- PR can address it: documentation only.

### Overseer Status Is Critical Despite Healthy Runtime Checks

- Affected component: application operations/Control Tower signal quality.
- Evidence: `/api/status` reports `overseer.overallStatus=critical`, 6 signal gaps, 8 actions, and 0 created proposals while health/readiness pass.
- Likely impact: human-facing ops state may stay noisy even when the app is technically healthy.
- Recommended action: turn overseer gaps into explicit backlog tasks and decide which are stale.
- Safe next step: add an ops-doctor check that reports app status beyond `/healthz`.
- Rollback/undo notes: documentation/reporting only.
- PR can address it: yes.
