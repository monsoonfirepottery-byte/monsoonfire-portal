#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import tarfile
import tempfile
import time
from textwrap import dedent
import urllib.request

SCRIPTS_LIB = Path(__file__).resolve().parent / "lib"
if str(SCRIPTS_LIB) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_LIB))

from studiobrain_host_access import connect_studiobrain_ssh, install_remote_fail2ban_allowlist, load_studiobrain_deploy_env


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_STUDIO_BRAIN = REPO_ROOT / "studio-brain"
ENV_PATH = REPO_ROOT / "secrets/studio-brain/studio-brain-mcp.env"
PORTAL_ENV_PATH = REPO_ROOT / "secrets/portal/portal-automation.env"
HOME_PORTAL_ENV_PATH = Path.home() / "secrets" / "portal" / "portal-automation.env"
PORTAL_AGENT_STAFF_JSON_PATH = REPO_ROOT / "secrets" / "portal" / "portal-agent-staff.json"
HOME_PORTAL_AGENT_STAFF_JSON_PATH = Path.home() / "secrets" / "portal" / "portal-agent-staff.json"
STUDIO_AUTOMATION_ENV_PATH = REPO_ROOT / "secrets" / "studio-brain" / "studio-brain-automation.env"
HOME_STUDIO_AUTOMATION_ENV_PATH = Path.home() / "secrets" / "studio-brain" / "studio-brain-automation.env"
HOME_STUDIO_MCP_ENV_PATH = Path.home() / "secrets" / "studio-brain" / "studio-brain-mcp.env"
INTEGRITY_MANIFEST_PATH = REPO_ROOT / "studio-brain/.env.integrity.json"
REMOTE_PARENT = "/home/wuff/monsoonfire-portal"
REMOTE_ROOT = f"{REMOTE_PARENT}/studio-brain"
REMOTE_HOME = "/home/wuff"
REMOTE_USER_SYSTEMD_DIR = f"{REMOTE_HOME}/.config/systemd/user"
REMOTE_SERVICE_PATH = f"{REMOTE_USER_SYSTEMD_DIR}/studio-brain.service"
REMOTE_PORTAL_ENV_PATH = f"{REMOTE_PARENT}/secrets/portal/portal-automation.env"
REMOTE_PORTAL_AGENT_STAFF_JSON_PATH = f"{REMOTE_PARENT}/secrets/portal/portal-agent-staff.json"
REMOTE_PORTAL_GOOGLE_ADC_PATH = f"{REMOTE_PARENT}/secrets/portal/application_default_credentials.json"
DEFAULT_LOCAL_GOOGLE_ADC_PATH = (
    Path(os.environ["APPDATA"]) / "gcloud" / "application_default_credentials.json"
    if os.environ.get("APPDATA")
    else Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
)
STATIC_SUPPORT_PATHS = (
    REPO_ROOT / ".governance" / "planning",
    REPO_ROOT / "contracts" / "planning.schema.json",
    REPO_ROOT / "scripts" / "open-memory-consolidate.mjs",
    REPO_ROOT / "scripts" / "open-memory-overnight-iterate.mjs",
    REPO_ROOT / "scripts" / "open-memory.mjs",
    REPO_ROOT / "scripts" / "codex" / "open-memory-automation.mjs",
    REPO_ROOT / "scripts" / "codex" / "phone-notify.mjs",
    REPO_ROOT / "scripts" / "lib" / "planning-control-plane.mjs",
    REPO_ROOT / "scripts" / "lib" / "open-memory-import-utils.mjs",
    REPO_ROOT / "scripts" / "studio-brain-discord-relay.mjs",
    REPO_ROOT / "scripts" / "studio-network-profile.mjs",
    REPO_ROOT / "scripts" / "studio-brain-url-resolution.mjs",
    REPO_ROOT / "scripts" / "lib" / "codex-automation-env.mjs",
    REPO_ROOT / "scripts" / "lib" / "codex-startup-reliability.mjs",
    REPO_ROOT / "scripts" / "lib" / "codex-worktree-utils.mjs",
    REPO_ROOT / "scripts" / "lib" / "firebase-auth-token.mjs",
    REPO_ROOT / "scripts" / "lib" / "studio-brain-startup-auth.mjs",
    REPO_ROOT / "scripts" / "lib" / "studio-brain-memory-write.mjs",
    REPO_ROOT / "scripts" / "lib" / "codex-session-memory-utils.mjs",
    REPO_ROOT / "scripts" / "lib" / "hybrid-memory-utils.mjs",
    REPO_ROOT / "scripts" / "lib" / "pst-memory-utils.mjs",
    REPO_ROOT / "scripts" / "studio-brain-discord-action-runner.mjs",
    REPO_ROOT / "scripts" / "install-studiobrain-fail2ban-sshd.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-discord-relay.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-healthcheck.sh",
    REPO_ROOT / "scripts" / "install-studiobrain-monitoring.sh",
    REPO_ROOT / "config" / "studiobrain" / "discord" / "agentcontrol-runtime-catalog.json",
    REPO_ROOT / "config" / "studiobrain" / "discord" / "agentcontrol-memes.json",
    REPO_ROOT / "config" / "studiobrain" / "fail2ban" / "sshd.local",
    REPO_ROOT / "config" / "studiobrain" / "monitoring",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-backup.service",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-backup.timer",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-backup.sh",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-disk-alert.service",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-disk-alert.timer",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-disk-alert.sh",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-discord-relay.service",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-discord-relay.timer",
    REPO_ROOT / "config" / "studiobrain" / "systemd" / "studio-brain-discord-relay.sh",
)
HOST_DRIFT_ALLOWLIST_PATH = REPO_ROOT / "studio-brain" / "host-drift-allowlist.json"
DISCORD_ENV_PATH = REPO_ROOT / "secrets" / "studio-brain" / "discord-mcp.env"
HOME_DISCORD_ENV_PATH = Path.home() / "secrets" / "studio-brain" / "discord-mcp.env"
DISCORD_ENV_KEYS_TO_MIRROR = (
    "STUDIO_BRAIN_MEMORY_INGEST_ENABLED",
    "STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET",
    "STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES",
    "STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS",
    "STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS",
    "STUDIO_BRAIN_OVERSEER_DISCORD_ENABLED",
    "STUDIO_BRAIN_DISCORD_CONVERSATION_MODE",
    "STUDIO_BRAIN_DISCORD_REPLY_TRIGGER_POLICY",
    "STUDIO_BRAIN_DISCORD_AMBIENT_REPLY_COOLDOWN_MS",
    "STUDIO_BRAIN_DISCORD_SIGNS_OF_LIFE",
    "STUDIO_BRAIN_DISCORD_MEME_COOLDOWN_MS",
    "STUDIO_BRAIN_DISCORD_SELF_STATE_MODE",
    "STUDIO_BRAIN_DISCORD_AUTHORITY_MODE",
    "STUDIO_BRAIN_DISCORD_MEMORY_SCOPE",
    "STUDIO_BRAIN_DISCORD_ACTION_INTENT_HANDLING",
    "STUDIO_BRAIN_DISCORD_REPLY_MODE",
    "STUDIO_BRAIN_DISCORD_CODEX_EXECUTABLE",
    "STUDIO_BRAIN_DISCORD_CODEX_MODEL",
    "STUDIO_BRAIN_DISCORD_CODEX_REASONING_EFFORT",
    "STUDIO_BRAIN_DISCORD_CODEX_EXEC_ROOT",
    "STUDIO_BRAIN_DISCORD_CODEX_TIMEOUT_MS",
    "STUDIO_BRAIN_DISCORD_CODEX_HISTORY_LIMIT",
    "STUDIO_BRAIN_DISCORD_ACTIONS_ROOT",
    "STUDIO_BRAIN_DISCORD_ACTION_TIMEOUT_MS",
    "STUDIO_BRAIN_DISCORD_ACTIONS_FULL_PERMISSIONS",
    "STUDIO_BRAIN_DISCORD_GUILD_ID",
    "STUDIO_BRAIN_DISCORD_CHANNEL_ID",
)
DISCORD_ENV_MAPPINGS = {
    "DISCORD_APPLICATION_ID": "STUDIO_BRAIN_DISCORD_APPLICATION_ID",
}
LOCAL_EXCLUDES = {
    ".env",
    ".env.local",
    ".studio-brain.runtime.lock",
    "studio-brain.log",
}


