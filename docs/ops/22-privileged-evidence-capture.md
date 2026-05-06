# Privileged Evidence Capture

## Purpose

Studio Brain agents should not receive broad sudo. The approved workaround is a narrow evidence lane:

1. A root-owned collector runs read-only privileged checks.
2. It writes redacted artifacts under `/var/lib/studio-brain/ops-evidence`.
3. Agents read those artifacts with `make ops-privileged-evidence-read`.
4. Any host mutation remains a separate approval gate.

This turns `sudo_unavailable` into `approval_gated` evidence work instead of a false system failure.

## What This Adds

- `scripts/ops/privileged_evidence_capture.sh`
  - read-only collector
  - intended install path: `/usr/local/sbin/studio-brain-ops-capture`
  - writes `summary.json`, journals, firewall/SSH posture, Docker metadata, backup file metadata, and resource snapshots
- `scripts/ops/privileged_evidence_read.sh`
  - agent-facing reader for latest capture artifacts
- `scripts/install-studiobrain-ops-capture.sh`
  - dry-run-by-default installer for approved operator use
- `config/studiobrain/systemd/studio-brain-ops-capture.{service,timer}`
  - optional root-owned scheduled capture
- `config/studiobrain/sudoers/studio-brain-ops-capture`
  - optional no-password sudoers allowlist for exactly `/usr/local/sbin/studio-brain-ops-capture`

## Safety Boundary

The collector does not:

- restart services
- install, upgrade, or remove packages
- change firewall, SSH, user, group, or sudoers settings
- prune Docker resources
- restart or recreate containers
- write to PostgreSQL or restore data
- dump environment variables
- print known token, cookie, password, secret, API key, or JWT patterns

It does write its own evidence artifacts and update a `latest` pointer.
Each report section is best-effort and uses `STUDIO_BRAIN_OPS_CAPTURE_TIMEOUT_SECONDS` with a default of 45 seconds when GNU `timeout` is available, so one stuck read should not pin the whole capture.

## Approval-Gated Install

Dry-run the install plan:

```bash
bash scripts/install-studiobrain-ops-capture.sh
```

Approved install without sudoers:

```bash
sudo bash scripts/install-studiobrain-ops-capture.sh --apply
```

Approved install with timer and sudoers group:

```bash
sudo bash scripts/install-studiobrain-ops-capture.sh --apply --create-group --install-sudoers --enable-timer
sudo usermod -aG studio-brain-ops-capture <approved-user>
```

The user/group change is an explicit human approval step. Do not add agents to broad privileged groups such as `docker`.

## Manual Capture

Run one capture:

```bash
sudo /usr/local/sbin/studio-brain-ops-capture
```

Or, after sudoers approval for the narrow command:

```bash
sudo -n /usr/local/sbin/studio-brain-ops-capture
```

Local smoke without root:

```bash
bash scripts/ops/privileged_evidence_capture.sh --smoke --output-dir output/ops/privileged-evidence
```

## Agent Read Path

Read latest evidence:

```bash
make ops-privileged-evidence-read
```

Without `make`:

```bash
bash scripts/ops/privileged_evidence_read.sh
```

List files:

```bash
bash scripts/ops/privileged_evidence_read.sh --list
```

Read a single evidence file:

```bash
bash scripts/ops/privileged_evidence_read.sh --cat firewall_posture.txt
```

## Evidence Produced

The capture creates a timestamped run directory containing:

- `summary.json`
- `capture_metadata.txt`
- `versions.txt`
- `resource_pressure.txt`
- `disk_hotspots.txt`
- `process_pressure.txt`
- `systemd_failed_units.txt`
- `systemd_timers.txt`
- `systemd_selected_units.txt`
- `selected_unit_journals.txt`
- `kernel_oom_journal.txt`
- `reboot_package_posture.txt`
- `apt_logs.txt`
- `network_listeners.txt`
- `firewall_posture.txt`
- `ssh_posture.txt`
- `time_sync_posture.txt`
- `docker_metadata.txt`
- `docker_privileged_sizes.txt`
- `backup_artifacts.txt`

## Rollback

Disable timer:

```bash
sudo systemctl disable --now studio-brain-ops-capture.timer
```

Remove installed units and sudoers:

```bash
sudo rm -f /etc/systemd/system/studio-brain-ops-capture.service
sudo rm -f /etc/systemd/system/studio-brain-ops-capture.timer
sudo rm -f /etc/sudoers.d/studio-brain-ops-capture
sudo systemctl daemon-reload
```

Remove the installed command:

```bash
sudo rm -f /usr/local/sbin/studio-brain-ops-capture
```

Do not delete `/var/lib/studio-brain/ops-evidence` unless the owner approves evidence retention cleanup.

## Open Decisions

- Which human or automation account, if any, should join `studio-brain-ops-capture`.
- Whether the timer should run hourly or only on demand.
- How long to retain `/var/lib/studio-brain/ops-evidence` artifacts.
- Whether Mission Control should ingest latest `summary.json` as a task/evidence source.
