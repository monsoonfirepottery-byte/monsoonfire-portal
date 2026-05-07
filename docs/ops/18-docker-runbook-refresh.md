# Docker Runbook Refresh

This refresh turns Docker posture findings into a cautious operating checklist. It supplements `docs/ops/05-docker-ops-review.md` and `docs/ops/06-runbooks.md` without changing existing Make targets.

## Read-Only Capture

Use the existing inventory first, then the Worker C posture packet:

```bash
bash scripts/ops/docker_inventory.sh
TARGET_REPO=/home/wuff/monsoonfire-portal bash scripts/ops/docker_posture_review.sh
```

Capture the output into a restricted evidence location when it includes host paths. Do not paste secret values into chat, tickets, or memory.

## Log Growth Review

Evidence to attach:

- `docker system df`.
- Container log driver/options from `docker inspect`.
- Privileged json-log size slot from `docker_posture_review.sh`, when approved.
- `/var/log` and journal pressure from the paired capacity/log scripts.

Approval required before:

- Truncating Docker json logs.
- Changing daemon log rotation.
- Recreating containers to apply log options.
- Deleting log files.

## Inactive Volume Review

Evidence to attach:

- Active mount classifier from `docker_posture_review.sh`.
- `docker system df -v`.
- `docker volume inspect` metadata.
- Backup evidence for stateful services.

Classify each inactive volume as:

- `known_stateful_keep`
- `known_temp_remove_after_backup`
- `anonymous_unknown_hold`
- `external_project_hold`

Never remove `studio-brain_postgres_data`, `studio-brain_minio_data`, or any unknown hash-named volume without a verified backup and explicit approval.

## Floating Tag Policy

Treat these tags as review findings in production-like services:

- `latest`
- `stable`
- branch-like tags such as `main`, `master`, `dev`, `edge`
- broad major-only tags such as `16` or `3`

Preferred posture:

- Pin service images to immutable digests or specific patch tags.
- Record the rollback tag/digest before pull or recreate.
- Change one service at a time during an approved window.
- Verify healthchecks and app dependency endpoints after recreate.

Tracked image tag inventory from the current Compose files:

| Service | Image reference | Tag posture | Recommended action | Rollback note |
| --- | --- | --- | --- | --- |
| `postgres` | `${STUDIO_BRAIN_POSTGRES_IMAGE:-pgvector/pgvector:pg16}` | major-only default | Keep the env override path, but pin the deployed value to a tested patch tag or digest before a database maintenance window. | Restore the previous env override or compose default, then recreate only the PostgreSQL container during an approved window. |
| `redis` | `redis:7-alpine` | major-only | Pin to a tested Redis 7 patch tag after backup scope is classified. | Restore `redis:7-alpine` and recreate during the same approved window. |
| `minio` | `minio/minio:latest` | floating `latest` | Highest-priority pin candidate because object-store behavior can change under `latest`. Choose a dated MinIO release tag and record object-store smoke checks. | Restore the prior image ID/tag and verify MinIO live health plus artifact-store app checks. |
| `otel-collector` | `otel/opentelemetry-collector-contrib:latest` | floating `latest` | Pin with the observability profile off by default; update separately from stateful dependencies. | Restore the prior collector image and verify the profile still starts only when requested. |
| `netdata` | `netdata/netdata:stable` | floating `stable` | Pin only after confirming the monitoring stack update cadence and rollback path. | Restore `stable` or the prior digest and verify local dashboard reachability. |
| `uptime-kuma` | `louislam/uptime-kuma:1` | broad major-only | Pin to a tested v1 patch tag when upgrading monitoring. | Restore `louislam/uptime-kuma:1` or prior digest and verify monitors load. |
| `monitoring-proxy` | `caddy:2-alpine` | major-only | Lower risk; pin with the monitoring proxy healthcheck/service-window work. | Restore `caddy:2-alpine` and verify `/healthz` plus protected proxy routes. |
| `studiobrain-proxy` | `caddy:2.8-alpine` | minor-specific | Acceptable short-term; consider digest pinning if this proxy becomes production-critical. | Restore `caddy:2.8-alpine` and verify `/healthz`, `/studio`, `/functions`, and `/portal` routes. |

Update cadence:

- Monthly: review floating tags and upstream release notes without pulling images.
- Quarterly: schedule one small image update PR or maintenance window for the highest-risk floating tag.
- Incident-driven: if a CVE affects a running image, prepare a single-service update packet with backup evidence, current image ID, target image, health checks, and rollback command.

Do not run `docker compose pull`, recreate containers, or change image tags on
the host from this docs packet. Image pinning is a runtime change because it
usually requires pull/recreate and can alter persistent data compatibility.

## Compose Drift Review

Compare:

- live `docker compose ls`
- tracked compose files under `/home/wuff/monsoonfire-portal`
- known external projects such as monitoring/search sidecars

Do not delete external compose projects merely because they are outside the repo. First identify the owner, service purpose, data volumes, port bindings, and rollback path.

## Container User And Capability Review

Evidence to attach:

- configured container user
- privileged mode
- added/dropped capabilities
- security options
- read-only root filesystem state

Approval required before changing any of these settings because most require container recreation and can break volume permissions or startup behavior.

## Compose Secret Reference Inventory

The posture script reports only references:

- `secrets:`
- `env_file:`
- `environment:` keys with values redacted

Use it to confirm where secrets are wired, not to inspect secret values. Secret rotation remains a separate approved procedure.

## Rollback Checklist

Before any approved Docker mutation:

1. Capture `bash scripts/ops/docker_inventory.sh`.
2. Capture `TARGET_REPO=/home/wuff/monsoonfire-portal bash scripts/ops/docker_posture_review.sh`.
3. Capture backup evidence for stateful services.
4. Record current image IDs, tags, digests when available, and compose file paths.
5. Keep the prior compose file and env files available on the host.
6. Verify `/healthz`, `/readyz`, `/health/dependencies`, and container health after the change.