def load_env() -> dict[str, str]:
    return load_studiobrain_deploy_env(
        env_path=ENV_PATH,
        home_env_path=HOME_STUDIO_MCP_ENV_PATH,
    )


def load_optional_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_optional_env_files(paths: tuple[Path, ...]) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in paths:
        values.update(load_optional_env_file(path))
    return values


def resolve_local_google_adc_paths(env_values: dict[str, str]) -> tuple[Path, ...]:
    raw_candidates = (
        env_values.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
        str(DEFAULT_LOCAL_GOOGLE_ADC_PATH),
    )
    resolved: list[Path] = []
    seen: set[str] = set()
    for raw_candidate in raw_candidates:
        candidate = str(raw_candidate or "").strip()
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        normalized = str(path.resolve()) if path.exists() else str(path)
        if normalized in seen or not path.exists():
            continue
        seen.add(normalized)
        resolved.append(path)
    return tuple(resolved)


def load_drift_paths() -> tuple[str, ...]:
    payload = json.loads(HOST_DRIFT_ALLOWLIST_PATH.read_text(encoding="utf-8"))
    entries = payload.get("entries", [])
    paths = []
    for entry in entries:
        path = str(entry.get("path", "")).strip()
        if path:
            paths.append(path)
    if not paths:
        raise SystemExit("host drift allowlist has no paths")
    return tuple(paths)


