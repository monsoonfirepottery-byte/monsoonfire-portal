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
DEFAULT_STUDIO_BRAIN_API_HOST = "192.168.1.226"
SUPPORT_PATHS = (
    REPO_ROOT / ".gitignore",
    REPO_ROOT / "package.json",
    REPO_ROOT / ".governance" / "planning",
    REPO_ROOT / "contracts" / "planning.schema.json",
    REPO_ROOT / "config" / "studiobrain" / "ansible",
    REPO_ROOT / "config" / "studiobrain" / "fail2ban" / "sshd.local",
    REPO_ROOT / "config" / "studiobrain" / "monitoring",
    REPO_ROOT / "config" / "studiobrain" / "systemd",
    REPO_ROOT / "config" / "studiobrain" / "tmux",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_CONTROL_TOWER_V2.md",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_HOST_ACCESS.md",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_HOST_DEPLOY.md",
    REPO_ROOT / "docs" / "runbooks" / "STUDIO_BRAIN_HOST_STACK.md",
    REPO_ROOT / "docs" / "STUDIO_BRAIN_DISCORD_CHANNEL.md",
    REPO_ROOT / "scripts" / "install-studiobrain-bambu-cli.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-fail2ban-sshd.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-healthcheck.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-monitoring.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-ops-stack.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-portal-bridge.sh",
    REPO_ROOT / "scripts" / "open-memory-consolidate.mjs",
    REPO_ROOT / "scripts" / "open-memory-overnight-iterate.mjs",
    REPO_ROOT / "scripts" / "open-memory.mjs",
    REPO_ROOT / "scripts" / "studiobrain-ops.py",
    REPO_ROOT / "scripts" / "studiobrain-idle-worker.mjs",
    REPO_ROOT / "scripts" / "studiobrain-agent-harness-work-packet.mjs",
    REPO_ROOT / "scripts" / "wiki-postgres.mjs",
    REPO_ROOT / "scripts" / "reliability-hub.mjs",
    REPO_ROOT / "scripts" / "studiobrain-backup-drill.mjs",
    REPO_ROOT / "scripts" / "repo-audit-branch-guard.mjs",
    REPO_ROOT / "scripts" / "repo-agentic-health-inventory.mjs",
    REPO_ROOT / "scripts" / "check-ephemeral-artifact-tracking.mjs",
    REPO_ROOT / "scripts" / "firestore-write-surface-inventory.mjs",
    REPO_ROOT / "scripts" / "destructive-command-surface-audit.mjs",
    REPO_ROOT / "scripts" / "security-history-scan.mjs",
    REPO_ROOT / "scripts" / "codex" / "open-memory-automation.mjs",
    REPO_ROOT / "scripts" / "codex" / "phone-notify.mjs",
    REPO_ROOT / "scripts" / "studiobrain-bambu-cli.sh",
    REPO_ROOT / "scripts" / "studiobrain-cockpit.mjs",
    REPO_ROOT / "scripts" / "studiobrain-control-tower-proxy.mjs",
    REPO_ROOT / "scripts" / "studiobrain-incident-bundle.mjs",
    REPO_ROOT / "scripts" / "studiobrain-status.mjs",
    REPO_ROOT / "scripts" / "studiobrain-host-access.py",
    REPO_ROOT / "scripts" / "studiobrain-host-access.sh",
    REPO_ROOT / "scripts" / "studiobrain-tmux-session.sh",
    REPO_ROOT / "scripts" / "studio-brain-url-resolution.mjs",
    REPO_ROOT / "scripts" / "studio-network-profile.mjs",
    REPO_ROOT / "scripts" / "lib" / "command-runner.mjs",
    REPO_ROOT / "scripts" / "lib" / "wiki-postgres-utils.mjs",
    REPO_ROOT / "scripts" / "lib" / "studiobrain_host_access.py",
    REPO_ROOT / "studio-brain" / "lib" / "controlTower",
    REPO_ROOT / "wiki",
)
REMOTE_ENV_KEYS = (
    "STUDIO_BRAIN_DEPLOY_USER",
    "STUDIO_BRAIN_MOSH_UDP_RANGE",
    "STUDIO_BRAIN_TMUX_SESSION_NAME",
    "STUDIO_BRAIN_COCKPIT_THEME",
    "STUDIO_BRAIN_CONTROL_TOWER_URL",
)


