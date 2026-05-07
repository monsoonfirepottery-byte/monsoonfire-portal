# Studio Brain Docker Ops Review

Snapshot time: 2026-05-06 18:32 UTC.

## Runtime Versions

- Docker Engine: 29.4.0.
- Docker Compose: v5.1.2.

## Compose Files Discovered

Tracked:

- `studio-brain/docker-compose.yml`
- `studio-brain/docker-compose.proxy.yml`
- `config/studiobrain/monitoring/docker-compose.yml`

Live compose projects:

- `studio-brain`: `/home/wuff/monsoonfire-portal/studio-brain/docker-compose.yml`
- `monitoring`: `/home/wuff/monitoring/docker-compose.yml`
- `searxng`: `/home/wuff/searxng/docker-compose.yml`

## Container Roles

| Container | Compose project | Role |
| --- | --- | --- |
| `studiobrain_postgres` | `studio-brain` | PostgreSQL 16 + pgvector |
| `studiobrain_redis` | `studio-brain` | Redis dependency |
| `studiobrain_minio` | `studio-brain` | Artifact/object storage |
| `studiobrain_otel_collector` | `studio-brain` | Optional telemetry collector |
| `netdata` | `monitoring` | Host/container metrics |
| `uptime-kuma` | `monitoring` | Synthetic monitoring |
| `monitoring-proxy` | `monitoring` | Caddy access bridge |
| `searxng-searxng-1` | `searxng` | Search service |
| `searxng-redis-1` | `searxng` | SearXNG Redis |

## Healthcheck Coverage

Covered:

- `studiobrain_postgres`
- `studiobrain_redis`
- `studiobrain_minio`
- `netdata`
- `uptime-kuma`
- `monitoring-proxy` in tracked monitoring Compose, via local `/healthz` Caddy probe
- `studiobrain_proxy` in tracked optional proxy Compose, via local `/healthz` Caddy probe

Missing:

- `studiobrain_otel_collector`
- `searxng-searxng-1`
- `searxng-redis-1`

Notes:

- The live SearXNG Compose path is `/home/wuff/searxng/docker-compose.yml`, outside this tracked repo. Add its healthchecks through an approval-gated host patch or by importing the compose source into a tracked operations lane first.
- Healthcheck changes require container recreate to take effect; do not restart or recreate containers without explicit approval and a service-window plan.

## Restart Policy Coverage

All observed containers use `restart=unless-stopped`. No restart loops or exited containers were visible in the 18:32 UTC snapshot.

## Resource Limit Coverage

Live `docker inspect` now reports CPU and memory limits for all observed containers:

- `studiobrain_postgres`: 2 CPUs, 2GB memory, 1GB reservation.
- `studiobrain_minio`: 1 CPU, 768MB memory, 384MB reservation.
- `studiobrain_redis`: 0.5 CPU, 384MB memory, 192MB reservation.
- `studiobrain_otel_collector`: 0.5 CPU, 256MB memory, 128MB reservation.
- Monitoring/search sidecars also report CPU and memory limits.

No hard systemd caps were observed for the user-scoped Node app services in this Docker review.

## Volume Inventory

Named data volumes:

- `studio-brain_postgres_data`
- `studio-brain_minio_data`

Anonymous/local volumes:

- Six hash-named local volumes were observed.
- Docker reports 8 total local volumes and 5 active volumes, leaving 3 inactive anonymous volumes to classify before cleanup.
- Local volume size is 8.866GB in the latest `docker system df` snapshot.
- `studio-brain_postgres_data` accounts for essentially all observed Docker volume size at 8.866GB.
- `studio-brain_minio_data` is tiny in this snapshot at about 30KB.

Do not delete anonymous volumes until they are mapped to containers or backed up.

## Docker Log Posture

- Containers use the `json-file` log driver.
- Non-root Docker inventory could not read `/var/lib/docker/containers/*-json.log`; sudo is required to prove per-container log sizes.
- Host-level `/var/log` and journal pressure were low in the paired capacity snapshot, but Docker json-log size remains an evidence gap until a privileged read is captured.

## Network Inventory

Docker networks:

- `studio-brain_default`
- `monitoring_default`
- `searxng_default`
- default `bridge`, `host`, and `none`

Monitoring Compose attaches Uptime Kuma to `studio-brain_default` and `searxng_default`.

## Image Sprawl And Dangling Artifact Concerns

- Images: 9 total, 4.397GB.
- Containers: 9 total, all active.
- Dangling images: none observed.
- Build cache: 300.3MB reclaimable.
- No exited containers observed.
- Several images use floating tags: `latest`, `stable`, or major-only tags.

## Orphan/Zombie Container Risks

- No exited containers were observed.
- No restart loops were visible in `docker ps`.
- Containers without healthchecks can still be zombie-like if their internal service is dead while the process remains up.

## Safe Cleanup Checklist

Use `make ops-cleanup-candidates` or `bash scripts/ops/cleanup_candidates.sh --import-target /home/wuff/imports` to prepare a read-only cleanup packet before any prune, delete, truncate, or restart proposal.

Safe to automate:

- Report `docker system df`.
- Report exited containers.
- Report dangling images.
- Report build cache size.
- Report container health/restart/log policy.

Safe with backup:

- Remove known build cache after confirming no active builds need it.
- Remove anonymous volumes only after they are mapped and proven non-data-bearing.

Requires service window:

- Change port binds.
- Change image tags.
- Add or alter hard resource caps.
- Apply healthcheck stanza changes to already-running containers, because Docker Compose must recreate the affected container for the new healthcheck to appear.
- Restart or recreate containers.

Requires human approval:

- `docker system prune`.
- `docker volume rm`.
- Deleting or recreating Postgres/MinIO volumes.
- Pulling new production images.

Do not touch:

- `studio-brain_postgres_data` and `studio-brain_minio_data` without a verified backup and explicit approval.

## Unsafe Cleanup Actions Requiring Approval

- `docker system prune --volumes`
- `docker compose down -v`
- Removing any hash-named volume before ownership classification
- Restarting `studiobrain_postgres`
- Rebinding exposed ports