def load_integrity_support_paths() -> tuple[Path, ...]:
    payload = json.loads(INTEGRITY_MANIFEST_PATH.read_text(encoding="utf-8"))
    files = payload.get("files", [])
    paths: list[Path] = []
    for entry in files:
        raw_path = str(entry.get("path", "")).strip()
        if not raw_path or raw_path.startswith("studio-brain/"):
            continue
        paths.append(REPO_ROOT / raw_path)
    deduped: list[Path] = []
    seen: set[str] = set()
    for path in [*STATIC_SUPPORT_PATHS, *paths]:
        normalized = str(path.resolve())
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(path)
    return tuple(deduped)


def run_local_build() -> None:
    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    result = subprocess.run(
        [npm_command, "--prefix", str(LOCAL_STUDIO_BRAIN), "run", "build"],
        cwd=REPO_ROOT,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"local Studio Brain build failed with code {result.returncode}")


def create_archive() -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    archive_path = Path(tempfile.gettempdir()) / f"studio-brain-host-deploy-{timestamp}.tar.gz"
    with tarfile.open(archive_path, "w:gz") as tar:
        archive_roots = [LOCAL_STUDIO_BRAIN, *load_integrity_support_paths()]
        for root_path in archive_roots:
            if not root_path.exists():
                continue
            if root_path.is_dir():
                seen: set[str] = set()
                paths = []
                for pattern in ("*", ".*"):
                    for path in root_path.rglob(pattern):
                        normalized = str(path.resolve())
                        if normalized in seen:
                            continue
                        seen.add(normalized)
                        paths.append(path)
            else:
                paths = [root_path]
            for path in paths:
                rel = path.relative_to(REPO_ROOT)
                parts = set(rel.parts)
                if "node_modules" in parts or "output" in parts or ".git" in parts:
                    continue
                if path.name in LOCAL_EXCLUDES:
                    continue
                if path.suffix == ".sh":
                    normalized = path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")
                    tar_info = tar.gettarinfo(str(path), arcname=rel.as_posix())
                    tar_info.size = len(normalized)
                    tar.addfile(tar_info, BytesIO(normalized))
                    continue
                tar.add(path, arcname=rel.as_posix())
    return archive_path


def ssh_exec(ssh: "paramiko.SSHClient", command: str, timeout: int = 120) -> tuple[str, str, int]:
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    return out, err, code


