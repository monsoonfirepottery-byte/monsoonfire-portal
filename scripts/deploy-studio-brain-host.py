from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.request

try:
    import paramiko
except ImportError as exc:  # pragma: no cover
    raise SystemExit("paramiko is required to deploy Studio Brain to the remote host") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
LOCAL_STUDIO_BRAIN = REPO_ROOT / "studio-brain"
ENV_PATH = REPO_ROOT / "secrets/studio-brain/studio-brain-mcp.env"
PORTAL_ENV_PATH = REPO_ROOT / "secrets/portal/portal-automation.env"
INTEGRITY_MANIFEST_PATH = REPO_ROOT / "studio-brain/.env.integrity.json"
REMOTE_PARENT = "/home/wuff/monsoonfire-portal"
REMOTE_ROOT = f"{REMOTE_PARENT}/studio-brain"
STATIC_SUPPORT_PATHS = (
    REPO_ROOT / ".governance" / "planning",
    REPO_ROOT / "contracts" / "planning.schema.json",
    REPO_ROOT / "scripts" / "lib" / "planning-control-plane.mjs",
)
HOST_DRIFT_ALLOWLIST_PATH = REPO_ROOT / "studio-brain" / "host-drift-allowlist.json"
LOCAL_EXCLUDES = {
    ".env",
    ".env.local",
    ".studio-brain.runtime.lock",
    "studio-brain.log",
}


def load_env() -> dict[str, str]:
    text = ENV_PATH.read_text()
    keys = [
        "STUDIO_BRAIN_DEPLOY_HOST",
        "STUDIO_BRAIN_DEPLOY_PORT",
        "STUDIO_BRAIN_DEPLOY_USER",
        "STUDIO_BRAIN_DEPLOY_PASSWORD",
        "STUDIO_BRAIN_MCP_BASE_URL",
    ]
    values: dict[str, str] = {}
    for key in keys:
        match = re.search(rf"^{key}=(.*)$", text, re.M)
        if not match or not match.group(1).strip():
            raise SystemExit(f"missing required deploy secret: {key}")
        values[key] = match.group(1).strip()
    return values


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
            paths = root_path.rglob("*") if root_path.is_dir() else [root_path]
            for path in paths:
                rel = path.relative_to(REPO_ROOT)
                parts = set(rel.parts)
                if "node_modules" in parts or "output" in parts or ".git" in parts:
                    continue
                if path.name in LOCAL_EXCLUDES:
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


