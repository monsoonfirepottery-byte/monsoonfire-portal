# Studio Brain Host Stack

Use this runbook for the broader Studio Brain host-control stack that sits behind the browser-first Control Tower.

## Source of truth

- Browser control tower: `docs/runbooks/STUDIO_BRAIN_CONTROL_TOWER_V2.md`
- Wrapper CLI: `scripts/studiobrain-ops.py`
- Linux wrapper: `scripts/studiobrain-ops.sh`
- Bootstrap script: `scripts/install-studiobrain-ops-stack.sh`
- Provisioning playbook: `config/studiobrain/ansible/studio-brain-host-stack.yml`
- tmux session helper: `scripts/studiobrain-tmux-session.sh`

## What it installs

- `tmux` with a tracked Studio Brain session layout
- `mosh` plus the default UDP firewall range
- `ansible` on the Ubuntu host so the host can provision itself predictably
- the base CUPS print stack (`cups`, `cups-client`, `cups-filters`) with the scheduler enabled
- the pinned Bambu Studio Linux CLI wrapper for headless fabrication and slicing workflows
- the repo-backed monitoring sidecars under `config/studiobrain/monitoring`:
  - `netdata`
  - `uptime-kuma`
  - the `monitoring-proxy` Caddy bridge
- periodic host operations timers from `config/studiobrain/systemd`:
  - `studio-brain-backup.timer`
  - `studio-brain-disk-alert.timer`
  - `studio-brain-healthcheck.timer`
  - `studio-brain-idle-worker.timer`
  - `studio-brain-idle-worker-overnight.timer`
  - `studio-brain-reboot-watch.timer`

## Commands

From the repo root on Windows:

```powershell
npm run studio:ops:browser:url
npm run studio:ops:sync
npm run studio:ops:deploy
npm run studio:ops:install
npm run studio:ops:reconcile
npm run studio:ops:status
npm run studio:ops:tmux:ensure
npm run studio:ops:tmux:attach:cmd
npm run studio:ops:cockpit:state
npm run studio:ops:session:list
npm run studio:ops:bambu:install
npm run studio:ops:bambu:status
npm run studio:ops:bambu:smoke
npm run studio:ops:bambu:run -- -- --help
```

Primary daily operator surface:

- Browser route: `https://portal.monsoonfire.com/staff/cockpit/control-tower`
- Short alias: `https://portal.monsoonfire.com/staff/control-tower`
- Wrapper shortcut: `npm run studio:ops:browser:url`

From the `scripts/` directory on Linux:

```bash
bash ./studiobrain-ops.sh sync-support --json
bash ./studiobrain-ops.sh deploy-runtime --json
bash ./studiobrain-ops.sh install-stack --json
bash ./studiobrain-ops.sh reconcile --json
bash ./studiobrain-ops.sh status --json
bash ./studiobrain-ops.sh cockpit-state --json
bash ./studiobrain-ops.sh session-list --json
```

## Bambu headless slicing

Use these commands as the server-primary path:

```powershell
npm run studio:ops:bambu:install
npm run studio:ops:bambu:status
npm run studio:ops:bambu:smoke -- --keep-output
```

`studio:ops:bambu:status` verifies the pinned install, the extracted `AppRun`, the smoke fixture, the Bambu data root, and whether the wrapper will use `xvfb-run`. `studio:ops:bambu:smoke -- --keep-output` slices Bambu's bundled 3MF fixture and persists the exported 3MF plus stdout/stderr logs under `/home/wuff/studiobrain-data/bambu/smoke/<run-id>/`.

Use `studio:ops:bambu:run` for raw CLI experiments. Pass a second `--` so Bambu options are not consumed by the local wrapper:

```powershell
npm run studio:ops:bambu:run -- -- --slice 0 --debug 2 --outputdir /home/wuff/studiobrain-data/bambu/labels/variant_B_insert-YYYYMMDD-HHMM --export-3mf variant_B_insert.3mf --load-settings "/opt/studiobrain/bambu-studio/current/squashfs-root/resources/profiles/BBL/process/0.16mm Optimal @BBL X1C.json;/opt/studiobrain/bambu-studio/current/squashfs-root/resources/profiles/BBL/machine/Bambu Lab X1 Carbon 0.4 nozzle.json" --load-filaments "/opt/studiobrain/bambu-studio/current/squashfs-root/resources/profiles/BBL/filament/Bambu PLA Basic @BBL X1C.json" /home/wuff/studiobrain-data/bambu/labels/inputs/variant_B_insert.stl
```

Current raw-STL limitation, verified on 2026-05-01: the bundled smoke 3MF slices successfully, but the support-free label STL `labels/variant_B/variant_B_insert.stl` does not yet slice reliably through Bambu's raw CLI path. The raw run failed before producing `variant_B_insert.3mf`; the wrapper classifies the failure as `settings_profile_drift` with supporting categories such as `filament_mapping_mismatch` and `upstream_cli_segfault` when the CLI prints profile/filament warnings and then exits 139. This means the Bambu install is healthy enough for project smoke tests, but the label workflow still needs a known-good Bambu 3MF template or refreshed profile pack before Bambu can be the only printability gate.

Until that template exists, use the PrusaSlicer inspection path for label printability checks and keep Bambu raw-slice artifacts for debugging:

