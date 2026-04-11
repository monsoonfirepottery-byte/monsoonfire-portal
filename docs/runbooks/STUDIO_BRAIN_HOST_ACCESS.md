# Studio Brain Host Access

Use this runbook when Codex needs durable direct access to the Studio Brain Ubuntu host at `192.168.1.226` without depending on ad hoc manual SSH setup.

## Source of truth

- CLI access helper: `scripts/studiobrain-host-access.py`
- Remote ops wrapper: `scripts/studiobrain-ops.py`
- Deploy path: `scripts/deploy-studio-brain-host.py`
- Shared SSH/fail2ban logic: `scripts/lib/studiobrain_host_access.py`
- Remote fail2ban installer: `scripts/install-studiobrain-fail2ban-sshd.sh`
- Tracked jail config: `config/studiobrain/fail2ban/sshd.local`

## Commands

```powershell
npm run studio:host:access:check
npm run studio:host:access:bootstrap
npm run studio:host:fail2ban:install
npm run studio:host:relay:status
npm run studio:host:deploy
npm run studio:ops:install
npm run studio:ops:status
```

From the `scripts/` directory on Linux:

```bash
bash ./studiobrain-host-access.sh check --json
bash ./studiobrain-host-access.sh bootstrap-access --json
python3 ./studiobrain-host-access.py relay-status --json
```

For arbitrary remote commands:

```powershell
npm run studio:host:run -- "systemctl --user status studio-brain.service --no-pager"
```

## What bootstrap does

- creates a dedicated local SSH key at `~/.ssh/studiobrain-codex` when one does not already exist
- hardens that private key so Windows OpenSSH accepts it in batch mode
- writes or refreshes a managed `Host studiobrain` block in `~/.ssh/config`
- connects to the host using the currently configured auth path
- installs the Codex public key into the remote `~/.ssh/authorized_keys`
- refreshes the tracked fail2ban sshd jail with the current management IP allowlist unless `--skip-fail2ban` is used
- reconnects using the dedicated key to verify Codex-owned access works
- on Windows, verifies the `studiobrain` alias with the explicit native OpenSSH client at `C:\Windows\System32\OpenSSH\ssh.exe`

## Secrets and optional knobs

Primary env file:

- `secrets/studio-brain/studio-brain-mcp.env`

Required keys:

- `STUDIO_BRAIN_DEPLOY_HOST`
- `STUDIO_BRAIN_DEPLOY_PORT`
- `STUDIO_BRAIN_DEPLOY_USER`
- `STUDIO_BRAIN_MCP_BASE_URL`

At least one auth path must be present:

- `STUDIO_BRAIN_DEPLOY_PASSWORD`
- `STUDIO_BRAIN_DEPLOY_KEY_PATH`

Optional keys:

- `STUDIO_BRAIN_DEPLOY_HOST_ALIAS`
  Default: `studiobrain`
- `STUDIO_BRAIN_FAIL2BAN_IGNORE_IPS`
  Space- or comma-separated extra IPs/CIDRs to keep outside the sshd jail. The helper also auto-detects the current routed local management IP and adds it as a CIDR.

## Notes

- The SSH helper disables agent and implicit key probing during password auth, which avoids the "too many authentication failures" foot-gun that can trip fail2ban.
- On Windows, treat `C:\Windows\System32\OpenSSH\ssh.exe` as the authoritative SSH client for Studio Brain. Do not rely on whichever `ssh.exe` happens to be first on `PATH`; Git-for-Windows and MSYS clients can behave differently.
- The tracked fail2ban file only keeps loopback by default. The installer injects the current management IP allowlist at install time so the repo does not fossilize one old laptop address.
- `studio:host:deploy` now refreshes the fail2ban allowlist as part of deploy, so deploy and steady-state access stay aligned.
- The current source of truth for direct server control is the CLI helper above, with `scripts/studiobrain-ops.py` as the thin higher-level wrapper for tmux, mosh, Ansible, and the browser bridge workflows.
- Tailscale and Teleport are intentionally retired on the Studio Brain host. If either shows up again, treat that as drift rather than supported access.
- `mcp_servers.ssh_mcp` is still a placeholder until a real SSH MCP transport is added.
