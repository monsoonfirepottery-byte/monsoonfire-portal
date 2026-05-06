#!/usr/bin/env bash
set -u

# Read-only network exposure review for Studio Brain.
# This script does not change firewall rules, SSH config, PostgreSQL config, or Docker state.
# It avoids printing process environments and secrets. Review output before sharing externally.

PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

postgres_review() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
    printf '\n$ docker exec -u postgres %s psql -d %s -X -v ON_ERROR_STOP=1\n' "${PG_CONTAINER}" "${PGDATABASE}"
    docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -v ON_ERROR_STOP=1 <<'SQL' 2>&1 || printf 'WARN: PostgreSQL Docker review failed\n'
\pset pager off
\pset border 2
\pset null '(null)'

select name, setting
from pg_settings
where name in ('listen_addresses', 'port', 'ssl', 'password_encryption')
order by name;

select line_number, type, database, user_name, address, auth_method, error
from pg_hba_file_rules
order by line_number;

select coalesce(client_addr::text, 'local') as client_addr,
       usename,
       application_name,
       state,
       count(*) as connections
from pg_stat_activity
group by 1, 2, 3, 4
order by connections desc, client_addr, usename, application_name, state;

select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
from pg_roles
order by rolname;
SQL
  elif command -v psql >/dev/null 2>&1; then
    printf '\n$ PGCONNECT_TIMEOUT=5 psql -w -X -v ON_ERROR_STOP=1\n'
    PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}" psql -w -X -v ON_ERROR_STOP=1 <<'SQL' 2>&1 || printf 'WARN: PostgreSQL psql review failed. Set PGHOST/PGPORT/PGDATABASE/PGUSER as needed.\n'
\pset pager off
\pset border 2
\pset null '(null)'

select name, setting
from pg_settings
where name in ('listen_addresses', 'port', 'ssl', 'password_encryption')
order by name;

select line_number, type, database, user_name, address, auth_method, error
from pg_hba_file_rules
order by line_number;

select coalesce(client_addr::text, 'local') as client_addr,
       usename,
       application_name,
       state,
       count(*) as connections
from pg_stat_activity
group by 1, 2, 3, 4
order by connections desc, client_addr, usename, application_name, state;

select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
from pg_roles
order by rolname;
SQL
  else
    printf 'PostgreSQL review unavailable: neither Docker container %s nor psql was available.\n' "${PG_CONTAINER}"
    printf 'Set PG_CONTAINER/PGDATABASE or PGHOST/PGPORT/PGDATABASE/PGUSER and rerun.\n'
  fi
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'scope: read_only_network_exposure_review\n'
printf 'safety: no_firewall_changes_no_ssh_changes_no_postgres_changes_no_restarts\n'

section "Local Addresses And Routes"
run_shell "ip -br addr 2>/dev/null || ifconfig 2>/dev/null || true"
run_shell "ip route 2>/dev/null | sed -n '1,80p' || true"

section "Listening Ports"
run_shell "(sudo -n ss -tulpen 2>/dev/null || ss -tulpen 2>/dev/null || ss -tuln 2>/dev/null) | sed -E 's/pid=[0-9]+/pid=REDACTED/g' | sed -n '1,220p'"
run_shell "command -v docker >/dev/null 2>&1 && docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' || true"
run_shell "command -v docker >/dev/null 2>&1 && docker ps -q | while read -r id; do docker inspect --format '{{.Name}} ports={{json .NetworkSettings.Ports}}' \"\$id\"; docker inspect --format '{{.Name}} networks={{range \$name,\$net := .NetworkSettings.Networks}}{{\$name}}={{\$net.IPAddress}} {{end}}' \"\$id\"; done || true"

