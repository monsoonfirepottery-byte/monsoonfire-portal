# Studio Brain Docker Ops Review

Snapshot time: 2026-05-06 07:00 UTC.

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

Missing:

- `studiobrain_otel_collector`
- `monitoring-proxy`
- `searxng-searxng-1`
- `searxng-redis-1`

## Restart Policy Coverage

All observed containers use `restart=unless-stopped`.

## Resource Limit Coverage

Tracked `studio-brain/docker-compose.yml` includes `deploy.resources` for Postgres, Redis, MinIO, and otel collector. Tracked monitoring Compose uses `cpus`, `mem_limit`, and `mem_reservation` for Netdata, Uptime Kuma, and monitoring proxy.

Note: Compose `deploy.resources` is not enforced by plain Docker Compose in all modes. For local Docker Compose, prefer `cpus` and `mem_limit` if hard limits are needed, but only after evidence supports caps.

## Volume Inventory

Named data volumes:

- `studio-brain_postgres_data`
- `studio-brain_minio_data`

Anonymous/local volumes:

- Six hash-named local volumes were observed.
- Docker reports 8 total local volumes and 5 active volumes.
- Local volume size is 8.984GB in the latest `docker system df` snapshot.

Do not delete anonymous volumes until they are mapped to containers or backed up.

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
- Add hard resource caps.
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
