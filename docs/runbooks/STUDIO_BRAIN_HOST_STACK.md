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
- the repo-backed monitoring sidecars under `config/studiobrain/monitoring`:
  - `netdata`
  - `uptime-kuma`
  - the `monitoring-proxy` Caddy bridge
- periodic host operations timers from `config/studiobrain/systemd`:
  - `studio-brain-backup.timer`
  - `studio-brain-disk-alert.timer`
  - `studio-brain-healthcheck.timer`
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
- `deploy-runtime` calls [`scripts/deploy-studio-brain-host.py`](./STUDIO_BRAIN_HOST_DEPLOY.md) from the current checkout, which is the repo-backed way to clear live runtime and integrity drift on the host.
- `install-stack` uses the existing SSH key path, escalates with the stored sudo password, and then runs the tracked Ansible playbook locally on the Ubuntu host.
- `install-stack` refreshes the tracked monitoring stack and the periodic backup/disk/healthcheck timers, so `studio:ops:install` is the repo-backed way to reconcile those host resources after the runtime is current.
- `reconcile` is the normal merge/deploy sync cycle: full runtime deploy first, then stack install, then a fresh status snapshot.
- `status` now reports the remote checkout branch, head commit, and tracked dirty-file count under `workspace` so stale host branches are visible before they become integrity noise.
- `scripts/install-studiobrain-healthcheck.sh` now installs the backup, disk-alert, healthcheck, and reboot-watch timers as one tracked bundle. The reboot watcher checks `/var/run/reboot-required` every 15 minutes and sends at most one Discord update per UTC day, only when the reboot-required state has changed, which is safer for the encrypted Studio Brain host than unattended auto-reboots.
- Monitoring runtime state stays host-local in `/home/wuff/monitoring`:
  - `.env` controls only `MONITORING_BIND_HOST`
  - Uptime Kuma sqlite data and generated admin credentials stay host-local and are not committed
- Legacy host-only `studiobrain-maintenance` and `studiobrain-fan-guardian` services are intentionally retired. If they show up again, treat that as drift rather than supported infrastructure.
- Direct access is intentionally narrowed to SSH, fail2ban, tmux recovery, and the tracked browser bridge. Tailscale and Teleport are retired and the installer now removes them if they drift back onto the host.
- The tmux helper now creates a recovery-first layout:
  - `control`: browser-first recovery guide
  - `brain`: working shell in `studio-brain/`
  - `scripts`: working shell in `scripts/`
  - `logs`: repo/log investigation shell
- Safe bounded actions still flow through `scripts/studiobrain-cockpit.mjs`, exposed remotely through `scripts/studiobrain-ops.py`, but the browser Control Tower is now the primary operator surface and should be the first command operators reach for.
- If `tailscaled` or `teleport` reappear in audits, treat that as host drift instead of supported infrastructure.
