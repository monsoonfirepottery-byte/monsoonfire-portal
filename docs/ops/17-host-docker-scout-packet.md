# Host/Docker Scout Packet

Snapshot owner: Worker C (Host/Docker Scout)

This packet adds read-only evidence capture for the host and Docker posture slices that need operator review before any remediation. It intentionally avoids Makefile, package script, integrity manifest, Mission Control, and existing Docker inventory edits.

## New Evidence Scripts

| Script | Purpose | Mutates host? |
| --- | --- | --- |
| `scripts/ops/host_failed_unit_trends.sh` | Failed-unit trend artifact plus AIDE, livepatch, and network-online readiness checklists. | No |
| `scripts/ops/host_package_posture.sh` | Apt OOM/package posture plus SSH and firewall evidence slots. | No |
| `scripts/ops/time_sync_posture.sh` | Time synchronization service, source, and log posture. | No |
| `scripts/ops/docker_posture_review.sh` | Docker log-size evidence slot, inactive volume classifier, floating-tag policy, compose drift checker, Docker root growth trend, container user posture, and Compose secret reference inventory. | No |

Run directly from a Bash shell on the host:

```bash
bash scripts/ops/host_failed_unit_trends.sh
bash scripts/ops/host_package_posture.sh
bash scripts/ops/time_sync_posture.sh
TARGET_REPO=/home/wuff/monsoonfire-portal bash scripts/ops/docker_posture_review.sh
```

## Approval-Gated Reads

The scripts use `sudo -n` only as an optional privileged-read probe. If passwordless sudo is not already available, the script records `status: approval_gated` and prints the exact command for an approved operator shell. A missing sudo grant is evidence, not a failure.

Approval-gated slots include:

- AIDE configuration/database metadata.
- Livepatch snap/service metadata.
- Network link and resolver facts when privileged.
- Effective SSHD configuration and auth/fail2ban tails.
- UFW, NFT, and iptables details.
- Docker root directory breakdown.
- Docker json-log file sizes under `/var/lib/docker/containers`.

## Slice Coverage

| Slice area | Evidence added |
| --- | --- |
| failed-unit trend artifact | `host_failed_unit_trends.sh` state matrix and journal trend sections. |
| AIDE/livepatch/network-online checklists | Dedicated readiness sections with approval gates. |
| apt OOM/package posture | `host_package_posture.sh` OOM trend, apt logs, upgradable count, holds, reboot-required state. |
| time sync | `time_sync_posture.sh` clock snapshot, service state, source status, logs. |
| SSH/firewall evidence slots | `host_package_posture.sh` listener, service, sshd, fail2ban, UFW/NFT/iptables slots. |
| Docker log-size evidence slot | `docker_posture_review.sh` log driver/options and gated json-log size scan. |
| inactive volume classifier | Active mount classifier marks unmounted volumes as `inactive_review_before_cleanup`. |
| floating-tag policy | Image/container scan flags `latest`, `stable`, branch-like, and broad major tags. |
| compose drift checker | Live `docker compose ls` plus tracked compose-file inventory. |
| Docker root growth trend | `docker system df`, optional Docker root `du`, and gated root breakdown. |
| container user posture | Configured user, privileged flag, caps, security opts, read-only rootfs. |
| Compose secret reference inventory | Compose `secrets`, `env_file`, and `environment` references with values redacted. |
| Docker runbook refresh | See `docs/ops/18-docker-runbook-refresh.md`. |

## Operator Rules

- Do not reset failed units only to clear status.
- Do not run `apt upgrade`, install packages, or reboot from these scripts alone.
- Do not edit SSH, firewall, or fail2ban posture without a second access path and approval.
- Do not prune Docker resources, remove inactive volumes, truncate logs, pull floating tags, or recreate containers without backup evidence and explicit approval.
- Do not inspect or paste secret values; the Compose inventory is reference-only.
