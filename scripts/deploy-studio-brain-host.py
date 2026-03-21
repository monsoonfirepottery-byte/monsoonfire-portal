from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import os
import re
import shutil
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
REMOTE_PARENT = "/home/wuff/monsoonfire-portal"
REMOTE_ROOT = f"{REMOTE_PARENT}/studio-brain"
SUPPORT_PATHS = (
    REPO_ROOT / ".governance" / "planning",
    REPO_ROOT / "contracts" / "planning.schema.json",
    REPO_ROOT / "scripts" / "lib" / "planning-control-plane.mjs",
)
DRIFT_PATHS = (
    "src/autonomic",
    "lib/autonomic",
    "lib/loopDriver.js",
)
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
        archive_roots = [LOCAL_STUDIO_BRAIN, *SUPPORT_PATHS]
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


def deploy() -> dict[str, object]:
    env = load_env()
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
            for path in DRIFT_PATHS
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
        return {
            "remoteArchive": remote_archive,
            "backupDir": backup_dir,
            "restart": restart,
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
        print("Studio Brain host deploy succeeded.")
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