def restart_remote(ssh: "paramiko.SSHClient", base_url: str) -> dict[str, object]:
    command = f"""
python3 - <<'PY'
import os
import signal
import subprocess
from pathlib import Path

root = Path({json.dumps(REMOTE_ROOT)})

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

proc_list = subprocess.run("pgrep -f 'node lib/index.js'", shell=True, capture_output=True, text=True, cwd=root)
for line in proc_list.stdout.splitlines():
    line = line.strip()
    if line.isdigit():
        try:
            os.kill(int(line), signal.SIGTERM)
        except ProcessLookupError:
            pass
subprocess.run('pkill -f "node lib/index.js" || true', shell=True, cwd=root, check=False)
lock_path = root / ".studio-brain.runtime.lock"
if lock_path.exists():
    lock_path.unlink()

env = os.environ.copy()
env.update(load_env_file(root / ".env"))
env.update(load_env_file(root / ".env.local"))
log = open(root / "studio-brain.log", "a", encoding="utf-8")
proc = subprocess.Popen(
    ["node", "lib/index.js"],
    cwd=root,
    env=env,
    stdout=log,
    stderr=log,
    start_new_session=True,
)
print(proc.pid)
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=30)
    pid = extract_pid_candidate(out)
    if pid is None:
        if code != 0:
            raise RuntimeError(err or out or "remote restart failed")
        raise RuntimeError(f"restart did not return a pid: {out!r}")
    health = None
    for _ in range(40):
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
    log_out, _, _ = ssh_exec(ssh, f"cd {REMOTE_ROOT} && tail -n 120 studio-brain.log", timeout=30)
    return {
        "pid": pid,
        "restartExitCode": code,
        "restartStdout": [line for line in out.splitlines() if line.strip()][-10:],
        "restartStderr": [line for line in err.splitlines() if line.strip()][-10:],
        "health": health,
        "resumeFailureInTail": "autonomic_loop_driver_resume_failed" in log_out,
        "tail": log_out.splitlines()[-25:],
    }


def run_remote_json(ssh: "paramiko.SSHClient", command: str, timeout: int = 120) -> dict[str, object]:
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    combined = "\n".join([segment for segment in [out.strip(), err.strip()] if segment]).strip()
    parsed = extract_json_payload(combined)
    return {
        "ok": code == 0 and parsed is not None,
        "exitCode": code,
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

    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start < 0:
            continue
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
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
                if depth < 0:
                    break
    return None


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

if not pid:
    proc = subprocess.run("pgrep -f 'node lib/index.js'", shell=True, capture_output=True, text=True)
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    pid = lines[-1] if lines else ""

if not pid:
    raise SystemExit(1)

data = Path(f"/proc/{{pid}}/environ").read_bytes().decode("utf-8", "ignore").split("\\0")
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


def deploy() -> dict[str, object]:
    env = load_env()
    portal_env = load_optional_env_file(PORTAL_ENV_PATH)
    drift_paths = load_drift_paths()
    run_local_build()
    archive = create_archive()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        env["STUDIO_BRAIN_DEPLOY_HOST"],
        port=int(env["STUDIO_BRAIN_DEPLOY_PORT"]),
        username=env["STUDIO_BRAIN_DEPLOY_USER"],
        password=env["STUDIO_BRAIN_DEPLOY_PASSWORD"],
        timeout=10,
    )
    sftp = ssh.open_sftp()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    remote_archive = f"/tmp/studio-brain-host-deploy-{timestamp}.tar.gz"
    backup_dir = f"/home/wuff/studio-brain-drift-backup-{timestamp}"
    try:
        sftp.put(str(archive), remote_archive)
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
        restart = restart_remote(ssh, env["STUDIO_BRAIN_MCP_BASE_URL"])
        posture = run_remote_json(
            ssh,
            f"cd {REMOTE_PARENT} && node ./scripts/studiobrain-status.mjs --json --require-safe --mode live_host_authoritative --approved-remote-runner --artifact output/studio-posture/latest.json",
            timeout=180,
        )
        backup_freshness = run_remote_json(
            ssh,
            f"cd {REMOTE_PARENT} && node ./scripts/studiobrain-backup-drill.mjs verify --freshness-only --json --strict --mode live_host_authoritative --approved-remote-runner",
            timeout=180,
        )
        auth_env = {**os.environ, **portal_env}
        id_token_source = "environment" if auth_env.get("STUDIO_BRAIN_ID_TOKEN") else "minted"
        admin_token_source = "environment" if auth_env.get("STUDIO_BRAIN_ADMIN_TOKEN") else "remote-runtime"
        if not auth_env.get("STUDIO_BRAIN_ID_TOKEN"):
            minted = mint_staff_id_token(auth_env)
            minted_payload = minted.get("parsed") or {}
            if minted.get("ok") and minted_payload.get("token"):
                auth_env["STUDIO_BRAIN_ID_TOKEN"] = str(minted_payload["token"])
                id_token_source = str(minted_payload.get("source") or "minted")
            else:
                id_token_source = f"unavailable:{(minted_payload or {}).get('reason') or minted.get('output') or 'mint-failed'}"
        if not auth_env.get("STUDIO_BRAIN_ADMIN_TOKEN"):
            remote_admin_token = read_remote_secret_value(ssh, "STUDIO_BRAIN_ADMIN_TOKEN")
            if not remote_admin_token:
                remote_admin_token = read_remote_process_env_value(
                    ssh,
                    "STUDIO_BRAIN_ADMIN_TOKEN",
                    pid=str(restart.get("pid") or "").strip(),
                )
            if remote_admin_token:
                auth_env["STUDIO_BRAIN_ADMIN_TOKEN"] = remote_admin_token
                admin_token_source = "remote-runtime-env"
            else:
                admin_token_source = "unavailable:missing-remote-admin-token"
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
            "restart": restart,
            "posture": posture,
            "backupFreshness": backup_freshness,
            "authProbe": auth_probe,
            "authBootstrap": {
                "idTokenSource": id_token_source,
                "adminTokenSource": admin_token_source,
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