- Keep the exact `studio:ops:bambu:run` command, the JSON `failure` object, stdout, stderr, output directory, and any generated 3MF.
- Keep the input STL under `/home/wuff/studiobrain-data/bambu/labels/inputs/` when reproducing on Studio Brain.
- Compare against a fresh `studio:ops:bambu:smoke -- --keep-output` run before treating a raw-STL failure as a broken install.
- Fall back to `labels/slice_with_prusaslicer.ps1` and `labels/slices/prusaslicer_x1c_inspect/slice_summary.json` when Bambu reports raw CLI instability.

Failure categories reported by `studio:ops:bambu:run`:

- `settings_profile_drift`: printer/process/filament profiles are missing keys, incompatible, duplicated, or otherwise not accepted by the CLI.
- `filament_mapping_mismatch`: filament IDs, color metadata, or imported model count do not line up with the arguments.
- `display_backend_unavailable`: the CLI cannot connect to a headless display backend; retry with `STUDIO_BRAIN_BAMBU_XVFB_MODE=always`.
- `output_path_unavailable`: the export directory or file cannot be opened by the host user.
- `upstream_cli_segfault`: the Bambu CLI crashes after argument/profile handling; verify smoke, keep logs, and fall back.
- `unknown_cli_failure`: preserve logs and compare against smoke before deciding next action.

## Optional env knobs

These live alongside the existing Studio Brain host access secrets in `secrets/studio-brain/studio-brain-mcp.env`.

- `STUDIO_BRAIN_TMUX_SESSION_NAME`
  Default: `studiobrain`
- `STUDIO_BRAIN_COCKPIT_THEME`
  Default: `desert-night`
- `STUDIO_BRAIN_CONTROL_TOWER_URL`
  Default: `https://portal.monsoonfire.com/staff/cockpit/control-tower`
- `STUDIO_BRAIN_MOSH_UDP_RANGE`
  Default: `60000:61000`

## Notes

- The wrapper syncs only the tracked ops support files into the live host checkout, which avoids stomping unrelated dirty work on the host.
- `studio:ops:bambu:install` installs a pinned Bambu Studio Linux AppImage on the host, extracts it under `/opt/studiobrain/bambu-studio`, and links the repo-backed wrapper to `/usr/local/bin/studiobrain-bambu-cli`.
- `studio:ops:bambu:status` and `studio:ops:bambu:smoke` use the repo-backed wrapper on the host, which defaults to `xvfb-run` when the host is headless.
- The current pin is `v02.05.02.51` because the official 2.5.2 beta release notes call out a fix for a CLI segmentation fault, which matters more here than MakerWorld beta upload compatibility.
- `deploy-runtime` calls [`scripts/deploy-studio-brain-host.py`](./STUDIO_BRAIN_HOST_DEPLOY.md) from the current checkout, which is the repo-backed way to clear live runtime and integrity drift on the host.
- `install-stack` uses the existing SSH key path, escalates with the stored sudo password, and then runs the tracked Ansible playbook locally on the Ubuntu host.
- `install-stack` refreshes the tracked monitoring stack, the base CUPS print stack, and the periodic backup/disk/healthcheck timers, so `studio:ops:install` is the repo-backed way to reconcile those host resources after the runtime is current.
- `reconcile` is the normal merge/deploy sync cycle: full runtime deploy first, then stack install, then a fresh status snapshot.
- `status` now reports the remote checkout branch, head commit, and tracked dirty-file count under `workspace` so stale host branches are visible before they become integrity noise.
- `scripts/install-studiobrain-healthcheck.sh` now installs the backup, disk-alert, healthcheck, idle-worker, overnight idle-worker, and reboot-watch timers as one tracked bundle. The reboot watcher checks `/var/run/reboot-required` every 15 minutes and sends at most one Discord update per UTC day, only when the reboot-required state has changed, which is safer for the encrypted Studio Brain host than unattended auto-reboots.
- Monitoring runtime state stays host-local in `/home/wuff/monitoring`:
  - `.env` controls only `MONITORING_BIND_HOST`
  - Uptime Kuma sqlite data and generated admin credentials stay host-local and are not committed
- Legacy host-only `studiobrain-maintenance` and `studiobrain-fan-guardian` services are intentionally retired. If they show up again, treat that as drift rather than supported infrastructure.
- Direct access is intentionally narrowed to SSH, fail2ban, tmux recovery, and the tracked browser bridge. Tailscale and Teleport are retired and the installer now removes them if they drift back onto the host.
- The base host stack now gets CUPS queueing primitives by default; vendor-specific Star and SNBC printer drivers still need to be staged separately when the physical printers are introduced.
- The tmux helper now creates a recovery-first layout:
  - `control`: browser-first recovery guide
  - `brain`: working shell in `studio-brain/`
  - `scripts`: working shell in `scripts/`
  - `logs`: repo/log investigation shell
- Safe bounded actions still flow through `scripts/studiobrain-cockpit.mjs`, exposed remotely through `scripts/studiobrain-ops.py`, but the browser Control Tower is now the primary operator surface and should be the first command operators reach for.
- If `tailscaled` or `teleport` reappear in audits, treat that as host drift instead of supported infrastructure.
