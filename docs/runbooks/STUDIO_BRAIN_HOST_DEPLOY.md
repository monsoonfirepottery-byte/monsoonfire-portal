# Studio Brain Host Deploy

Use this when the live Studio Brain host at `192.168.1.226` has drifted away from the tracked repo and needs a clean runtime refresh from the local checkout.

Primary host-access runbook:

- [`STUDIO_BRAIN_HOST_ACCESS.md`](./STUDIO_BRAIN_HOST_ACCESS.md)

## What it does

- builds the local [`studio-brain`](../../studio-brain) package first
- archives the local `studio-brain` tree plus the posture/integrity scripts needed for live-host verification, excluding host-only runtime files like `.env`, `.env.local`, `node_modules`, `output`, and logs
- includes the Discord relay script plus its systemd install assets so the server-side discussion poller and reply loop stay in lockstep with repo changes
- includes the tracked monitoring stack config and periodic host timer assets so host-side support resources can be reconciled from source control instead of ad hoc box edits
- uploads that archive to the remote host
- syncs the gitignored `secrets/studio-brain/discord-mcp.env` file to the remote host when present locally
- mirrors the Discord ingest allowlist and runtime Discord IDs into the host `studio-brain/.env.local` before restart so `/api/memory/ingest` is actually enabled on the live service
- moves known host-only drift paths from [`host-drift-allowlist.json`](../../studio-brain/host-drift-allowlist.json) out of the active runtime into a timestamped backup directory
- extracts the repo-backed runtime over `/home/wuff/monsoonfire-portal/studio-brain`
- prefers SSH key auth when `STUDIO_BRAIN_DEPLOY_KEY_PATH` or the managed `~/.ssh/studiobrain-codex` key is available, then falls back to password auth without agent/key spray
- ensures `STUDIO_BRAIN_ADMIN_TOKEN` exists in the host `.env.local` before restart so Gate D dual-control can be exercised on the live runtime
- refreshes the tracked fail2ban sshd jail on the host using the current management IP allowlist before restart so Codex does not strand its own SSH lane
- restarts the service from `node lib/index.js` using the host’s `.env` and `.env.local`
- installs or refreshes `studio-brain-discord-relay.service` on the host as the persistent Gateway listener and keeps the timer file only as a fallback artifact
- refreshes authoritative backup evidence plus ops-cockpit heartbeat artifacts, then runs the live-host posture check and local privileged auth probe before declaring the deploy healthy

## Command

```powershell
python .\scripts\deploy-studio-brain-host.py --json
npm run studio:ops:deploy
npm run studio:ops:reconcile
```

- `studio:ops:deploy` is the wrapper alias for the full runtime deploy.
- `studio:ops:reconcile` runs the full runtime deploy, then the tracked host-stack install, then captures a fresh status snapshot.

## Secrets

The script reads remote connection details from the gitignored secret file:

- `D:\monsoonfire-portal\secrets\studio-brain\studio-brain-mcp.env`

Required keys:

- `STUDIO_BRAIN_DEPLOY_HOST`
- `STUDIO_BRAIN_DEPLOY_PORT`
- `STUDIO_BRAIN_DEPLOY_USER`
- `STUDIO_BRAIN_MCP_BASE_URL`

At least one auth path must be present:

- `STUDIO_BRAIN_DEPLOY_PASSWORD`
- `STUDIO_BRAIN_DEPLOY_KEY_PATH`

Optional access-hardening keys:

- `STUDIO_BRAIN_DEPLOY_HOST_ALIAS`
- `STUDIO_BRAIN_FAIL2BAN_IGNORE_IPS`

## Current drift paths

These host-only paths are moved into a backup directory before the repo-backed runtime is activated:

- `src/autonomic`
- `lib/autonomic`
- `lib/loopDriver.js`

## Verification

The deploy is only considered healthy if:

- the local `studio-brain` build passes before upload
- the remote service restarts cleanly
- the remote fail2ban sshd allowlist refresh succeeds
- the remote Discord relay service installs cleanly and stays active as the long-running listener
- the remote authoritative posture check passes:
  - `node ./scripts/studiobrain-status.mjs --json --require-safe --mode live_host_authoritative --approved-remote-runner`
- the remote authoritative backup freshness check passes:
  - `node ./scripts/studiobrain-backup-drill.mjs verify --freshness-only --json --strict --mode live_host_authoritative --approved-remote-runner`
- the remote full backup verification refresh succeeds before the freshness gate is evaluated:
  - `node ./scripts/studiobrain-backup-drill.mjs verify --json --strict --mode live_host_authoritative --approved-remote-runner`
- the remote ops cockpit heartbeat refresh succeeds:
  - `node ./scripts/ops-cockpit.mjs start --json`
- the local privileged auth matrix passes against the live host:
  - `node ./scripts/test-studio-brain-auth.mjs --json --mode authenticated_privileged_check --base-url <live-base-url>`
- the latest log tail does not reintroduce `autonomic_loop_driver_resume_failed`

## Notes

- This deploy path intentionally starts the host from the prebuilt `lib` tree. It does not rely on a remote TypeScript build, because the host may contain runtime-only drift that is not part of the tracked repo.
- If any deploy blocker trips, treat the result as `shadow_fallback_required`: keep the lane in shadow mode, capture the incident bundle, and use human signoff before trying to re-enable fail-closed deploy enforcement.
- If the backup directory captures unexpected runtime-only source, reconcile that code into the repo or remove it from the host on purpose before the next deploy.
- The Discord relay install expects the remote host to have Docker available because the installer reuses the host-side chroot pattern from the existing Studio Brain healthcheck install flow.
