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
