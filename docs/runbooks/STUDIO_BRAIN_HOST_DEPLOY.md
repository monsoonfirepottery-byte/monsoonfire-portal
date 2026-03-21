# Studio Brain Host Deploy

Use this when the live Studio Brain host at `192.168.1.226` has drifted away from the tracked repo and needs a clean runtime refresh from the local checkout.

## What it does

- builds the local [`studio-brain`](/D:/monsoonfire-portal/studio-brain) package first
- archives the local `studio-brain` tree, excluding host-only runtime files like `.env`, `.env.local`, `node_modules`, `output`, and logs
- uploads that archive to the remote host
- moves known host-only drift paths out of the active runtime into a timestamped backup directory
- extracts the repo-backed runtime over `/home/wuff/monsoonfire-portal/studio-brain`
- restarts the service from `node lib/index.js` using the host’s `.env` and `.env.local`

## Command

```powershell
python D:\monsoonfire-portal\scripts\deploy-studio-brain-host.py --json
```

## Secrets

The script reads remote connection details from the gitignored secret file:

- `D:\monsoonfire-portal\secrets\studio-brain\studio-brain-mcp.env`

Required keys:

- `STUDIO_BRAIN_DEPLOY_HOST`
- `STUDIO_BRAIN_DEPLOY_PORT`
- `STUDIO_BRAIN_DEPLOY_USER`
- `STUDIO_BRAIN_DEPLOY_PASSWORD`
- `STUDIO_BRAIN_MCP_BASE_URL`

## Current drift paths

These host-only paths are moved into a backup directory before the repo-backed runtime is activated:

- `src/autonomic`
- `lib/autonomic`
- `lib/loopDriver.js`

## Verification

The deploy is only considered healthy if:

- the local `studio-brain` build passes before upload
- the remote service restarts cleanly
- `GET /healthz` returns `200`
- the latest log tail does not reintroduce `autonomic_loop_driver_resume_failed`

## Notes

- This deploy path intentionally starts the host from the prebuilt `lib` tree. It does not rely on a remote TypeScript build, because the host may contain runtime-only drift that is not part of the tracked repo.
- If the backup directory captures unexpected runtime-only source, reconcile that code into the repo or remove it from the host on purpose before the next deploy.