def extract_pid_candidate(text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.isdigit():
            return line
    return None


def resolve_remote_node_binary(ssh: "paramiko.SSHClient", timeout: int = 30) -> str:
    out, err, code = ssh_exec(ssh, "bash -lc 'command -v node'", timeout=timeout)
    candidate = next((line.strip() for line in out.splitlines() if line.strip()), "")
    if code != 0 or not candidate:
        raise RuntimeError(err or out or "failed to resolve remote node binary")
    return candidate


def ensure_remote_dir(ssh: "paramiko.SSHClient", path: str, timeout: int = 30) -> None:
    out, err, code = ssh_exec(ssh, f"mkdir -p {path}", timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or f"failed to create remote directory {path}")


def upload_optional_file(
    ssh: "paramiko.SSHClient",
    sftp: "paramiko.SFTPClient",
    local_paths: tuple[Path, ...],
    remote_path: str,
    mode: int = 0o600,
) -> dict[str, object]:
    local_path = next((path for path in local_paths if path.exists()), None)
    if local_path is None:
        return {"uploaded": False, "path": remote_path, "source": "missing-local-file"}
    ensure_remote_dir(ssh, Path(remote_path).parent.as_posix())
    sftp.put(str(local_path), remote_path)
    try:
        sftp.chmod(remote_path, mode)
    except OSError:
        pass
    return {"uploaded": True, "path": remote_path, "source": str(local_path)}


def collect_discord_runtime_env(values: dict[str, str]) -> dict[str, str]:
    runtime_values: dict[str, str] = {}
    for key in DISCORD_ENV_KEYS_TO_MIRROR:
        value = values.get(key, "").strip()
        if value:
            runtime_values[key] = value
    for source_key, target_key in DISCORD_ENV_MAPPINGS.items():
        value = values.get(source_key, "").strip()
        if value:
            runtime_values[target_key] = value
    if runtime_values.get("STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET"):
        runtime_values.setdefault("STUDIO_BRAIN_MEMORY_INGEST_ENABLED", "true")
    return runtime_values


def sync_remote_env_values(
    ssh: "paramiko.SSHClient",
    updates: dict[str, str],
    *,
    remote_env_path: str = f"{REMOTE_ROOT}/.env.local",
    timeout: int = 30,
) -> dict[str, object]:
    if not updates:
        return {"updated": False, "path": remote_env_path, "keys": []}
    command = f"""
python3 - <<'PY'
from pathlib import Path
import json

path = Path({json.dumps(remote_env_path)})
updates = {json.dumps(updates)}

lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
updated_keys = set()
for index, raw_line in enumerate(lines):
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#") or "=" not in raw_line:
        continue
    key, _ = raw_line.split("=", 1)
    normalized_key = key.strip()
    if normalized_key in updates:
        lines[index] = f"{{normalized_key}}={{updates[normalized_key]}}"
        updated_keys.add(normalized_key)

for key, value in updates.items():
    if key in updated_keys:
        continue
    if lines and lines[-1].strip():
        lines.append("")
    lines.append(f"{{key}}={{value}}")

path.parent.mkdir(parents=True, exist_ok=True)
path.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
try:
    path.chmod(0o600)
except OSError:
    pass

print(json.dumps({{"updated": True, "path": str(path), "keys": sorted(updates.keys())}}))
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or f"failed to update remote env values in {remote_env_path}")
    parsed = extract_json_payload(out.strip())
    if isinstance(parsed, dict):
        return parsed
    return {"updated": True, "path": remote_env_path, "keys": sorted(updates.keys())}


def render_remote_service_unit(node_binary: str) -> str:
    return (
        dedent(
            f"""
            [Unit]
            Description=Studio Brain API (Monsoonfire)
            After=network-online.target
            Wants=network-online.target

            [Service]
            Type=simple
            WorkingDirectory={REMOTE_ROOT}
            EnvironmentFile={REMOTE_ROOT}/.env
            EnvironmentFile=-{REMOTE_ROOT}/.env.local
            ExecStart={node_binary} lib/index.js
            Restart=always
            RestartSec=5
            KillSignal=SIGINT
            TimeoutStopSec=30
            StandardOutput=journal
            StandardError=journal

            [Install]
            WantedBy=default.target
            """
        ).strip()
        + "\n"
    )


def restart_remote(ssh: "paramiko.SSHClient", base_url: str) -> dict[str, object]:
    node_binary = resolve_remote_node_binary(ssh)
    service_unit = render_remote_service_unit(node_binary)
    command = f"""
python3 - <<'PY'
from datetime import datetime, timezone
import os
import signal
import subprocess
import json
from pathlib import Path

root = Path({json.dumps(REMOTE_ROOT)})
service_path = Path({json.dumps(REMOTE_SERVICE_PATH)})
service_unit = {json.dumps(service_unit)}

def load_env_file(path: Path) -> dict[str, str]:
    values = {{}}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values

service_path.parent.mkdir(parents=True, exist_ok=True)
if service_path.exists():
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = service_path.with_name(f"{{service_path.name}}.bak.{{timestamp}}")
    backup_path.write_text(service_path.read_text(encoding="utf-8"), encoding="utf-8")
service_path.write_text(service_unit, encoding="utf-8")
try:
    service_path.chmod(0o644)
except OSError:
    pass

subprocess.run(["systemctl", "--user", "daemon-reload"], cwd=root, check=True)
subprocess.run(["systemctl", "--user", "stop", "studio-brain.service"], cwd=root, check=False)
subprocess.run(["systemctl", "--user", "reset-failed", "studio-brain.service"], cwd=root, check=False)
subprocess.run("pkill -f 'npm run build && node lib/index.js' || true", shell=True, cwd=root, check=False)
subprocess.run(
    "pkill -f 'node /home/wuff/monsoonfire-portal/studio-brain/node_modules/.bin/tsc -p tsconfig.json' || true",
    shell=True,
    cwd=root,
    check=False,
)
proc_list = subprocess.run("pgrep -f '^node lib/index.js$'", shell=True, capture_output=True, text=True, cwd=root)
for line in proc_list.stdout.splitlines():
    line = line.strip()
    if line.isdigit():
        try:
            os.kill(int(line), signal.SIGTERM)
        except ProcessLookupError:
            pass
subprocess.run("pkill -f '^node lib/index.js$' || true", shell=True, cwd=root, check=False)
lock_path = root / ".studio-brain.runtime.lock"
if lock_path.exists():
    lock_path.unlink()
subprocess.run(["systemctl", "--user", "start", "studio-brain.service"], cwd=root, check=True)
status = subprocess.run(
    ["systemctl", "--user", "show", "studio-brain.service", "-p", "MainPID", "-p", "ActiveState", "-p", "SubState"],
    cwd=root,
    capture_output=True,
    text=True,
    check=True,
)
payload = {{}}
for line in status.stdout.splitlines():
    if "=" not in line:
        continue
    key, value = line.split("=", 1)
    payload[key] = value
print(json.dumps(payload))
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=30)
    status_payload = extract_json_payload(out.strip()) if out.strip() else None
    pid = str((status_payload or {}).get("MainPID", "")).strip() if isinstance(status_payload, dict) else ""
    if not pid:
        if code != 0:
            raise RuntimeError(err or out or "remote restart failed")
        raise RuntimeError(f"restart did not return a pid: {out!r}")
    health = None
    for _ in range(90):
        try:
            with urllib.request.urlopen(f"{base_url.rstrip('/')}/healthz", timeout=5) as response:
                if response.status == 200:
                    health = json.loads(response.read().decode())
                    break
        except Exception:
            time.sleep(1)
    if health is None:
        if code != 0:
            raise RuntimeError(err or out or "remote restart failed")
        raise RuntimeError("service did not return healthy after restart")
    status_out, _, _ = ssh_exec(
        ssh,
        "systemctl --user show studio-brain.service -p MainPID -p ActiveState -p SubState -p ExecStart -p NRestarts",
        timeout=30,
    )
    journal_out, _, _ = ssh_exec(ssh, "journalctl --user -u studio-brain.service -n 120 --no-pager", timeout=30)
    return {
        "pid": pid,
        "nodeBinary": node_binary,
        "restartExitCode": code,
        "restartStdout": [line for line in out.splitlines() if line.strip()][-10:],
        "restartStderr": [line for line in err.splitlines() if line.strip()][-10:],
        "health": health,
        "resumeFailureInTail": "autonomic_loop_driver_resume_failed" in journal_out,
        "tail": journal_out.splitlines()[-25:],
        "serviceState": [line for line in status_out.splitlines() if line.strip()],
    }


