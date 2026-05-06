# Studio Brain Ubuntu Failed Unit Triage

Snapshot: 2026-05-06 18:17 UTC.

This note is evidence and disposition only. It does not approve package upgrades, service disables, unit resets, reboots, firewall changes, or SSH changes.

## Summary

`systemctl --failed --no-pager` captured three failed units:

- `dailyaidecheck.service`
- `snap.canonical-livepatch.canonical-livepatchd.service`
- `systemd-networkd-wait-online.service`

Host memory was healthy at the latest capture time: 30Gi total, about 26Gi available, and light swap use. The apt OOM failure from 2026-05-05 no longer appears in the failed-unit list, but the host still reports a reboot requirement for kernel packages.

`make ops-ubuntu-review` now prints a top-level `Reboot And Update Posture` section and a `Failed Unit Classifier` section before the longer unit journals. Use those sections for the quick go/no-go maintenance signal, then attach the deeper unit and apt log evidence to any package/reboot ticket.

## Current Classifier Summary

Live read-only classifier output from 2026-05-06 18:17 UTC:

| Unit | Classification | State | Result | Exec status | Disposition | Approval gate |
| --- | --- | --- | --- | --- | --- | --- |
| `apt-daily-upgrade.service` | `completed_oneshot_ok` | `inactive/dead` | `success` | `0` | `observe_only` | `none_for_read_only_observation` |
| `unattended-upgrades.service` | `running_ok` | `active/running` | `success` | `0` | `observe_only` | `none_for_read_only_observation` |
| `dailyaidecheck.service` | `failed_requires_triage` | `failed/failed` | `exit-code` | `1` | `repair_or_document_aide_posture` | `disable_or_reconfigure_integrity_checks_requires_approval` |
| `snap.canonical-livepatch.canonical-livepatchd.service` | `failed_requires_triage` | `failed/failed` | `exit-code` | `1` | `privileged_livepatch_read_needed` | `livepatch_registration_or_disable_requires_approval` |
| `systemd-networkd-wait-online.service` | `failed_requires_triage` | `failed/failed` | `exit-code` | `1` | `network_online_dependency_review` | `network_manager_or_dependency_changes_require_approval` |

Operator interpretation:

- Completed one-shot services with `Result=success` are not incidents, even when their normal state is `inactive/dead`.
- Running services with `Result=success` are not incidents.
- Failed services remain visible until the cause is repaired or explicitly documented; do not run `systemctl reset-failed` merely to make a dashboard green.

## Apt Daily Upgrade OOM

Evidence:

- `apt-daily-upgrade.service` failed on 2026-05-05 06:56 UTC with `Result=oom-kill`.
- systemd reported `Mem peak: 28.2G` and `swap: 7.4G`.
- The same run logged `apt.systemd.daily[2580886]: Killed`.
- `systemd-networkd-wait-online` timed out before the apt run.
- Unattended upgrade logs repeatedly warn: `Could not figure out development release: Distribution data outdated`.
- Pending packages include kernel, Docker, containerd, curl, systemd, snapd, Node.js, rsyslog, sed, and Ubuntu release upgrader packages.
- At 07:00 UTC, `systemctl show apt-daily-upgrade.service` reported `Result=success`, `ExecMainStatus=0`, `ActiveState=inactive`, and `SubState=dead`.
- `/var/run/reboot-required` is now present and lists `linux-image-6.17.0-23-generic` and `linux-base`.

Disposition:

- Treat the exact OOM root cause as unresolved but bounded: a later apt run succeeded, but unattended upgrade/install previously caused an extreme memory spike while package metadata and network-online warnings were already noisy.
- Do not rerun unattended upgrades blindly.
- Run updates only in a supervised maintenance window with pre-checks and post-checks.
- Include `distro-info-data`/release metadata freshness in the apt investigation even if it is not currently listed in `apt list --upgradable`.
- Plan a supervised reboot window because kernel packages now require it.