def load_env() -> dict[str, str]:
    return load_studiobrain_deploy_env(
        env_path=ENV_PATH,
        home_env_path=HOME_STUDIO_MCP_ENV_PATH,
    )


def deployment_managed_status_paths() -> tuple[list[str], list[str]]:
    exact_paths: set[str] = set()
    prefixes: set[str] = {
        ".governance/planning/",
        "config/studiobrain/",
        "contracts/",
        "docs/runbooks/",
        "scripts/",
        "studio-brain/",
    }

    for path in SUPPORT_PATHS:
        try:
            relative = path.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            continue
        if path.is_dir():
            prefixes.add(f"{relative.rstrip('/')}/")
        else:
            exact_paths.add(relative)

    return sorted(exact_paths), sorted(prefixes)


def resolve_control_tower_url(env: dict[str, str]) -> str:
    return str(env.get("STUDIO_BRAIN_CONTROL_TOWER_URL", "")).strip() or "https://portal.monsoonfire.com/staff/cockpit/control-tower"


def parse_json_text(text: str) -> dict[str, object] | list[object] | None:
    stripped = str(text or "").strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def run_local_json_command(command: list[str], *, timeout: int) -> dict[str, object]:
    try:
        result = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "error": f"local command timed out after {timeout}s",
            "command": command,
            "stdout": str(exc.stdout or "").strip(),
            "stderr": str(exc.stderr or "").strip(),
        }
    payload: dict[str, object] = {
        "ok": result.returncode == 0,
        "command": command,
        "exitCode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }
    parsed = parse_json_text(result.stdout)
    if parsed is not None:
        payload["parsed"] = parsed
    return payload


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


def build_remote_host_user_command(env: dict[str, str], inner_command: str) -> str:
    host_user = str(env.get("STUDIO_BRAIN_DEPLOY_USER", "wuff")).strip() or "wuff"
    return f"runuser -u {shlex.quote(host_user)} -- bash -lc {shlex.quote(inner_command)}"


def build_remote_bambu_command(env: dict[str, str], *script_args: str) -> str:
    quoted_args = " ".join(shlex.quote(str(value)) for value in script_args if str(value or "").strip())
    wrapper_path = f"{REMOTE_PARENT}/scripts/studiobrain-bambu-cli.sh"
    inner_command = f"cd {shlex.quote(REMOTE_PARENT)} && {shlex.quote(wrapper_path)} {quoted_args}".strip()
    return build_remote_host_user_command(env, inner_command)


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


def run_remote_bambu(
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
        command = build_remote_bambu_command(env, *script_args)
        out, err, code = sudo_ssh_exec(ssh, command, env=env, timeout=max(timeout, 900))
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


def command_bambu_install(args: argparse.Namespace) -> dict[str, object]:
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
        install_command = (
            f"cd {shlex.quote(REMOTE_PARENT)} && "
            f"STUDIO_BRAIN_REMOTE_PARENT={shlex.quote(REMOTE_PARENT)} "
            f"STUDIO_BRAIN_DEPLOY_USER={shlex.quote(host_user)} "
            "bash ./scripts/install-studiobrain-bambu-cli.sh"
        )
        install_out, install_err, install_code = sudo_ssh_exec(
            ssh,
            install_command,
            env=env,
            timeout=max(args.timeout, 1800),
        )
        payload: dict[str, object] = {
            "ok": install_code == 0,
            "auth": auth,
            "synced": synced,
            "exitCode": install_code,
            "stdout": install_out.strip(),
            "stderr": install_err.strip(),
        }
        if install_code == 0:
            payload["status"] = run_remote_bambu(
                env,
                timeout=max(args.timeout, 120),
                sync_support=False,
                script_args=("status", "--json"),
            )
        return payload
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if ssh is not None:
            ssh.close()


def command_bambu_status(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    return run_remote_bambu(
        env,
        timeout=max(args.timeout, 120),
        script_args=("status", "--json"),
    )


def command_bambu_smoke(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    script_args = ["smoke", "--json"]
    if args.output_dir:
        script_args.extend(["--output-dir", args.output_dir])
    if args.keep_output:
        script_args.append("--keep-output")
    return run_remote_bambu(
        env,
        timeout=max(args.timeout, 1800),
        script_args=tuple(script_args),
    )


def command_bambu_run(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    bambu_args = list(args.bambu_args or [])
    if bambu_args and bambu_args[0] == "--":
        bambu_args = bambu_args[1:]
    if not bambu_args:
        return {"ok": False, "error": "bambu-run requires at least one argument after '--'"}
    return run_remote_bambu(
        env,
        timeout=max(args.timeout, 1800),
        script_args=tuple(["run", *bambu_args]),
    )


def command_deploy_runtime(args: argparse.Namespace) -> dict[str, object]:
    command = [sys.executable, str(REPO_ROOT / "scripts" / "deploy-studio-brain-host.py"), "--json"]
    result = run_local_json_command(command, timeout=max(args.timeout, 1800))
    payload: dict[str, object] = {
        "ok": bool(result.get("ok")),
        "command": "deploy-runtime",
        "runner": command,
        "exitCode": int(result.get("exitCode", 1)),
        "stdout": str(result.get("stdout", "")),
        "stderr": str(result.get("stderr", "")),
    }
    parsed = result.get("parsed")
    if isinstance(parsed, (dict, list)):
        payload["deploy"] = parsed
    if "error" in result:
        payload["error"] = result["error"]
    return payload


def command_reconcile(args: argparse.Namespace) -> dict[str, object]:
    deploy_result = command_deploy_runtime(args)
    if not deploy_result.get("ok"):
        return {
            "ok": False,
            "command": "reconcile",
            "deployRuntime": deploy_result,
            "blockedAt": "deploy-runtime",
        }
    install_result = command_install_stack(args)
    return {
        "ok": bool(install_result.get("ok")),
        "command": "reconcile",
        "deployRuntime": deploy_result,
        "installStack": install_result,
        "status": install_result.get("status"),
    }


def command_status(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        user = str(env.get("STUDIO_BRAIN_DEPLOY_USER", "wuff")).strip() or "wuff"
        managed_exact, managed_prefixes = deployment_managed_status_paths()
        status_script = f"""
python3 - <<'PY'
import json
import os
import shutil
import subprocess
import time

repo_root = {json.dumps(REMOTE_PARENT)}
host_user = {json.dumps(user)}
managed_exact_paths = set({json.dumps(managed_exact)})
managed_prefixes = tuple({json.dumps(managed_prefixes)})

def run(args, shell=False):
    result = subprocess.run(args, shell=shell, capture_output=True, text=True, check=False)
    return {{
        "rc": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }}

def parse_systemctl_show(status):
    values = {{}}
    for line in status.get("stdout", "").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values

def parse_git_status_path(line):
    raw = str(line or "")
    if len(raw) > 3 and raw[2] == " ":
        path = raw[3:]
    elif len(raw) > 2 and raw[1] == " ":
        path = raw[2:]
    else:
        path = raw[3:] if len(raw) > 3 else raw
    path = path.strip().replace("\\\\", "/")
    if " -> " in path:
        path = path.split(" -> ", 1)[1].strip()
    return path

def load_integrity_managed_paths():
    manifest_path = os.path.join(repo_root, "studio-brain", ".env.integrity.json")
    try:
        with open(manifest_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return set()
    paths = set()
    for entry in payload.get("files", []):
        path = str(entry.get("path", "")).strip().replace("\\\\", "/")
        if path:
            paths.add(path)
    return paths

def is_deployment_managed(path):
    normalized = str(path or "").strip().replace("\\\\", "/")
    if not normalized:
        return False
    if normalized in managed_exact_paths:
        return True
    return any(normalized.startswith(prefix) for prefix in managed_prefixes)

managed_exact_paths.update(load_integrity_managed_paths())

payload = {{
    "tools": {{}},
    "services": {{}},
    "timers": {{}},
    "idleWorker": {{}},
    "workspace": {{
        "repoRoot": repo_root,
    }},
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
    "node": ["node", "--version"],
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

service_units = (
    "-".join(("studio", "brain", "".join(("disco", "rd")), "relay")),
    "-".join(("studio", "brain", "control", "tower", "proxy")),
    "-".join(("studio", "brain", "namecheap", "tunnel")),
    "-".join(("studio", "brain", "idle", "worker")),
    "-".join(("studio", "brain", "idle", "worker", "overnight")),
)
for unit in service_units:
    status = run(["systemctl", "show", unit, "-p", "LoadState", "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState", "-p", "Result"])
    payload["services"][unit] = status

timer_stems = (
    "-".join(("studio", "brain", "backup")),
    "-".join(("studio", "brain", "disk", "alert")),
    "-".join(("studio", "brain", "healthcheck")),
    "-".join(("studio", "brain", "idle", "worker")),
    "-".join(("studio", "brain", "idle", "worker", "overnight")),
    "-".join(("studio", "brain", "reboot", "watch")),
)
for stem in timer_stems:
    unit = f"{{stem}}.timer"
    status = run([
        "systemctl",
        "show",
        unit,
        "-p",
        "LoadState",
        "-p",
        "ActiveState",
        "-p",
        "SubState",
        "-p",
        "UnitFileState",
        "-p",
        "NextElapseUSecRealtime",
        "-p",
        "NextElapseUSecMonotonic",
        "-p",
        "LastTriggerUSec",
    ])
    status["listTimers"] = run(["systemctl", "list-timers", "--all", "--no-pager", "--no-legend", unit])
    payload["timers"][unit] = status

idle_worker_files = [
    "/usr/local/bin/studio-brain-idle-worker.sh",
    "/etc/systemd/system/studio-brain-idle-worker.service",
    "/etc/systemd/system/studio-brain-idle-worker.timer",
    "/etc/systemd/system/studio-brain-idle-worker-overnight.service",
    "/etc/systemd/system/studio-brain-idle-worker-overnight.timer",
]
idle_artifact_path = os.path.join(repo_root, "output", "studio-brain", "idle-worker", "latest.json")
idle_findings = []
idle_timer_summaries = {{}}
missing_files = [path for path in idle_worker_files if not os.path.exists(path)]
if missing_files:
    idle_findings.append({{"severity": "fail", "message": "idle worker install files are missing", "paths": missing_files}})

for unit in ("studio-brain-idle-worker.timer", "studio-brain-idle-worker-overnight.timer"):
    raw_timer = payload["timers"].get(unit, {{}})
    values = parse_systemctl_show(raw_timer)
    list_timer = raw_timer.get("listTimers", {{}})
    list_timer_stdout = str(list_timer.get("stdout", "")).strip() if isinstance(list_timer, dict) else ""
    idle_timer_summaries[unit] = {{
        "loadState": values.get("LoadState", ""),
        "activeState": values.get("ActiveState", ""),
        "subState": values.get("SubState", ""),
        "unitFileState": values.get("UnitFileState", ""),
        "nextElapseRealtime": values.get("NextElapseUSecRealtime", ""),
        "nextElapseMonotonic": values.get("NextElapseUSecMonotonic", ""),
        "lastTrigger": values.get("LastTriggerUSec", ""),
        "listTimers": list_timer_stdout,
    }}
    if values.get("LoadState") != "loaded":
        idle_findings.append({{"severity": "fail", "message": f"{{unit}} is not loaded", "unit": unit, "state": values}})
        continue
    if values.get("ActiveState") != "active":
        idle_findings.append({{"severity": "fail", "message": f"{{unit}} is not active", "unit": unit, "state": values}})
    if values.get("UnitFileState") not in ("enabled", "static"):
        idle_findings.append({{"severity": "fail", "message": f"{{unit}} is not enabled", "unit": unit, "state": values}})
    has_timer_next = bool(values.get("NextElapseUSecRealtime") or values.get("NextElapseUSecMonotonic"))
    if not has_timer_next and (not list_timer_stdout or list_timer_stdout.lower().startswith("n/a")):
        idle_findings.append({{"severity": "warn", "message": f"{{unit}} has no visible next run", "unit": unit, "state": values}})

artifact_summary = {{"path": idle_artifact_path, "exists": os.path.exists(idle_artifact_path)}}
if artifact_summary["exists"]:
    stat = os.stat(idle_artifact_path)
    artifact_summary["mtimeEpoch"] = int(stat.st_mtime)
    artifact_summary["ageSeconds"] = max(0, int(time.time() - stat.st_mtime))
    try:
        with open(idle_artifact_path, "r", encoding="utf-8") as handle:
            artifact = json.load(handle)
        artifact_summary.update({{
            "runId": artifact.get("runId", ""),
            "status": artifact.get("status", ""),
            "completedAt": artifact.get("completedAt", ""),
            "summary": artifact.get("summary", {{}}),
        }})
        artifact_status = str(artifact_summary.get("status", "")).strip()
        if artifact_status in ("degraded", "failed"):
            idle_findings.append({{"severity": "fail", "message": "latest idle worker artifact is not passing", "status": artifact_status}})
        elif artifact_status and artifact_status != "passed":
            idle_findings.append({{"severity": "warn", "message": "latest idle worker artifact is not cleanly passed", "status": artifact_status}})
        if artifact_summary["ageSeconds"] > 6 * 60 * 60:
            idle_findings.append({{"severity": "warn", "message": "latest idle worker artifact is stale", "ageSeconds": artifact_summary["ageSeconds"]}})
    except Exception as exc:
        artifact_summary["parseError"] = str(exc)
        idle_findings.append({{"severity": "fail", "message": "idle worker latest artifact could not be parsed", "error": str(exc)}})
else:
    idle_findings.append({{"severity": "warn", "message": "idle worker latest artifact is missing", "path": idle_artifact_path}})

payload["idleWorker"] = {{
    "status": "fail" if any(finding.get("severity") == "fail" for finding in idle_findings) else ("warn" if idle_findings else "pass"),
    "artifact": artifact_summary,
    "timers": idle_timer_summaries,
    "findings": idle_findings,
}}

git_path = shutil.which("git")
if git_path:
    branch = run(["git", "-C", repo_root, "rev-parse", "--abbrev-ref", "HEAD"])
    head = run(["git", "-C", repo_root, "rev-parse", "HEAD"])
    tracked_status = run(["git", "-C", repo_root, "status", "--short", "--untracked-files=no"])
    untracked_status = run(["git", "-C", repo_root, "status", "--short", "--untracked-files=all"])
    status_lines = [line for line in tracked_status["stdout"].splitlines() if line.strip()]
    untracked_lines = [
        line
        for line in untracked_status["stdout"].splitlines()
        if line.strip().startswith("??")
    ]
    status_entries = []
    managed_status_lines = []
    unmanaged_status_lines = []
    for line in status_lines:
        path = parse_git_status_path(line)
        deployment_managed = is_deployment_managed(path)
        entry = {{
            "line": line,
            "path": path,
            "deploymentManaged": deployment_managed,
        }}
        status_entries.append(entry)
        if deployment_managed:
            managed_status_lines.append(line)
        else:
            unmanaged_status_lines.append(line)
    untracked_entries = []
    managed_untracked_lines = []
    unmanaged_untracked_lines = []
    for line in untracked_lines:
        path = parse_git_status_path(line)
        deployment_managed = is_deployment_managed(path)
        entry = {{
            "line": line,
            "path": path,
            "deploymentManaged": deployment_managed,
        }}
        untracked_entries.append(entry)
        if deployment_managed:
            managed_untracked_lines.append(line)
        else:
            unmanaged_untracked_lines.append(line)
    payload["workspace"].update({{
        "gitInstalled": True,
        "branch": branch["stdout"].strip(),
        "head": head["stdout"].strip(),
        "dirtyTrackedCount": len(status_lines),
        "dirtyTrackedPreview": status_lines[:20],
        "dirtyTrackedManagedCount": len(managed_status_lines),
        "dirtyTrackedManagedPreview": managed_status_lines[:20],
        "dirtyTrackedUnmanagedCount": len(unmanaged_status_lines),
        "dirtyTrackedUnmanagedPreview": unmanaged_status_lines[:20],
        "dirtyTrackedEntriesPreview": status_entries[:20],
        "untrackedCount": len(untracked_lines),
        "untrackedManagedCount": len(managed_untracked_lines),
        "untrackedManagedPreview": managed_untracked_lines[:20],
        "untrackedUnmanagedCount": len(unmanaged_untracked_lines),
        "untrackedUnmanagedPreview": unmanaged_untracked_lines[:20],
        "untrackedEntriesPreview": untracked_entries[:20],
    }})
else:
    payload["workspace"]["gitInstalled"] = False

payload["ufw"] = run(["ufw", "status", "numbered"])
payload["tmux"] = run(["runuser", "-u", host_user, "--", "bash", f"{{repo_root}}/scripts/studiobrain-tmux-session.sh", "status"])

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
            or str(env.get("STUDIO_BRAIN_BASE_URL", "")).strip()
            or str(env.get("STUDIO_BRAIN_URL", "")).strip()
            or f"http://{str(env.get('STUDIO_BRAIN_DEPLOY_HOST', DEFAULT_STUDIO_BRAIN_API_HOST)).strip()}:8787"
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

    deploy_parser = subparsers.add_parser("deploy-runtime", help="Deploy the full Studio Brain runtime to the host and restart the service.")
    deploy_parser.set_defaults(handler=command_deploy_runtime)

    install_parser = subparsers.add_parser("install-stack", help="Install the Studio Brain remote ops sidecars and host stack resources.")
    install_parser.set_defaults(handler=command_install_stack)

    reconcile_parser = subparsers.add_parser(
        "reconcile",
        help="Run the full Studio Brain host reconcile cycle: runtime deploy, sidecar install, then status.",
    )
    reconcile_parser.set_defaults(handler=command_reconcile)

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

    bambu_install_parser = subparsers.add_parser(
        "bambu-install",
        help="Install the pinned Bambu Studio Linux CLI on the Studio Brain host.",
    )
    bambu_install_parser.set_defaults(handler=command_bambu_install)

    bambu_status_parser = subparsers.add_parser(
        "bambu-status",
        help="Report the installed Bambu Studio CLI state on the Studio Brain host.",
    )
    bambu_status_parser.set_defaults(handler=command_bambu_status)

    bambu_smoke_parser = subparsers.add_parser(
        "bambu-smoke",
        help="Run a headless Bambu Studio smoke slice on the Studio Brain host.",
    )
    bambu_smoke_parser.add_argument("--output-dir", help="Optional remote directory for smoke outputs.")
    bambu_smoke_parser.add_argument(
        "--keep-output",
        action="store_true",
        help="Keep smoke-slice artifacts instead of deleting them after a successful run.",
    )
    bambu_smoke_parser.set_defaults(handler=command_bambu_smoke)

    bambu_run_parser = subparsers.add_parser(
        "bambu-run",
        help="Run arbitrary Bambu Studio CLI arguments on the Studio Brain host.",
    )
    bambu_run_parser.add_argument(
        "bambu_args",
        nargs=argparse.REMAINDER,
        help="Arguments passed through to studiobrain-bambu-cli.sh run",
    )
    bambu_run_parser.set_defaults(handler=command_bambu_run)

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
