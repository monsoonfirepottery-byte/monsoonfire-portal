# Studio Brain Capacity Plan

Snapshot time: 2026-05-06 07:00-07:02 UTC.

## Current Observed Capacity Constraints

- Root filesystem is healthy at 15% used: 126G of 914G.
- Inodes are healthy at 2% used on `/`.
- RAM is healthy at rest: 30Gi total, 26Gi available at collection.
- Swap has light current use: 445Mi of 8Gi.
- Docker reports 4.397GB in images, 8.984GB in local volumes, and 300.3MB in build cache.
- PostgreSQL database `monsoonfire_studio_os` is 8333MB.
- The largest observed areas under `/home/wuff` are `/home/wuff/imports` at 45G and `/home/wuff/monsoonfire-portal` at 44G.
- `/home/wuff/imports` measured 23G in the 00:16 UTC snapshot and 45G at 07:00 UTC. A targeted import pressure report showed the largest files were about 63 days old, so treat this as an observed measurement discrepancy or untrended capacity concern until historical deltas are proven.

## Disk Growth Concerns

| Path | Observed size | Concern |
| --- | ---: | --- |
| `/home/wuff/imports` | 45G | mail/import artifacts need retention policy and growth trend; current largest items are two 22G PST files classified approval-only |
| `/home/wuff/monsoonfire-portal` | 44G | repo artifacts, imports, build output, generated state, and dirty host checkout can grow invisibly |
| Docker volumes/images | 8.984G volumes, 4.397G images | volumes/images currently manageable but should be trended |
| `/home/wuff/.npm` | 4.2G | package cache cleanup candidate |
| `/home/wuff/.cache` | 3.8G | cache cleanup candidate |
| `/home/wuff/studio-brain-mission-control` | 4.0G | deployment/archive retention needs policy |
| `/home/wuff/backups` | 3.5G | backup retention and restore evidence should be tied to the backup manifest |

Warning threshold: root filesystem above 70% or any growth area increasing by more than 10G/week.

Critical threshold: root filesystem above 85%, `/boot` above 80%, or free space below 50G.

Use `make ops-import-pressure` or `bash scripts/ops/import_pressure.sh --target /home/wuff/imports` for the read-only import-specific pressure report. It reports size, age buckets, and cleanup classifications without reading imported content or modifying files.

## Database Growth Concerns

- Database size: 8333MB.
- Largest relations:
  - `public.swarm_memory`: 3.1GB.
  - `public.memory_relation_edge`: 2.3GB.
  - `public.memory_pattern_index`: 1.3GB.
  - `public.memory_entity_index`: 1.0GB.
  - `public.memory_ingest_event`: 288MB.
- Largest indexes are memory retrieval/search indexes, several over 240MB and up to 591MB.
- Dead tuple percentages are mostly low on large tables, but small operational tables show high dead percentages and should not be over-interpreted without row counts.

Warning threshold: database grows above 20GB, any single table grows above 8GB, or dead tuples exceed 20% on a table larger than 1GB.

Critical threshold: database grows above 50GB without a tested restore process.

## Docker Image And Volume Growth

- Images: 4.397GB.
- Containers: 4.112MB writable layer total.
- Volumes: 8.984GB.
- Build cache: 300.3MB reclaimable.
- No dangling images or exited containers were observed.
- Docker reports 8 local volumes but only 5 active, so anonymous volume ownership should be classified before cleanup.

Warning threshold: Docker root above 30G or more than 5 inactive volumes.

Critical threshold: Docker root above 80G or unknown inactive volumes containing data-bearing services.

## Log Growth

- `/var/log`: 93M.
- systemd journal: 48M.
- `/tmp`: 55M.
- Current log pressure is low.

Warning threshold: `/var/log` above 2G, journal above 1G, or any single Docker json log above 512M.

Critical threshold: logs consume more than 10% of root filesystem.

## CPU And Memory Pressure

- CPU load was low at the 07:00 UTC observation: `0.23, 0.37, 0.49`.
- RAM was healthy during observation, but unattended upgrades triggered an OOM kill on 2026-05-05.
- `studio-brain-mission-control.service` was using about 481M and `studio-brain.service` about 244M.
- Docker resource limits exist in tracked Compose for core dependencies, but user-scoped app services are not capped at the systemd level in this pass.

Warning threshold: sustained load above CPU count for 15 minutes, swap above 25%, or Mission Control above 1.5GB.

Critical threshold: OOM event, swap above 75%, or repeated service restarts.

## Backup Storage Needs

- Root-owned config archives under `/var/backups/studio-brain/daily` are tiny and current through 2026-05-05.
- App-level backup evidence under `output/backups/latest.json` points to 2026-04-28.
- PostgreSQL is 8333MB; full database backups and restore drills need explicit storage and retention modeling.
- MinIO and Redis backup posture should be proven in the same manifest as PostgreSQL.

Minimum recommendation:

- Keep at least 7 daily and 4 weekly restore-tested database backups.
- Store backup manifests outside the live repo checkout.
- Keep one restore drill artifact per month.

## 30/60/90 Day Watch Items

30 days:

- Fix backup evidence split and prove a current PostgreSQL restore drill.
- Triage apt OOM and pending updates.
- Classify `/home/wuff/imports` PST/zip artifacts and define retention for import data.
- Snapshot Postgres relation sizes weekly.
- Classify anonymous Docker volumes.

60 days:

- Trend `/home/wuff/imports`, repo artifacts, Docker volumes, and Postgres memory tables.
- Pin floating Docker image tags or document update cadence.
- Add healthchecks to containers that currently only report `Up`.

90 days:

- Decide whether Postgres should remain LAN-bound or move to loopback/firewalled access.
- Establish restore time objective and restore point objective.
- Set retention for Mission Control deployment artifacts, imports, and cache directories.

## Metrics Missing Or Not Yet Collected

- Historical disk growth by path.
- Per-import-run size deltas and retention policy for `/home/wuff/imports`.
- Historical database table/index growth.
- pg_stat_statements top queries by total time and mean time.
- Backup restore duration and verified restore target size.
- Docker per-volume ownership and growth.
- App service memory trend over time.
- Network listener change history.
- Failed systemd unit history beyond current state.