def install_remote_discord_relay(ssh: "paramiko.SSHClient") -> dict[str, object]:
    local_installer = REPO_ROOT / "scripts" / "install-studiobrain-discord-relay.sh"
    if not local_installer.exists():
        return {
            "ok": True,
            "skipped": True,
            "reason": "source_missing",
            "message": "Current checkout does not include scripts/install-studiobrain-discord-relay.sh; leaving any existing host relay install unchanged.",
            "stdout": [],
            "stderr": [],
            "timerState": [],
        }
    command = f"cd {REMOTE_PARENT} && bash ./scripts/install-studiobrain-discord-relay.sh"
    out, err, code = ssh_exec(ssh, command, timeout=180)
    timer_state, _, _ = ssh_exec(
        ssh,
        "systemctl show -p ActiveState -p SubState -p UnitFileState -p NextElapseUSecRealtime studio-brain-discord-relay.timer",
        timeout=30,
    )
    return {
        "ok": code == 0,
        "exitCode": code,
        "stdout": [line for line in out.splitlines() if line.strip()][-20:],
        "stderr": [line for line in err.splitlines() if line.strip()][-20:],
        "timerState": [line for line in timer_state.splitlines() if line.strip()],
    }


def run_remote_json(ssh: "paramiko.SSHClient", command: str, timeout: int = 120) -> dict[str, object]:
    wrapped_command = f"""
python3 - <<'PY'
import json
import subprocess
import sys

command = {json.dumps(command)}
result = subprocess.run(command, shell=True, text=True, capture_output=True, check=False)
payload = {{
    "returncode": result.returncode,
    "stdout": result.stdout,
    "stderr": result.stderr,
}}
sys.stdout.write(json.dumps(payload))
PY
"""
    out, err, code = ssh_exec(ssh, wrapped_command, timeout=timeout)
    wrapper_payload = None
    try:
        wrapper_payload = json.loads(out.strip())
    except json.JSONDecodeError:
        wrapper_payload = None
    if code != 0 or wrapper_payload is None:
        combined = "\n".join([segment for segment in [out.strip(), err.strip()] if segment]).strip()
        return {
            "ok": False,
            "exitCode": code,
            "parsed": extract_json_payload(combined),
            "output": combined[-4000:],
        }
    combined = "\n".join(
        [
            segment
            for segment in [
                str(wrapper_payload.get("stdout", "")).strip(),
                str(wrapper_payload.get("stderr", "")).strip(),
            ]
            if segment
        ]
    ).strip()
    parsed = extract_json_payload(combined)
    return {
        "ok": int(wrapper_payload.get("returncode", 1)) == 0 and parsed is not None,
        "exitCode": int(wrapper_payload.get("returncode", 1)),
        "parsed": parsed,
        "output": combined[-4000:],
    }