section "Firewall Posture"
run_shell "command -v ufw >/dev/null 2>&1 && (sudo -n ufw status verbose 2>/dev/null || ufw status verbose 2>/dev/null || echo 'ufw status requires privileged read') || echo 'ufw command unavailable'"
run_shell "systemctl is-enabled ufw 2>/dev/null || true"
run_shell "systemctl is-active ufw 2>/dev/null || true"
run_shell "command -v nft >/dev/null 2>&1 && (sudo -n nft list ruleset 2>/dev/null || nft list ruleset 2>/dev/null) | awk 'NR<=220 {print} END {if (NR==0) print \"nft ruleset requires privileged read or is empty\"}' || true"
run_shell "command -v iptables-save >/dev/null 2>&1 && (sudo -n iptables-save 2>/dev/null || iptables-save 2>/dev/null) | awk 'NR<=220 {print} END {if (NR==0) print \"iptables rules require privileged read or are empty\"}' || true"

section "SSH Authentication Posture"
run_shell "command -v sshd >/dev/null 2>&1 && { out=\"\$( (sudo -n sshd -T 2>/dev/null || sshd -T 2>/dev/null) | awk '/^(port|listenaddress|passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|pubkeyauthentication|permitrootlogin|authenticationmethods|allowusers|allowgroups|usepam|maxauthtries|logingracetime|clientaliveinterval|clientalivecountmax)[[:space:]]/ {print}' | sort )\"; test -n \"\$out\" && printf '%s\n' \"\$out\" || echo 'sshd -T unavailable or returned no selected settings'; } || echo 'sshd command unavailable'"
run_shell "grep -RhsE '^[[:space:]]*(Port|ListenAddress|PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PubkeyAuthentication|PermitRootLogin|AuthenticationMethods|AllowUsers|AllowGroups|UsePAM|MaxAuthTries|ClientAliveInterval|ClientAliveCountMax|Match)[[:space:]]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sed -E 's/[[:space:]]+#.*$//' | sed -n '1,160p' || true"
run_shell "systemctl is-enabled ssh 2>/dev/null || systemctl is-enabled sshd 2>/dev/null || true"
run_shell "systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || true"
run_shell "systemctl is-active fail2ban 2>/dev/null || true"
run_shell "command -v fail2ban-client >/dev/null 2>&1 && (sudo -n fail2ban-client status 2>/dev/null || fail2ban-client status 2>/dev/null || echo 'fail2ban status requires privileged read') || true"

section "PostgreSQL Exposure"
run_shell "(sudo -n ss -ltnp 2>/dev/null || ss -ltnp 2>/dev/null || ss -ltn 2>/dev/null) | grep -E '(:5432|:5433)[[:space:]]' | sed -E 's/pid=[0-9]+/pid=REDACTED/g' || true"
postgres_review

section "Approval-Gated Hardening Worklist"
cat <<'EOF'
Use this table to turn the read-only evidence into a safe hardening decision.

| Area | Decision needed | Evidence to attach | Approval gate |
| --- | --- | --- | --- |
| PostgreSQL listener | bind to loopback, keep LAN listener, or restrict with firewall | listener socket, listen_addresses, pg_hba_file_rules, active client list | DB connectivity change requires human and DBA approval |
| PostgreSQL clients | identify every legitimate app, backup, DBA, and diagnostic client | pg_stat_activity client_addr/application_name summary | unknown clients must be investigated before blocking |
| Firewall | keep inactive, enable UFW, or manage rules elsewhere | ufw/nft/iptables output and open listener list | firewall changes require console/rollback access |
| SSH auth | keep password/kbdinteractive temporarily or move to key-only | sshd -T auth settings and verified working keys | disabling password auth requires second key or console path |
| Fail2ban | confirm active jail coverage for SSH | fail2ban status and auth posture | changing bans/jails requires approval |
EOF

section "Safe Next Steps"
cat <<'EOF'
1. Run this report from the Studio Brain host and save the output with restricted permissions.
2. Identify every non-loopback PostgreSQL client before changing bind addresses or firewall rules.
3. Open a second SSH session and verify at least two key-based access paths before SSH hardening.
4. Prepare rollback notes before any firewall change:
   - how to disable the new firewall rule
   - how to restore the previous PostgreSQL listen_addresses/pg_hba.conf
   - how to restore the previous sshd_config
   - how to regain access through console or local admin path
5. Schedule an approved maintenance window for any actual hardening change.
EOF
