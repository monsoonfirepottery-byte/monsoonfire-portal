# Studio Brain Network Exposure Review

Snapshot: 2026-05-06 01:10 UTC, captured read-only with `scripts/ops/network_exposure_review.sh` over SSH alias `studiobrain`.

This note is evidence and decision support only. It does not approve firewall changes, SSH changes, PostgreSQL bind changes, Docker restarts, or service restarts.

## Summary

Studio Brain has several intentional LAN/local listeners, but PostgreSQL is the highest-risk exposure candidate because Docker publishes it on both IPv4 and IPv6 wildcard host addresses:

- `0.0.0.0:5433 -> studiobrain_postgres:5432`
- `[::]:5433 -> studiobrain_postgres:5432`
- PostgreSQL reports `listen_addresses='*'`.
- `pg_hba_file_rules` allows `host all all all scram-sha-256`.

At capture time, active PostgreSQL clients were only local/container-bridge clients (`local` and `172.20.0.1/32`). No external PostgreSQL client was observed in `pg_stat_activity`, but that is a point-in-time observation, not proof that no external clients ever connect.

The host also has a global IPv6 address on `wlp3s0`. Because PostgreSQL, SSH, and Postfix listen on `[::]`, external reachability must be verified from outside the host and from the LAN before hardening decisions are made.

## Current Non-Loopback Listeners

Observed non-loopback listeners:

| Listener | Component | Notes |
| --- | --- | --- |
| `0.0.0.0:22`, `[::]:22` | SSH | Remote administration path; hardening requires verified alternate access. |
| `0.0.0.0:25`, `[::]:25` | Postfix | Mail role unknown from this slice. |
| `0.0.0.0:5433`, `[::]:5433` | PostgreSQL Docker publish | Highest priority review item. |
| `192.168.1.226:8787` | Studio Brain API | LAN API; existing app behavior depends on this. |
| `192.168.1.226:18080-18081` | monitoring proxy | LAN-bound monitoring proxy. |
| `0.0.0.0/5353`, `[::]/5353` | Avahi | Service-discovery exposure; likely local-network only but should be intentional. |

Most other Studio Brain dependency ports were loopback-only at capture time, including Redis, MinIO, SearXNG, Netdata, Uptime Kuma, OpenTelemetry, Mission Control, and the Control Tower proxy.

## Firewall Status

Evidence:

- `systemctl is-enabled ufw` returned `enabled`.
- `systemctl is-active ufw` returned `active`.
- Non-root `ufw status verbose` returned `ufw status requires privileged read`.
- Non-root `nft list ruleset` and `iptables-save` did not expose rules.

Disposition:

- Treat firewall rule coverage as unknown until a privileged read-only check is captured.
- Do not assume wildcard listeners are blocked by UFW based only on `systemctl is-active ufw`.

Safe next step:

- Run, with human approval for privileged read-only inspection:
  - `sudo ufw status numbered verbose`
  - `sudo nft list ruleset`
  - `sudo iptables-save`

## PostgreSQL Exposure

Evidence:

- Docker publishes `studiobrain_postgres` as `0.0.0.0:5433->5432/tcp` and `[::]:5433->5432/tcp`.
- PostgreSQL settings:
  - `listen_addresses='*'`
  - `port=5432`
  - `ssl=off`
  - `password_encryption=scram-sha-256`
- `pg_hba_file_rules` includes:
  - local trust rules
  - loopback trust rules
  - `host all all all scram-sha-256`
- Current observed clients were `local` and `172.20.0.1/32`; no non-host LAN/WAN PostgreSQL client was active during the snapshot.
- The only login-capable role listed by the read-only review was `postgres`, which is also superuser.

Likely impact:

- If PostgreSQL credentials leak or LAN/IPv6 exposure is broader than expected, the database is reachable without first entering an SSH tunnel or local Docker network.
- Using the `postgres` superuser for app connections increases blast radius compared with an app-specific least-privilege role.