def run_local_json(command: list[str]) -> dict[str, object]:
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    combined = "\n".join([segment for segment in [result.stdout.strip(), result.stderr.strip()] if segment]).strip()
    parsed = extract_json_payload(combined)
    return {
        "ok": result.returncode == 0 and parsed is not None,
        "exitCode": result.returncode,
        "parsed": parsed,
        "output": combined[-4000:],
    }


def run_local_json_with_env(command: list[str], env: dict[str, str]) -> dict[str, object]:
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True, check=False, env=env)
    combined = "\n".join([segment for segment in [result.stdout.strip(), result.stderr.strip()] if segment]).strip()
    parsed = extract_json_payload(combined)
    return {
        "ok": result.returncode == 0 and parsed is not None,
        "exitCode": result.returncode,
        "parsed": parsed,
        "output": combined[-4000:],
    }


def mint_staff_id_token(extra_env: dict[str, str]) -> dict[str, object]:
    command = [
        "node",
        "--input-type=module",
        "-e",
        (
            "import { mintStaffIdTokenFromPortalEnv } from './scripts/lib/firebase-auth-token.mjs';"
            "const result = await mintStaffIdTokenFromPortalEnv();"
            "process.stdout.write(JSON.stringify(result));"
            "if (!result.ok) process.exit(1);"
        ),
    ]
    result = run_local_json_with_env(command, {**os.environ, **extra_env})
    return result


def extract_json_payload(text: str) -> dict[str, object] | list[object] | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    best_payload = None
    best_size = -1
    for start, opener in enumerate(text):
        if opener not in "{[":
            continue
        closer = "}" if opener == "{" else "]"
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                    continue
                if char == "\\":
                    escaped = True
                    continue
                if char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
                continue
            if char == opener:
                depth += 1
                continue
            if char == closer:
                depth -= 1
                if depth == 0:
                    candidate = text[start : index + 1]
                    try:
                        parsed = json.loads(candidate)
                    except json.JSONDecodeError:
                        break
                    if len(candidate) > best_size:
                        best_payload = parsed
                        best_size = len(candidate)
                    break
                if depth < 0:
                    break
    return best_payload


def read_remote_secret_value(ssh: "paramiko.SSHClient", key: str, timeout: int = 30) -> str:
    command = f"""
python3 - <<'PY'
from pathlib import Path

root = Path({json.dumps(REMOTE_ROOT)})
needle = {json.dumps(key)}

def parse_env_file(path: Path) -> str:
    if not path.exists():
        return ""
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        current_key, value = line.split("=", 1)
        if current_key.strip() == needle:
            print(value.strip().strip('"').strip("'"))
            return value
    return ""

for name in (".env.local", ".env"):
    found = parse_env_file(root / name)
    if found:
        raise SystemExit(0)

raise SystemExit(1)
PY
"""
    out, _, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        return ""
    return out.strip()


def read_remote_process_env_value(
    ssh: "paramiko.SSHClient",
    key: str,
    pid: str | None = None,
    timeout: int = 30,
) -> str:
    pid_candidate = str(pid or "").strip()
    command = f"""
python3 - <<'PY'
from pathlib import Path
import subprocess

needle = {json.dumps(key)}
pid = {json.dumps(pid_candidate)}

candidate_pids = []
if pid:
    candidate_pids.append(pid)

for proc in Path("/proc").iterdir():
    if not proc.name.isdigit() or proc.name in candidate_pids:
        continue
    try:
        cmdline = (proc / "cmdline").read_text("utf-8", "ignore").replace("\\0", " ").strip()
    except Exception:
        continue
    if cmdline == "node lib/index.js":
        candidate_pids.append(proc.name)

for candidate_pid in candidate_pids:
    try:
        data = Path(f"/proc/{{candidate_pid}}/environ").read_bytes().decode("utf-8", "ignore").split("\\0")
    except Exception:
        continue
    for entry in data:
        if not entry or "=" not in entry:
            continue
        current_key, value = entry.split("=", 1)
        if current_key == needle:
            print(value.strip())
            raise SystemExit(0)

raise SystemExit(1)
PY
"""
    out, _, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        return ""
    return out.strip()