Safe next step:

- Capture `make ops-ubuntu-review` and `make ops-backup-evidence` immediately before any package work.
- Inspect apt logs around 2026-05-05 06:40-06:56 UTC.
- Decide whether unattended upgrades should stay enabled as-is, be tuned, or be replaced with a scheduled supervised update workflow.

Rollback notes:

- Documentation and script changes are reversible through Git.
- Package changes need package-specific rollback notes and should not be bundled into this documentation PR.

## Dailyaidecheck Failure

Evidence:

- `dailyaidecheck.service` fails daily with `ExecMainStatus=1`.
- Journal lines repeat: `WARN: it is not possible to use mail(1) unless aide is run as root or as non-root with added capabilities`.
- `aide --version` reports AIDE 0.19.1.

Disposition:

- Repair or explicitly document AIDE posture. Do not reset the failed unit just to clear the dashboard.
- Likely repair paths are AIDE execution/capability configuration, mail notification configuration, or a documented decision to replace/disable the daily AIDE check.

Safe next step:

- Inspect AIDE configuration and Debian README guidance under `/usr/share/doc/aide-common/`.
- Decide whether this host needs daily AIDE reports, and where notifications should go.

Approval gate:

- Disabling AIDE or integrity checks requires human approval.

## Canonical Livepatch Failure

Evidence:

- `snap.canonical-livepatch.canonical-livepatchd.service` is failed, enabled, and has `NRestarts=5`.
- Non-root `canonical-livepatch status` could not read `/var/snap/canonical-livepatch/406/livepatchd.err`.
- Unit journal did not expose useful recent entries to the unprivileged read.

Disposition:

- Requires privileged inspection before repair/disable decision.
- Do not assume livepatch is working just because the package exists.

Safe next step:

- Run a privileged read-only livepatch status and inspect the livepatch error file.
- Decide whether the host should use livepatch, and document unsupported-kernel or Ubuntu Pro requirements if relevant.

Approval gate:

- Disabling livepatch or changing Ubuntu Pro/livepatch registration requires human approval.

## Network Wait Online Failure

Evidence:

- `systemd-networkd-wait-online.service` failed since boot with `ExecMainStatus=1`.
- `apt-daily-upgrade.service` repeatedly logs wait-online timeouts before unattended-upgrade work starts.
- Prior apt runs still completed despite wait-online errors, so this is noisy and potentially contributory rather than proven causal.

Disposition:

- Repair or document network-online expectations. Do not disable until dependency impact is understood.

Safe next step:

- Inspect netplan/networkd ownership and the `/run/systemd/system/systemd-networkd-wait-online.service.d/10-netplan.conf` drop-in.
- Identify units that actually require `network-online.target`.

Approval gate:

- Disabling wait-online or changing network manager behavior requires approval.

## Maintenance Window Checklist

Pre-checks:

- `make ops-ubuntu-review`
- `make ops-backup-evidence`
- `make ops-docker-review`
- Studio Brain `/healthz`, `/readyz`, and `/health/dependencies`
- Mission Control health if the control center is part of the window
- Confirm SSH access from a second shell
- Confirm package-specific rollback notes for kernel, Docker, containerd, systemd, and Node.js

Approved execution only:

- Run package updates in a supervised shell.
- Keep a second SSH session open.
- Do not reboot until health checks and rollback notes are captured.

Post-checks:

- `systemctl --failed --no-pager`
- `journalctl -k --since "1 hour ago" | grep -Ei "oom|killed process|error|fail"`
- Studio Brain `/healthz`, `/readyz`, and `/health/dependencies`
- Docker container health
- Backup evidence freshness

## Follow-Up PR Candidates

- Add a privileged-read instructions block for livepatch/AIDE diagnostics.
- Add a supervised update-window checklist script that prints commands but does not execute upgrades.
- Add an apt metadata freshness check to `make ops-ubuntu-review`.