Recommended action:

1. Identify all legitimate PostgreSQL clients: app, backup tooling, DBA access, diagnostics, and any remote automation.
2. If all legitimate clients are local, prepare an approved change to bind the Docker-published host port to loopback only.
3. If LAN DBA access is required, use firewall allowlisting and documented SSH-tunnel alternatives.
4. Create an app-specific PostgreSQL role plan separately; do not combine role changes with listener hardening.

Approval gate:

- Any PostgreSQL bind, `pg_hba.conf`, Docker Compose port mapping, firewall, or role change requires human and DBA approval.

Rollback notes:

- Revert the Compose port mapping and recreate only the PostgreSQL container during an approved window.
- Restore prior `pg_hba.conf`/PostgreSQL config and reload/restart under the same window.
- Keep the prior working DBA connection method open until post-checks pass.

## SSH Exposure

Evidence:

- SSH listens on `0.0.0.0:22` and `[::]:22`.
- `systemctl is-enabled ssh` returned `enabled`.
- `systemctl is-active ssh` returned `active`.
- Readable SSH config fragments included:
  - `PasswordAuthentication yes`
  - `KbdInteractiveAuthentication yes`
  - `AuthenticationMethods any`
  - `UsePAM yes`
- This non-root run could not get effective `sshd -T` output, so the exact effective posture still needs privileged confirmation.
- `fail2ban` is active, but jail details required privileged read.

Disposition:

- Treat key-only hardening as desirable but approval-gated.
- Do not disable password or keyboard-interactive auth until at least two key-based access paths or an out-of-band console path are verified.

Safe next step:

- Run a privileged effective-config read:
  - `sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|pubkeyauthentication|permitrootlogin|authenticationmethods|usepam|maxauthtries)'`
- Confirm fail2ban jail coverage:
  - `sudo fail2ban-client status`
  - `sudo fail2ban-client status sshd`

Rollback notes:

- Keep a second live SSH session open before changing `sshd_config`.
- Validate `sshd -t` before reload.
- Reload, not restart, when possible.
- Roll back by restoring the previous SSH config and reloading SSH from the still-open session or console.

## Approval-Gated Hardening Candidates

| Candidate | Benefit | Risk | Safe next step | Rollback |
| --- | --- | --- | --- | --- |
| Bind PostgreSQL host port to `127.0.0.1` | Removes LAN/IPv6 direct DB reachability | Can break remote DBA/backups if they rely on direct port 5433 | Identify clients and test app/backup/DBA paths in a window | Restore previous Compose port mapping and recreate container |
| Add UFW allowlist/deny rules for `5433` | Limits DB reachability without changing container config | Firewall mistakes can lock out access or break clients | Capture privileged rules and console path first | `sudo ufw delete <rule>` from console/second session |
| Move SSH to key-only auth | Reduces brute-force/password exposure | Can lock out admin access | Verify two keys or console path first | Restore prior sshd config from open session |
| Review Postfix listener | Clarifies whether inbound SMTP is intentional | Mail delivery can break if disabled blindly | Identify mail role and dependencies | Restore prior Postfix config/service state |
| Review Avahi listener | Reduces service-discovery noise if not needed | Local discovery may rely on it | Inventory dependent devices/services | Re-enable Avahi if needed |

## Verification Checklist Before Any Hardening PR

- `make ops-network-review`
- `make ops-backup-evidence`
- `make ops-docker-review`
- Studio Brain `/healthz`, `/readyz`, and `/health/dependencies`
- Confirm SSH access from a second shell.
- Capture privileged firewall and SSH effective-config reads.
- Identify every active and expected PostgreSQL client.
- Write exact rollback commands in the PR body before applying changes.

## PR Boundary

This slice adds diagnostics and documentation only. A future PR can propose concrete bind/firewall/SSH changes after privileged evidence and human approval are available.
