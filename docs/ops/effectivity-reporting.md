# Effectivity Reporting

## Purpose

`make ops-effectivity-report` builds a read-only Studio Brain ops packet that combines live health, idle-worker effectivity, Mission Control harness coverage, backup confidence, failed-unit classification, and privileged-capture availability.

The report is intended for weekly operator review and swarm handoffs. Missing Docker, PostgreSQL, live endpoints, or privileged host captures are warnings, not reasons to mutate the host from the report command.

## Command

```bash
make ops-effectivity-report
```

Without `make`:

```bash
bash scripts/ops/effectivity_report.sh
```

Optional overrides:

```bash
bash scripts/ops/effectivity_report.sh \
  --run-id effectivity-manual-20260507 \
  --output-dir output/ops/effectivity
```

## Output Path

Default artifacts are timestamped:

- `output/ops/effectivity/effectivity-YYYYMMDDTHHMMSSZ.json`
- `output/ops/effectivity/effectivity-YYYYMMDDTHHMMSSZ.md`

`output/` is ignored by git, so local report runs do not create tracked churn. Commit this documentation and script changes, but do not commit generated effectivity outputs unless the owner explicitly asks for a curated evidence packet.

## Privileged Capture Status

The effectivity report consumes the approval-gated privileged evidence reader. If no latest capture exists or the evidence directory is unreadable, the report emits:

```text
sudo_unavailable
```

That status means the report did not attempt sudo and the missing host-only evidence remains an approval-gated follow-up. It is not a host failure by itself.

## Retention

Recommended local retention:

- Keep the latest 12 weekly Markdown reports for operator review.
- Keep matching JSON only while it is useful for comparison or ingestion.
- Delete older ignored `output/ops/effectivity/*` artifacts during routine local cleanup after confirming no active incident references them.
- Do not delete `/var/lib/studio-brain/ops-evidence` privileged capture artifacts from an agent shell; that host evidence lane needs explicit owner approval.

## Safety

The command is read-only. It avoids environment dumps, does not print secrets, and degrades gracefully when optional dependencies are unavailable.