def ensure_remote_admin_token(ssh: "paramiko.SSHClient", timeout: int = 30) -> tuple[str, str]:
    existing = read_remote_secret_value(ssh, "STUDIO_BRAIN_ADMIN_TOKEN", timeout=timeout)
    if existing:
        return existing, "remote-env-file"

    provisioned = secrets.token_urlsafe(32)
    command = f"""
python3 - <<'PY'
from pathlib import Path

root = Path({json.dumps(REMOTE_ROOT)})
path = root / ".env.local"
needle = "STUDIO_BRAIN_ADMIN_TOKEN"
token = {json.dumps(provisioned)}

lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
for index, raw_line in enumerate(lines):
    stripped = raw_line.strip()
    if not stripped or stripped.startswith("#") or "=" not in raw_line:
        continue
    key, _ = raw_line.split("=", 1)
    if key.strip() == needle:
        lines[index] = f"{{needle}}={{token}}"
        break
else:
    if lines and lines[-1].strip():
        lines.append("")
    lines.append("# provisioned by scripts/deploy-studio-brain-host.py for Gate D dual-control")
    lines.append(f"{{needle}}={{token}}")

path.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
try:
    path.chmod(0o600)
except OSError:
    pass
print("provisioned")
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or "failed to provision remote admin token")
    return provisioned, "provisioned-remote-env-local"


def deploy() -> dict[str, object]:
    env = load_env()
    portal_env = load_optional_env_files((PORTAL_ENV_PATH, HOME_PORTAL_ENV_PATH))
    studio_env = load_optional_env_files(
        (
            STUDIO_AUTOMATION_ENV_PATH,
            HOME_STUDIO_AUTOMATION_ENV_PATH,
            LOCAL_STUDIO_BRAIN / ".env.local",
            LOCAL_STUDIO_BRAIN / ".env",
        )
    )
    discord_env = load_optional_env_files((DISCORD_ENV_PATH, HOME_DISCORD_ENV_PATH))
    discord_runtime_env = collect_discord_runtime_env(discord_env)
    google_adc_paths = resolve_local_google_adc_paths(portal_env)
    drift_paths = load_drift_paths()
    run_local_build()
    archive = create_archive()
    ssh, ssh_auth = connect_studiobrain_ssh(env, timeout=10)
    sftp = ssh.open_sftp()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    remote_archive = f"/tmp/studio-brain-host-deploy-{timestamp}.tar.gz"
    backup_dir = f"/home/wuff/studio-brain-drift-backup-{timestamp}"
    try:
        sftp.put(str(archive), remote_archive)
        discord_env_sync = upload_optional_file(
            ssh,
            sftp,
            (DISCORD_ENV_PATH, HOME_DISCORD_ENV_PATH),
            f"{REMOTE_PARENT}/secrets/studio-brain/discord-mcp.env",
        )
        portal_env_sync = upload_optional_file(
            ssh,
            sftp,
            (PORTAL_ENV_PATH, HOME_PORTAL_ENV_PATH),
            REMOTE_PORTAL_ENV_PATH,
        )
        portal_staff_credentials_sync = upload_optional_file(
            ssh,
            sftp,
            (PORTAL_AGENT_STAFF_JSON_PATH, HOME_PORTAL_AGENT_STAFF_JSON_PATH),
            REMOTE_PORTAL_AGENT_STAFF_JSON_PATH,
        )
        portal_google_adc_sync = upload_optional_file(
            ssh,
            sftp,
            google_adc_paths,
            REMOTE_PORTAL_GOOGLE_ADC_PATH,
        )
        portal_env_updates = {"PORTAL_AGENT_STAFF_CREDENTIALS": REMOTE_PORTAL_AGENT_STAFF_JSON_PATH}
        if portal_google_adc_sync.get("uploaded"):
            portal_env_updates["GOOGLE_APPLICATION_CREDENTIALS"] = REMOTE_PORTAL_GOOGLE_ADC_PATH
        portal_runtime_sync = sync_remote_env_values(
            ssh,
            portal_env_updates,
            remote_env_path=REMOTE_PORTAL_ENV_PATH,
        )
        move_lines = "\n".join(
            f"if [ -e {REMOTE_ROOT}/{path} ]; then mkdir -p {backup_dir}/{Path(path).parent.as_posix()}; mv {REMOTE_ROOT}/{path} {backup_dir}/{path}; fi"
            for path in drift_paths
        )
        command = f"""
