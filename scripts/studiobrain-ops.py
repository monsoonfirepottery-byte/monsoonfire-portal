#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import json
import shlex
import subprocess
import sys

SCRIPTS_LIB = Path(__file__).resolve().parent / "lib"
if str(SCRIPTS_LIB) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_LIB))

from studiobrain_host_access import (
    connect_studiobrain_ssh,
    load_studiobrain_deploy_env,
    read_remote_identity,
    resolve_windows_openssh_binary,
    ssh_exec,
    sudo_ssh_exec,
    upload_repo_support_paths,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = REPO_ROOT / "secrets" / "studio-brain" / "studio-brain-mcp.env"
HOME_STUDIO_MCP_ENV_PATH = Path.home() / "secrets" / "studio-brain" / "studio-brain-mcp.env"
REMOTE_PARENT = "/home/wuff/monsoonfire-portal"
NAMECHEAP_SSH_ALIAS = "monsoonfire"
DEFAULT_NAMECHEAP_TUNNEL_TARGET = "monsggbd@66.29.137.142"
DEFAULT_NAMECHEAP_TUNNEL_PORT = 21098
DEFAULT_NAMECHEAP_TUNNEL_REMOTE_HOST = "127.0.0.1"
DEFAULT_NAMECHEAP_TUNNEL_REMOTE_PORT = 18787
DEFAULT_STUDIO_BRAIN_PROXY_HOST = "127.0.0.1"
DEFAULT_STUDIO_BRAIN_PROXY_PORT = 18788
SUPPORT_PATHS = (
    REPO_ROOT / "config" / "studiobrain" / "ansible",
    REPO_ROOT / "config" / "studiobrain" / "monitoring",
    REPO_ROOT / "config" / "studiobrain" / "systemd",
    REPO_ROOT / "config" / "studiobrain" / "tmux",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_CONTROL_TOWER_V2.md",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_HOST_ACCESS.md",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_HOST_STACK.md",
    REPO_ROOT / "scripts" / "install-studiobrain-healthcheck.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-monitoring.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-ops-stack.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-portal-bridge.sh",
    REPO_ROOT / "scripts" / "studiobrain-cockpit.mjs",
    REPO_ROOT / "scripts" / "studiobrain-control-tower-proxy.mjs",
    REPO_ROOT / "scripts" / "studiobrain-host-access.py",
    REPO_ROOT / "scripts" / "studiobrain-host-access.sh",
    REPO_ROOT / "scripts" / "studiobrain-tmux-session.sh",
    REPO_ROOT / "scripts" / "lib" / "studiobrain_host_access.py",
    REPO_ROOT / "studio-brain" / "lib" / "controlTower",
)
REMOTE_ENV_KEYS = (
    "STUDIO_BRAIN_DEPLOY_USER",
    "STUDIO_BRAIN_TAILSCALE_AUTH_KEY",
    "STUDIO_BRAIN_TAILSCALE_HOSTNAME",
    "STUDIO_BRAIN_TAILSCALE_EXTRA_ARGS",
    "STUDIO_BRAIN_TAILSCALE_UDP_PORT",
    "STUDIO_BRAIN_MOSH_UDP_RANGE",
    "STUDIO_BRAIN_TMUX_SESSION_NAME",
    "STUDIO_BRAIN_COCKPIT_THEME",
    "STUDIO_BRAIN_CONTROL_TOWER_URL",
    "STUDIO_BRAIN_TELEPORT_VERSION",
    "STUDIO_BRAIN_TELEPORT_CLUSTER_NAME",
    "STUDIO_BRAIN_TELEPORT_PUBLIC_ADDR",
    "STUDIO_BRAIN_TELEPORT_ACME_EMAIL",
    "STUDIO_BRAIN_TELEPORT_CERT_FILE",
    "STUDIO_BRAIN_TELEPORT_KEY_FILE",
)


def load_env() -> dict[str, str]:
    return load_studiobrain_deploy_env(
        env_path=ENV_PATH,
        home_env_path=HOME_STUDIO_MCP_ENV_PATH,
    )


def resolve_control_tower_url(env: dict[str, str]) -> str:
    return str(env.get("STUDIO_BRAIN_CONTROL_TOWER_URL", "")).strip() or "https://portal.monsoonfire.com/staff/cockpit/control-tower"


def build_remote_env_prefix(env: dict[str, str]) -> str:
    values = {
        "STUDIO_BRAIN_REMOTE_PARENT": REMOTE_PARENT,
    }
    for key in REMOTE_ENV_KEYS:
        value = str(env.get(key, "")).strip()
        if value:
            values[key] = value
    return " ".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def build_remote_cockpit_command(env: dict[str, str], *script_args: str) -> str:
    env_prefix = build_remote_env_prefix(env)
    quoted_args = " ".join(shlex.quote(str(value)) for value in script_args if str(value or "").strip())
    return (
        f"cd {shlex.quote(REMOTE_PARENT)} && "
        f"{env_prefix} node ./scripts/studiobrain-cockpit.mjs {quoted_args}"
    )


def resolve_namecheap_tunnel_settings() -> dict[str, object]:
    ssh_binary = resolve_windows_openssh_binary("ssh.exe") or "ssh"
    settings = {
        "alias": NAMECHEAP_SSH_ALIAS,
        "sshBinary": ssh_binary,
        "target": DEFAULT_NAMECHEAP_TUNNEL_TARGET,
        "port": DEFAULT_NAMECHEAP_TUNNEL_PORT,
    }
    try:
        result = subprocess.run(
            [ssh_binary, "-G", NAMECHEAP_SSH_ALIAS],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return settings
    if result.returncode != 0:
        return settings
    resolved: dict[str, str] = {}
    for raw_line in result.stdout.splitlines():
        if " " not in raw_line:
            continue
        key, value = raw_line.split(" ", 1)
        resolved[key.strip().lower()] = value.strip()
    host = resolved.get("hostname", "")
    user = resolved.get("user", "")
    port = resolved.get("port", "")
    if host and user:
        settings["target"] = f"{user}@{host}"
    elif host:
        settings["target"] = host
    if port.isdigit():
        settings["port"] = int(port)
    return settings


def run_namecheap_ssh(command: str, *, timeout: int) -> dict[str, object]:
    settings = resolve_namecheap_tunnel_settings()
    ssh_binary = str(settings["sshBinary"])
    alias = str(settings["alias"])
    result = subprocess.run(
        [ssh_binary, alias, command],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    return {
        "ok": result.returncode == 0,
        "command": f"{ssh_binary} {alias} {command}",
        "exitCode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "settings": settings,
    }


def namecheap_health_probe_command() -> str:
    return (
        "php -r "
        + shlex.quote(
            f"$ch=curl_init('http://127.0.0.1:{DEFAULT_NAMECHEAP_TUNNEL_REMOTE_PORT}/healthz');"
            "curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>10]);"
            "$out=curl_exec($ch);"
            "if($out===false){fwrite(STDERR,curl_error($ch));exit(1);} "
            "echo $out;"
        )
    )


def run_remote_cockpit(
    env: dict[str, str],
    *,
    timeout: int,
    sync_support: bool = True,
    script_args: tuple[str, ...],
) -> dict[str, object]:
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=timeout)
        synced = None
        if sync_support:
            synced = upload_repo_support_paths(
                ssh,
                repo_root=REPO_ROOT,
                remote_parent=REMOTE_PARENT,
                local_paths=SUPPORT_PATHS,
                timeout=timeout,
            )
        command = build_remote_cockpit_command(env, *script_args)
        out, err, code = sudo_ssh_exec(ssh, command, env=env, timeout=max(timeout, 120))
        payload: dict[str, object] = {
            "ok": code == 0,
            "auth": auth,
            "exitCode": code,
            "stdout": out.strip(),
            "stderr": err.strip(),
        }
        stdout_text = str(payload["stdout"]).strip()
        if stdout_text:
            try:
                payload["parsed"] = json.loads(stdout_text)
            except json.JSONDecodeError:
                pass
        if synced is not None:
            payload["synced"] = synced
        return payload
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def output_maybe_json(args: argparse.Namespace, payload: dict[str, object]) -> dict[str, object]:
    if args.json:
        return payload
    stdout = str(payload.get("stdout", "")).strip()
    stderr = str(payload.get("stderr", "")).strip()
    if stdout:
        print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)
    return payload


def command_sync_support(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        payload = upload_repo_support_paths(
            ssh,
            repo_root=REPO_ROOT,
            remote_parent=REMOTE_PARENT,
            local_paths=SUPPORT_PATHS,
            timeout=args.timeout,
        )
        payload["ok"] = True
        payload["auth"] = auth
        payload["remote"] = read_remote_identity(ssh, timeout=args.timeout)
        return payload
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_install_stack(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        synced = upload_repo_support_paths(
            ssh,
            repo_root=REPO_ROOT,
            remote_parent=REMOTE_PARENT,
            local_paths=SUPPORT_PATHS,
            timeout=args.timeout,
        )
        env_prefix = build_remote_env_prefix(env)
        command = (
            f"cd {shlex.quote(REMOTE_PARENT)} && "
            f"{env_prefix} bash ./scripts/install-studiobrain-ops-stack.sh"
        )
        out, err, code = sudo_ssh_exec(ssh, command, env=env, timeout=max(args.timeout, 900))
        result = {
            "ok": code == 0,
            "auth": auth,
            "synced": synced,
            "exitCode": code,
            "stdout": out,
            "stderr": err,
        }
        if code == 0:
            result["status"] = command_status(args)
        return result
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_status(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        user = str(env.get("STUDIO_BRAIN_DEPLOY_USER", "wuff")).strip() or "wuff"
        status_script = f"""
python3 - <<'PY'
import json
import os
import shutil
import subprocess

repo_root = {json.dumps(REMOTE_PARENT)}
host_user = {json.dumps(user)}

def run(args, shell=False):
    result = subprocess.run(args, shell=shell, capture_output=True, text=True, check=False)
    return {{
        "rc": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }}

payload = {{
    "tools": {{}},
    "services": {{}},
    "identity": {{
        "user": os.environ.get("USER", ""),
        "cwd": os.getcwd(),
    }},
}}

tool_commands = {{
    "tmux": ["tmux", "-V"],
    "mosh": ["mosh", "--version"],
    "mosh-server": ["mosh-server", "new", "-h"],
    "ansible": ["ansible", "--version"],
    "ansible-playbook": ["ansible-playbook", "--version"],
    "tailscale": ["tailscale", "version"],
    "teleport": ["teleport", "version"],
    "tsh": ["tsh", "version"],
}}

for name, version_command in tool_commands.items():
    path = shutil.which(name)
    if not path:
        payload["tools"][name] = {{"installed": False}}
        continue
    version = run(version_command)
    first_line = (version["stdout"] or version["stderr"]).splitlines()
    payload["tools"][name] = {{
        "installed": True,
        "path": path,
        "version": first_line[0] if first_line else "",
    }}

for unit in ("tailscaled", "teleport"):
    status = run(["systemctl", "show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState"])
    payload["services"][unit] = status

payload["ufw"] = run(["ufw", "status", "numbered"])
payload["tmux"] = run(["runuser", "-u", host_user, "--", "bash", f"{{repo_root}}/scripts/studiobrain-tmux-session.sh", "status"])

if payload["tools"].get("tailscale", {{}}).get("installed"):
    payload["tailscaleStatus"] = run(["tailscale", "status", "--json"])

pending_note = "/etc/teleport/studiobrain.pending.txt"
payload["teleportPendingNote"] = run(["bash", "-lc", f"[[ -f {{pending_note}} ]] && cat {{pending_note}} || true"])

print(json.dumps(payload))
PY
"""
        out, err, code = sudo_ssh_exec(ssh, status_script, env=env, timeout=max(args.timeout, 120))
        if code != 0:
            return {"ok": False, "auth": auth, "exitCode": code, "stdout": out, "stderr": err}
        cockpit_out, cockpit_err, cockpit_code = sudo_ssh_exec(
            ssh,
            build_remote_cockpit_command(env, "state", "--json"),
            env=env,
            timeout=max(args.timeout, 120),
        )
        cockpit_payload = None
        if cockpit_code == 0 and cockpit_out.strip():
            try:
                cockpit_payload = json.loads(cockpit_out.strip())
            except json.JSONDecodeError:
                cockpit_payload = {"raw": cockpit_out.strip()}
        return {
            "ok": True,
            "auth": auth,
            "remote": read_remote_identity(ssh, timeout=args.timeout),
            "controlTowerUrl": str(env.get("STUDIO_BRAIN_CONTROL_TOWER_URL", "https://portal.monsoonfire.com/staff/cockpit/control-tower")).strip()
            or "https://portal.monsoonfire.com/staff/cockpit/control-tower",
            "status": json.loads(out.strip()),
            "cockpit": cockpit_payload,
            "cockpitError": cockpit_err.strip() if cockpit_err.strip() else None,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_tmux_ensure(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        synced = upload_repo_support_paths(
            ssh,
            repo_root=REPO_ROOT,
            remote_parent=REMOTE_PARENT,
            local_paths=SUPPORT_PATHS,
            timeout=args.timeout,
        )
        user = str(env.get("STUDIO_BRAIN_DEPLOY_USER", "wuff")).strip() or "wuff"
        command = (
            f"runuser -u {shlex.quote(user)} -- "
            f"bash {shlex.quote(f'{REMOTE_PARENT}/scripts/studiobrain-tmux-session.sh')} ensure"
        )
        out, err, code = sudo_ssh_exec(ssh, command, env=env, timeout=max(args.timeout, 60))
        return {
            "ok": code == 0,
            "auth": auth,
            "synced": synced,
            "exitCode": code,
            "stdout": out.strip(),
            "stderr": err.strip(),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_cockpit_state(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    return run_remote_cockpit(
        env,
        timeout=args.timeout,
        script_args=("state", "--json"),
    )


def command_session_list(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    return run_remote_cockpit(
        env,
        timeout=args.timeout,
        script_args=("session-list", "--json"),
    )


def command_session_spawn(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    script_args = [
        "session-spawn",
        "--json",
        "--name",
        args.name,
    ]
    if args.cwd:
        script_args.extend(["--cwd", args.cwd])
    if args.command:
        script_args.extend(["--command", args.command])
    if args.tool:
        script_args.extend(["--tool", args.tool])
    if args.group:
        script_args.extend(["--group", args.group])
    if args.room:
        script_args.extend(["--room", args.room])
    if args.summary:
        script_args.extend(["--summary", args.summary])
    if args.objective:
        script_args.extend(["--objective", args.objective])
    return run_remote_cockpit(
        env,
        timeout=max(args.timeout, 60),
        script_args=tuple(script_args),
    )


def command_session_send(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    script_args = [
        "session-send",
        "--json",
        "--session",
        args.session,
        "--text",
        args.text,
    ]
    if args.no_enter:
        script_args.extend(["--enter", "false"])
    return run_remote_cockpit(
        env,
        timeout=max(args.timeout, 60),
        script_args=tuple(script_args),
    )


def command_overseer_ack(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    script_args = [
        "overseer-ack",
        "--json",
        "--note",
        args.note,
    ]
    if args.run_id:
        script_args.extend(["--run-id", args.run_id])
    return run_remote_cockpit(
        env,
        timeout=max(args.timeout, 60),
        script_args=tuple(script_args),
    )


def command_service_action(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    return run_remote_cockpit(
        env,
        timeout=max(args.timeout, 90),
        script_args=("service-action", "--json", "--service", args.service, "--action", args.action),
    )


def command_portal_bridge_install(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        synced = upload_repo_support_paths(
            ssh,
            repo_root=REPO_ROOT,
            remote_parent=REMOTE_PARENT,
            local_paths=SUPPORT_PATHS,
            timeout=args.timeout,
        )
        host_user = str(env.get("STUDIO_BRAIN_DEPLOY_USER", "wuff")).strip() or "wuff"
        remote_key_path = f"/home/{host_user}/.ssh/studiobrain-namecheap-tunnel"
        key_command = (
            f"runuser -u {shlex.quote(host_user)} -- bash -lc "
            f"{shlex.quote('mkdir -p ~/.ssh && chmod 700 ~/.ssh && if [ ! -f ~/.ssh/studiobrain-namecheap-tunnel ]; then ssh-keygen -t ed25519 -f ~/.ssh/studiobrain-namecheap-tunnel -N \"\" -C \"studiobrain-namecheap-tunnel\" >/dev/null; fi && cat ~/.ssh/studiobrain-namecheap-tunnel.pub')}"
        )
        public_key_out, public_key_err, public_key_code = sudo_ssh_exec(ssh, key_command, env=env, timeout=max(args.timeout, 60))
        if public_key_code != 0 or not public_key_out.strip():
            return {
                "ok": False,
                "auth": auth,
                "synced": synced,
                "exitCode": public_key_code,
                "stdout": public_key_out.strip(),
                "stderr": public_key_err.strip() or "failed to read remote tunnel public key",
            }

        namecheap_key_install = run_namecheap_ssh(
            "bash -lc "
            + shlex.quote(
                "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && "
                + f"grep -qxF -- {shlex.quote(public_key_out.strip())} ~/.ssh/authorized_keys || "
                + f"printf '%s\\n' {shlex.quote(public_key_out.strip())} >> ~/.ssh/authorized_keys"
            ),
            timeout=max(args.timeout, 60),
        )
        if not namecheap_key_install["ok"]:
            return {
                "ok": False,
                "auth": auth,
                "synced": synced,
                "namecheapKeyInstall": namecheap_key_install,
            }

        tunnel_settings = resolve_namecheap_tunnel_settings()
        bridge_target = str(tunnel_settings["target"]).strip() or DEFAULT_NAMECHEAP_TUNNEL_TARGET
        bridge_port = int(tunnel_settings["port"])
        upstream_base = (
            str(env.get("STUDIO_BRAIN_MCP_BASE_URL", "")).strip()
            or f"http://{str(env.get('STUDIO_BRAIN_DEPLOY_HOST', '127.0.0.1')).strip()}:8787"
        )

        bridge_install_command = (
            f"cd {shlex.quote(REMOTE_PARENT)} && "
            f"STUDIO_BRAIN_REMOTE_PARENT={shlex.quote(REMOTE_PARENT)} "
            f"STUDIO_BRAIN_DEPLOY_USER={shlex.quote(host_user)} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_TARGET={shlex.quote(bridge_target)} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_PORT={shlex.quote(str(bridge_port))} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_REMOTE_HOST={shlex.quote(DEFAULT_NAMECHEAP_TUNNEL_REMOTE_HOST)} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_REMOTE_PORT={shlex.quote(str(DEFAULT_NAMECHEAP_TUNNEL_REMOTE_PORT))} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_LOCAL_HOST={shlex.quote(DEFAULT_STUDIO_BRAIN_PROXY_HOST)} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_LOCAL_PORT={shlex.quote(str(DEFAULT_STUDIO_BRAIN_PROXY_PORT))} "
            f"STUDIO_BRAIN_CONTROL_TOWER_PROXY_HOST={shlex.quote(DEFAULT_STUDIO_BRAIN_PROXY_HOST)} "
            f"STUDIO_BRAIN_CONTROL_TOWER_PROXY_PORT={shlex.quote(str(DEFAULT_STUDIO_BRAIN_PROXY_PORT))} "
            f"STUDIO_BRAIN_CONTROL_TOWER_PROXY_UPSTREAM={shlex.quote(upstream_base)} "
            f"STUDIO_BRAIN_PORTAL_TUNNEL_KEY_PATH={shlex.quote(remote_key_path)} "
            "bash ./scripts/install-studiobrain-portal-bridge.sh"
        )
        install_out, install_err, install_code = sudo_ssh_exec(ssh, bridge_install_command, env=env, timeout=max(args.timeout, 180))
        if install_code != 0:
            return {
                "ok": False,
                "auth": auth,
                "synced": synced,
                "namecheapKeyInstall": namecheap_key_install,
                "exitCode": install_code,
                "stdout": install_out.strip(),
                "stderr": install_err.strip(),
            }

        bridge_key_check_command = (
            f"runuser -u {shlex.quote(host_user)} -- "
            f"ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "
            f"-i {shlex.quote(remote_key_path)} -p {bridge_port} {shlex.quote(bridge_target)} "
            f"{shlex.quote('echo bridge-tunnel-key-ok')}"
        )
        key_check_out, key_check_err, key_check_code = sudo_ssh_exec(ssh, bridge_key_check_command, env=env, timeout=max(args.timeout, 60))

        namecheap_probe = run_namecheap_ssh(namecheap_health_probe_command(), timeout=max(args.timeout, 60))

        return {
            "ok": install_code == 0 and key_check_code == 0 and bool(namecheap_probe["ok"]),
            "auth": auth,
            "synced": synced,
            "namecheapKeyInstall": namecheap_key_install,
            "bridgeTarget": bridge_target,
            "bridgePort": bridge_port,
            "upstreamBase": upstream_base,
            "remoteKeyPath": remote_key_path,
            "installStdout": install_out.strip(),
            "installStderr": install_err.strip(),
            "hostKeyCheck": {
                "ok": key_check_code == 0,
                "stdout": key_check_out.strip(),
                "stderr": key_check_err.strip(),
            },
            "namecheapProbe": namecheap_probe,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_portal_bridge_status(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        systemd_status = """
python3 - <<'PY'
import json
import subprocess

def run(unit):
    result = subprocess.run(
        ["systemctl", "show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState"],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "rc": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }

print(json.dumps({
    "proxy": run("studio-brain-control-tower-proxy"),
    "tunnel": run("studio-brain-namecheap-tunnel"),
}))
PY
"""
        out, err, code = sudo_ssh_exec(ssh, systemd_status, env=env, timeout=max(args.timeout, 60))
        namecheap_probe = run_namecheap_ssh(namecheap_health_probe_command(), timeout=max(args.timeout, 60))
        return {
            "ok": code == 0 and bool(namecheap_probe["ok"]),
            "auth": auth,
            "status": json.loads(out.strip()) if out.strip() else None,
            "stderr": err.strip(),
            "namecheapProbe": namecheap_probe,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_attach_command(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    alias = str(env.get("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", "studiobrain")).strip() or "studiobrain"
    ssh_binary = resolve_windows_openssh_binary("ssh.exe") or "ssh"
    remote_cmd = f"bash {shlex.quote(f'{REMOTE_PARENT}/scripts/studiobrain-tmux-session.sh')} attach"
    return {
        "ok": True,
        "command": f'{ssh_binary} -t {alias} "{remote_cmd}"',
    }


def command_browser_url(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    return {
        "ok": True,
        "url": resolve_control_tower_url(env),
    }


def command_session_attach_command(args: argparse.Namespace) -> dict[str, object]:
    alias = str(load_env().get("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", "studiobrain")).strip() or "studiobrain"
    ssh_binary = resolve_windows_openssh_binary("ssh.exe") or "ssh"
    remote_cmd = f"tmux attach -t {shlex.quote(args.session)}"
    return {
        "ok": True,
        "command": f'{ssh_binary} -t {alias} "{remote_cmd}"',
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Studio Brain remote ops wrapper. Browser Control Tower is primary; tmux remains recovery-only.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    parser.add_argument("--timeout", type=int, default=30, help="SSH timeout in seconds.")
    subparsers = parser.add_subparsers(dest="command_name", required=True)

    sync_parser = subparsers.add_parser("sync-support", help="Sync Studio Brain ops support files to the host checkout.")
    sync_parser.set_defaults(handler=command_sync_support)

    install_parser = subparsers.add_parser("install-stack", help="Install the Studio Brain remote ops stack.")
    install_parser.set_defaults(handler=command_install_stack)

    status_parser = subparsers.add_parser("status", help="Inspect the Studio Brain remote ops stack.")
    status_parser.set_defaults(handler=command_status)

    tmux_parser = subparsers.add_parser("tmux-ensure", help="Ensure the Studio Brain tmux recovery session exists.")
    tmux_parser.set_defaults(handler=command_tmux_ensure)

    cockpit_parser = subparsers.add_parser("cockpit-state", help="Collect browser-first Control Tower state for recovery and automation.")
    cockpit_parser.set_defaults(handler=command_cockpit_state)

    list_parser = subparsers.add_parser("session-list", help="List agent sessions and rooms from the cockpit state.")
    list_parser.set_defaults(handler=command_session_list)

    spawn_parser = subparsers.add_parser("session-spawn", help="Create a new tmux-backed agent session on the Studio Brain host.")
    spawn_parser.add_argument("--name", required=True, help="tmux session name")
    spawn_parser.add_argument("--cwd", help="working directory for the new session")
    spawn_parser.add_argument("--command", help="command to run in the new session")
    spawn_parser.add_argument("--tool", help="logical tool label (codex, claude, custom)")
    spawn_parser.add_argument("--group", help="room/group label")
    spawn_parser.add_argument("--room", help="room override")
    spawn_parser.add_argument("--summary", help="friendly summary shown in the cockpit")
    spawn_parser.add_argument("--objective", help="optional operator objective for the room")
    spawn_parser.set_defaults(handler=command_session_spawn)

    send_parser = subparsers.add_parser("session-send", help="Send text to an existing tmux session.")
    send_parser.add_argument("--session", required=True, help="target tmux session name")
    send_parser.add_argument("--text", required=True, help="text to send")
    send_parser.add_argument("--no-enter", action="store_true", help="do not append Enter after sending text")
    send_parser.set_defaults(handler=command_session_send)

    ack_parser = subparsers.add_parser("overseer-ack", help="Append an operator acknowledgement for the latest overseer run.")
    ack_parser.add_argument("--note", required=True, help="note to record")
    ack_parser.add_argument("--run-id", help="optional explicit run id")
    ack_parser.set_defaults(handler=command_overseer_ack)

    service_parser = subparsers.add_parser("service-action", help="Run an allowlisted service action on the Studio Brain host.")
    service_parser.add_argument("--service", required=True, help="allowlisted service id")
    service_parser.add_argument("--action", required=True, help="status|restart|start|stop")
    service_parser.set_defaults(handler=command_service_action)

    portal_bridge_install_parser = subparsers.add_parser(
        "portal-bridge-install",
        help="Install the browser bridge between portal.monsoonfire.com and the Studio Brain host.",
    )
    portal_bridge_install_parser.set_defaults(handler=command_portal_bridge_install)

    portal_bridge_status_parser = subparsers.add_parser(
        "portal-bridge-status",
        help="Inspect the Studio Brain browser bridge and portal-host tunnel probe.",
    )
    portal_bridge_status_parser.set_defaults(handler=command_portal_bridge_status)

    browser_url_parser = subparsers.add_parser(
        "browser-url",
        help="Print the primary browser Control Tower URL.",
    )
    browser_url_parser.set_defaults(handler=command_browser_url)

    attach_parser = subparsers.add_parser("attach-command", help="Print the native SSH command for attaching to the Studio Brain tmux recovery session.")
    attach_parser.set_defaults(handler=command_attach_command)

    session_attach_parser = subparsers.add_parser("session-attach-command", help="Print the native SSH command for attaching to a specific tmux-backed room session.")
    session_attach_parser.add_argument("--session", required=True, help="target tmux session")
    session_attach_parser.set_defaults(handler=command_session_attach_command)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    result = args.handler(args)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("command") and len(result) == 2:
            print(result["command"])
        elif result.get("url") and len(result) == 2:
            print(result["url"])
        else:
            print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
