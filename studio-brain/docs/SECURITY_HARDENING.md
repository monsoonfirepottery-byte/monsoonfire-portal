# Studio Brain Security Hardening

This runbook keeps the internet-facing Studio Brain host narrow by default:

- public: `80/443` only
- local only: `8787`, `5433`, `6379`, `9010`, `9011`, `4317`, `4318`, `8889`
- loopback CrowdSec API: `127.0.0.1:18082`

## What is now automated in-repo

1. Loopback-only bind defaults for Postgres, Redis, MinIO, and OTEL in `studio-brain/docker-compose.yml`.
2. Loopback Studio Brain upstream for the public Caddy edge in `studio-brain/docker-compose.public-proxy.yml`.
3. Structured public access logs at `output/security/public-proxy/access.log`.
4. CrowdSec support with `crowdsecurity/linux`, `crowdsecurity/caddy`, and `crowdsecurity/sshd`.
5. One-shot security scan bundle with Trivy, security-history-scan, and the Studio Brain public-surface scan.
6. Secret rotation helper for Postgres, Redis, and MinIO plus `.env` permission tightening.

## Daily commands

```bash
npm run studio:security:scan
npm run studio:security:up
npm run studio:security:status
npm run studio:security:host-audit
npm run studio:security:root:print
npm run studio:security:down
npm run studio:secret:rotate -- --apply
```

Artifacts land under:

- `output/security/studiobrain`
- `output/security/public-proxy`

## Root-required steps still needed on the host

These were not applied from this shell because they require `sudo` or host package management.

Use the repo automation to print the exact root command:

```bash
npm run studio:security:root:print
```

The root script now runs in phases so package install, SSH hardening, and UFW rollout are not coupled together.

Safe sequence:

```bash
sudo node ./scripts/studiobrain-root-hardening.mjs --apply
sudo node ./scripts/studiobrain-root-hardening.mjs --apply --phases firewall --i-confirm-second-ssh --ssh-allow-cidr 192.168.1.141/32 --ssh-allow-cidr 192.168.1.0/24 --monitor-allow-cidr 192.168.1.0/24
sudo ufw show added
sudo node ./scripts/studiobrain-root-hardening.mjs --apply --phases firewall --enable-ufw --rollback-window 5m --i-confirm-second-ssh --ssh-allow-cidr 192.168.1.141/32 --ssh-allow-cidr 192.168.1.0/24 --monitor-allow-cidr 192.168.1.0/24
# validate from both SSH sessions and the admin workstation, then cancel the printed rollback timer
sudo node ./scripts/studiobrain-root-hardening.mjs --apply --phases ssh --i-confirm-second-ssh
```

If you administer the box from a public IP or VPN instead of the LAN, add that CIDR to `--ssh-allow-cidr` before enabling UFW.

Every apply run writes a rollback script under `/var/backups/studiobrain-hardening/<timestamp>/rollback.sh`.
When `--enable-ufw` is used, the script now arms a transient `systemd-run` rollback timer first and prints the exact timer name plus the cancel command.
If validation fails or your shells drop, let the timer fire and restore the prior firewall state automatically.
If you are already on the console and want to recover immediately, use:

```bash
sudo ufw disable
sudo sh /var/backups/studiobrain-hardening/<timestamp>/rollback.sh
```

### 1. UFW policy

The repo script stages UFW rules without enabling them first.

- Public: `80/tcp`, `443/tcp`, `443/udp`
- Admin: `22/tcp` only from the CIDRs you pass with `--ssh-allow-cidr`
- Monitoring: `18080/tcp`, `18081/tcp` only from the CIDRs you pass with `--monitor-allow-cidr`
- Legacy cleanup: the firewall phase removes broad SSH allow rules like `ufw allow OpenSSH` before you enable UFW, so old host-wide SSH exceptions do not silently survive the hardening pass
- Guarded enable: `--enable-ufw` is now rollback-guarded by default and is only allowed with `--phases firewall`
- Docker note: the script intentionally preserves the current `routed` policy by default because this host uses Docker-managed internet services. Do not force `ufw default deny routed` without a Docker-specific review and an out-of-band recovery path.

### 2. SSH recovery removal

Review `/etc/ssh/sshd_config.d/99-recovery.conf` and return it to key-only auth only after one guarded UFW rollout succeeds cleanly and a second SSH session remains healthy.

Recommended target:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
```

Then:

```bash
sudo systemctl reload ssh
```

### 3. Fail2Ban allowlist sanity-check

Keep the current management IPs in the SSH jail `ignoreip` list before tightening bans or enabling CrowdSec remediation for SSH.

### 4. Lynis, AIDE, and Falco

The root script installs and configures:

- `Lynis`: weekly host hardening audit via `/etc/cron.weekly/studiobrain-lynis`
- `AIDE`: focused config integrity via `/etc/aide/aide.conf.d/90_studiobrain_local` plus the package-native `dailyaidecheck.timer`
- `Falco`: still intentionally deferred until you are ready for the extra runtime noise and host capabilities

Falco needs additional host capability work. The official container guidance currently uses the modern eBPF path with `SYS_ADMIN`, `SYS_RESOURCE`, and `SYS_PTRACE`, plus host mounts for `/sys/kernel/tracing`, `/proc`, `/etc`, and the Docker socket.

## Validation checklist

1. `npm run studio:secret:rotate -- --apply`
2. `npm run studio:security:up`
3. `npm run studio:security:scan`
4. `curl -I https://brain.monsoonfire.com`
5. `nc -vz 192.168.1.226 5433` should fail from another LAN client once firewall rules are applied
6. `systemctl --user status studio-brain.service studiobrain-public-proxy.service`