set -e
mkdir -p {backup_dir}
{move_lines}
cd {REMOTE_PARENT}
tar -xzf {remote_archive}
"""
        out, err, code = ssh_exec(ssh, command, timeout=180)
        if code != 0:
            raise RuntimeError(err or out or "remote sync failed")
        fail2ban = install_remote_fail2ban_allowlist(ssh, env=env, remote_parent=REMOTE_PARENT)
        runtime_env_updates = dict(discord_runtime_env)
        if portal_google_adc_sync.get("uploaded"):
            runtime_env_updates["GOOGLE_APPLICATION_CREDENTIALS"] = REMOTE_PORTAL_GOOGLE_ADC_PATH
        runtime_env_sync = sync_remote_env_values(ssh, runtime_env_updates)
        remote_admin_token, admin_token_source = ensure_remote_admin_token(ssh)
        restart = restart_remote(ssh, env["STUDIO_BRAIN_MCP_BASE_URL"])
        discord_relay = install_remote_discord_relay(ssh)
        backup_refresh = run_remote_json(
            ssh,
            f"cd {REMOTE_PARENT} && node ./scripts/studiobrain-backup-drill.mjs verify --json --strict --mode live_host_authoritative --approved-remote-runner",
            timeout=180,
        )
        backup_freshness = run_remote_json(
            ssh,
            f"cd {REMOTE_PARENT} && node ./scripts/studiobrain-backup-drill.mjs verify --freshness-only --json --strict --mode live_host_authoritative --approved-remote-runner",
            timeout=180,
        )
        ops_cockpit = run_remote_json(
            ssh,
            f"cd {REMOTE_PARENT} && node ./scripts/ops-cockpit.mjs start --json",
            timeout=180,
        )
        posture = run_remote_json(
            ssh,
            (
                f"cd {REMOTE_PARENT} && "
                "node ./scripts/studiobrain-status.mjs --json --require-safe "
                "--no-auth-probe --no-backup --no-evidence "
                "--mode live_host_authoritative --approved-remote-runner "
                "--artifact output/studio-posture/latest.json"
            ),
            timeout=180,
        )
        auth_env = {**os.environ, **portal_env, **studio_env}
        id_token_source = "environment" if auth_env.get("STUDIO_BRAIN_ID_TOKEN") else "minted"
        resolved_admin_token_source = admin_token_source
        if remote_admin_token:
            auth_env["STUDIO_BRAIN_ADMIN_TOKEN"] = remote_admin_token
        if not auth_env.get("STUDIO_BRAIN_ID_TOKEN"):
            minted = mint_staff_id_token(auth_env)
            minted_payload = minted.get("parsed") or {}
            if minted.get("ok") and minted_payload.get("token"):
                auth_env["STUDIO_BRAIN_ID_TOKEN"] = str(minted_payload["token"])
                id_token_source = str(minted_payload.get("source") or "minted")
            else:
                id_token_source = f"unavailable:{(minted_payload or {}).get('reason') or minted.get('output') or 'mint-failed'}"
        if not auth_env.get("STUDIO_BRAIN_ADMIN_TOKEN"):
            runtime_admin_token = read_remote_process_env_value(
                ssh,
                "STUDIO_BRAIN_ADMIN_TOKEN",
                pid=str(restart.get("pid") or "").strip(),
            )
            if runtime_admin_token:
                auth_env["STUDIO_BRAIN_ADMIN_TOKEN"] = runtime_admin_token
                resolved_admin_token_source = "remote-runtime-env"
            else:
                resolved_admin_token_source = "unavailable:missing-remote-admin-token"
        auth_probe = run_local_json_with_env(
            [
                "node",
                "./scripts/test-studio-brain-auth.mjs",
                "--json",
                "--mode",
                "authenticated_privileged_check",
                "--base-url",
                env["STUDIO_BRAIN_MCP_BASE_URL"],
            ],
            auth_env,
        )
        blockers = []
        if restart["resumeFailureInTail"]:
            blockers.append("resume_failure_signature_reappeared")
        if not fail2ban["ok"]:
            blockers.append("ssh_fail2ban_allowlist_install_failed")
        if not discord_relay["ok"]:
            blockers.append("discord_relay_install_failed")
        if not posture["ok"]:
            blockers.append("authoritative_posture_failed")
        if not backup_freshness["ok"]:
            blockers.append("backup_freshness_failed")
        if not auth_probe["ok"]:
            blockers.append("privileged_auth_probe_failed")
        return {
            "status": "pass" if not blockers else "shadow_fallback_required",
            "remoteArchive": remote_archive,
            "backupDir": backup_dir,
            "sshAuth": ssh_auth,
            "fail2ban": fail2ban,
            "discordEnvSync": discord_env_sync,
            "portalEnvSync": portal_env_sync,
            "portalStaffCredentialsSync": portal_staff_credentials_sync,
            "portalGoogleAdcSync": portal_google_adc_sync,
            "portalRuntimeSync": portal_runtime_sync,
            "runtimeEnvSync": runtime_env_sync,
            "restart": restart,
            "discordRelay": discord_relay,
            "backupRefresh": backup_refresh,
            "opsCockpit": ops_cockpit,
            "posture": posture,
            "backupFreshness": backup_freshness,
            "authProbe": auth_probe,
            "authBootstrap": {
                "idTokenSource": id_token_source,
                "adminTokenSource": resolved_admin_token_source,
            },
            "blockers": blockers,
        }
    finally:
        sftp.close()
        ssh.close()
        archive.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy the local Studio Brain runtime to the remote host.")
    parser.add_argument("--json", action="store_true", help="Emit the deploy result as JSON.")
    args = parser.parse_args()
    result = deploy()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("Studio Brain host deploy succeeded." if result.get("status") == "pass" else "Studio Brain host deploy requires shadow fallback.")
        print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
