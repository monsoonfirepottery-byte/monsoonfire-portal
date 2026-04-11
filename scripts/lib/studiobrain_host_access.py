from __future__ import annotations

from pathlib import Path
import json
import os
import re
import shlex
import shutil
import socket
import subprocess

try:
    import paramiko
except ImportError as exc:  # pragma: no cover
    raise SystemExit("paramiko is required for Studio Brain host access") from exc


DEFAULT_STUDIO_BRAIN_SSH_ALIAS = "studiobrain"
DEFAULT_STUDIO_BRAIN_KEY_NAME = "studiobrain-codex"
DEFAULT_FAIL2BAN_IGNORE_IPS = ("127.0.0.1/8", "::1")


def is_windows() -> bool:
    return os.name == "nt"


def parse_env_file(path: Path) -> dict[str, str]:
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


def expand_home_path(raw_value: str) -> Path:
    raw = str(raw_value or "").strip()
    if not raw or raw == "~":
        return Path.home()
    if raw.startswith("~/"):
        return Path.home() / raw[2:]
    return Path(raw).expanduser()


def load_studiobrain_deploy_env(
    *,
    env_path: Path,
    home_env_path: Path,
    required_keys: tuple[str, ...] = (
        "STUDIO_BRAIN_DEPLOY_HOST",
        "STUDIO_BRAIN_DEPLOY_PORT",
        "STUDIO_BRAIN_DEPLOY_USER",
        "STUDIO_BRAIN_MCP_BASE_URL",
    ),
) -> dict[str, str]:
    source_path = env_path if env_path.exists() else home_env_path
    file_values = parse_env_file(source_path)
    keys = {
        *required_keys,
        "STUDIO_BRAIN_DEPLOY_PASSWORD",
        "STUDIO_BRAIN_DEPLOY_KEY_PATH",
        "STUDIO_BRAIN_DEPLOY_HOST_ALIAS",
        "STUDIO_BRAIN_FAIL2BAN_IGNORE_IPS",
    }
    values: dict[str, str] = {}
    for key in keys:
        candidate = str(os.environ.get(key, "")).strip() or str(file_values.get(key, "")).strip()
        if candidate:
            values[key] = candidate
    missing = [key for key in required_keys if not values.get(key)]
    if missing:
        raise SystemExit(f"missing required deploy secret(s): {', '.join(missing)}")
    values.setdefault("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", DEFAULT_STUDIO_BRAIN_SSH_ALIAS)
    return values


def _load_ssh_config(config_path: Path) -> "paramiko.SSHConfig | None":
    if not config_path.exists():
        return None
    config = paramiko.SSHConfig()
    with config_path.open("r", encoding="utf-8") as handle:
        config.parse(handle)
    return config


def resolve_ssh_config_identity(
    *,
    aliases: tuple[str, ...],
    host_name: str,
    ssh_config_path: Path | None = None,
) -> dict[str, str]:
    config_path = ssh_config_path or (Path.home() / ".ssh" / "config")
    config = _load_ssh_config(config_path)
    if config is None:
        return {"path": "", "source": ""}
    candidates = [alias.strip() for alias in aliases if str(alias or "").strip()]
    if host_name.strip():
        candidates.append(host_name.strip())
    seen: set[str] = set()
    for candidate in candidates:
        lowered = candidate.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        lookup = config.lookup(candidate)
        identity_files = lookup.get("identityfile") or []
        for raw_identity in identity_files:
            identity_path = expand_home_path(str(raw_identity))
            if identity_path.exists():
                return {
                    "path": str(identity_path),
                    "source": f"ssh config ({config_path})",
                }
        if identity_files:
            return {
                "path": str(expand_home_path(str(identity_files[0]))),
                "source": f"ssh config ({config_path})",
            }
    return {"path": "", "source": ""}


def resolve_studiobrain_key_path(env: dict[str, str]) -> dict[str, str | bool]:
    explicit = str(env.get("STUDIO_BRAIN_DEPLOY_KEY_PATH", "")).strip()
    if explicit:
        path = expand_home_path(explicit)
        return {
            "path": str(path),
            "exists": path.exists(),
            "source": "STUDIO_BRAIN_DEPLOY_KEY_PATH",
        }

    default_path = Path.home() / ".ssh" / DEFAULT_STUDIO_BRAIN_KEY_NAME
    if default_path.exists():
        return {
            "path": str(default_path),
            "exists": True,
            "source": f"default ~/.ssh/{DEFAULT_STUDIO_BRAIN_KEY_NAME}",
        }

    config_identity = resolve_ssh_config_identity(
        aliases=(
            str(env.get("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", "")).strip(),
            DEFAULT_STUDIO_BRAIN_SSH_ALIAS,
        ),
        host_name=str(env.get("STUDIO_BRAIN_DEPLOY_HOST", "")).strip(),
    )
    config_path = str(config_identity.get("path", "")).strip()
    if config_path:
        return {
            "path": config_path,
            "exists": Path(config_path).exists(),
            "source": str(config_identity.get("source", "")).strip(),
        }

    return {
        "path": str(default_path),
        "exists": False,
        "source": f"default ~/.ssh/{DEFAULT_STUDIO_BRAIN_KEY_NAME}",
    }


def resolve_windows_openssh_binary(binary_name: str = "ssh.exe") -> str:
    if not is_windows():
        return ""
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    explicit = system_root / "System32" / "OpenSSH" / binary_name
    if explicit.exists():
        return str(explicit)
    candidate = shutil.which(binary_name)
    if candidate and "System32\\OpenSSH" in candidate:
        return candidate
    return ""


def _powershell_single_quoted(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def ensure_private_key_permissions(key_path: Path) -> dict[str, object]:
    if is_windows():
        shell = shutil.which("pwsh") or shutil.which("pwsh.exe") or shutil.which("powershell") or shutil.which("powershell.exe")
        if not shell:
            raise RuntimeError("PowerShell is required to harden Studio Brain SSH key permissions on Windows")
        key_literal = _powershell_single_quoted(str(key_path))
        script = f"""
$key = {key_literal}
$owner = New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\\$env:USERNAME")
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$allow = [System.Security.AccessControl.AccessControlType]::Allow
foreach ($identity in @("$env:COMPUTERNAME\\$env:USERNAME", 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators')) {{
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, $rights, $allow)
  [void]$acl.AddAccessRule($rule)
}}
Set-Acl -LiteralPath $key -AclObject $acl
"""
        result = subprocess.run(
            [shell, "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "failed to harden Studio Brain SSH key permissions")
        return {
            "platform": "windows",
            "ok": True,
            "method": "powershell-acl",
            "path": str(key_path),
        }

    try:
        key_path.chmod(0o600)
    except OSError as exc:
        raise RuntimeError(f"failed to chmod Studio Brain SSH key {key_path}: {exc}") from exc
    return {
        "platform": "posix",
        "ok": True,
        "method": "chmod-600",
        "path": str(key_path),
    }


def connect_studiobrain_ssh(
    env: dict[str, str],
    *,
    timeout: int = 10,
) -> tuple["paramiko.SSHClient", dict[str, str]]:
    host = env["STUDIO_BRAIN_DEPLOY_HOST"].strip()
    port = int(env["STUDIO_BRAIN_DEPLOY_PORT"])
    username = env["STUDIO_BRAIN_DEPLOY_USER"].strip()
    password = str(env.get("STUDIO_BRAIN_DEPLOY_PASSWORD", "")).strip()
    key_info = resolve_studiobrain_key_path(env)
    attempts: list[tuple[str, dict[str, object], dict[str, str]]] = []
    key_path = str(key_info.get("path", "")).strip()
    if key_path and Path(key_path).exists():
        attempts.append(
            (
                "key",
                {
                    "key_filename": key_path,
                    "allow_agent": False,
                    "look_for_keys": False,
                },
                {
                    "mode": "key",
                    "path": key_path,
                    "source": str(key_info.get("source", "")).strip(),
                    "transport": "paramiko",
                },
            )
        )
    if password:
        attempts.append(
            (
                "password",
                {
                    "password": password,
                    "allow_agent": False,
                    "look_for_keys": False,
                },
                {
                    "mode": "password",
                    "path": "",
                    "source": "STUDIO_BRAIN_DEPLOY_PASSWORD",
                    "transport": "paramiko",
                },
            )
        )
    if not attempts:
        raise RuntimeError("no Studio Brain SSH authentication method is configured")

    failures: list[str] = []
    for _, kwargs, meta in attempts:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(
                host,
                port=port,
                username=username,
                timeout=timeout,
                auth_timeout=timeout,
                banner_timeout=timeout,
                **kwargs,
            )
            return ssh, meta
        except Exception as exc:
            failures.append(f"{meta['mode']}:{exc}")
            ssh.close()
    raise RuntimeError("failed to connect to Studio Brain host via SSH: " + " | ".join(failures))


def ssh_exec(
    ssh: "paramiko.SSHClient",
    command: str,
    timeout: int = 120,
    *,
    get_pty: bool = False,
    stdin_text: str | None = None,
) -> tuple[str, str, int]:
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout, get_pty=get_pty)
    if stdin_text is not None:
        stdin.write(stdin_text)
        stdin.flush()
        try:
            stdin.channel.shutdown_write()
        except Exception:
            pass
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    return out, err, code


def sudo_ssh_exec(
    ssh: "paramiko.SSHClient",
    command: str,
    *,
    env: dict[str, str],
    timeout: int = 120,
) -> tuple[str, str, int]:
    password = str(env.get("STUDIO_BRAIN_DEPLOY_PASSWORD", "")).strip()
    if not password:
        raise RuntimeError("sudo access requires STUDIO_BRAIN_DEPLOY_PASSWORD in the deploy env")
    sudo_command = f"sudo -S -p '' bash -lc {shlex.quote(command)}"
    return ssh_exec(
        ssh,
        sudo_command,
        timeout=timeout,
        stdin_text=password + "\n",
    )


def _split_ignore_ip_values(raw_value: str) -> list[str]:
    values = []
    for entry in re.split(r"[\s,]+", str(raw_value or "").strip()):
        candidate = entry.strip()
        if candidate:
            values.append(candidate)
    return values


def normalize_fail2ban_ip(raw_value: str) -> str:
    candidate = str(raw_value or "").strip()
    if not candidate:
        return ""
    if "/" in candidate:
        return candidate
    return f"{candidate}/128" if ":" in candidate else f"{candidate}/32"


def detect_management_route_ips(env: dict[str, str]) -> list[str]:
    host = env["STUDIO_BRAIN_DEPLOY_HOST"].strip()
    port = int(env["STUDIO_BRAIN_DEPLOY_PORT"])
    candidates: list[str] = []
    seen: set[str] = set()
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM)
    except socket.gaierror:
        infos = []
    for family, socktype, proto, _, sockaddr in infos:
        try:
            with socket.socket(family, socktype, proto) as sock:
                sock.connect(sockaddr)
                local_ip = sock.getsockname()[0]
        except OSError:
            continue
        normalized = normalize_fail2ban_ip(local_ip)
        if normalized and normalized not in seen:
            seen.add(normalized)
            candidates.append(normalized)
    return candidates


def build_fail2ban_ignore_ips(env: dict[str, str]) -> list[str]:
    values = list(DEFAULT_FAIL2BAN_IGNORE_IPS)
    values.extend(detect_management_route_ips(env))
    values.extend(normalize_fail2ban_ip(entry) for entry in _split_ignore_ip_values(env.get("STUDIO_BRAIN_FAIL2BAN_IGNORE_IPS", "")))
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _resolve_local_key_paths(env: dict[str, str]) -> tuple[Path, Path]:
    key_info = resolve_studiobrain_key_path(env)
    key_path = expand_home_path(str(key_info.get("path", "")))
    pub_path = Path(f"{key_path}.pub")
    return key_path, pub_path


def ensure_local_studiobrain_keypair(env: dict[str, str]) -> dict[str, object]:
    key_path, pub_path = _resolve_local_key_paths(env)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    ssh_keygen = shutil.which("ssh-keygen")
    if not ssh_keygen:
        raise RuntimeError("ssh-keygen is required to provision the Studio Brain SSH key")

    generated = False
    if not key_path.exists():
        result = subprocess.run(
            [ssh_keygen, "-t", "ed25519", "-f", str(key_path), "-N", "", "-C", "codex@studiobrain"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "ssh-keygen failed")
        generated = True

    if not pub_path.exists():
        result = subprocess.run(
            [ssh_keygen, "-y", "-f", str(key_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "failed to derive Studio Brain SSH public key")
        pub_path.write_text(result.stdout.strip() + "\n", encoding="utf-8")
    permissions = ensure_private_key_permissions(key_path)

    return {
        "generated": generated,
        "privateKeyPath": str(key_path),
        "publicKeyPath": str(pub_path),
        "privateKeyPermissions": permissions,
    }


def install_remote_public_key(
    ssh: "paramiko.SSHClient",
    *,
    public_key_path: str,
    timeout: int = 30,
) -> dict[str, object]:
    public_key = Path(public_key_path).read_text(encoding="utf-8").strip()
    command = f"""
python3 - <<'PY'
from pathlib import Path

public_key = {json.dumps(public_key)}
ssh_dir = Path.home() / ".ssh"
auth_path = ssh_dir / "authorized_keys"
ssh_dir.mkdir(parents=True, exist_ok=True)
try:
    ssh_dir.chmod(0o700)
except OSError:
    pass
lines = auth_path.read_text(encoding="utf-8").splitlines() if auth_path.exists() else []
stripped = [line.strip() for line in lines if line.strip()]
status = "present"
if public_key not in stripped:
    stripped.append(public_key)
    auth_path.write_text("\\n".join(stripped) + "\\n", encoding="utf-8")
    status = "installed"
elif not auth_path.exists():
    auth_path.write_text(public_key + "\\n", encoding="utf-8")
try:
    auth_path.chmod(0o600)
except OSError:
    pass
print(status)
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or "failed to install Studio Brain SSH public key")
    status = out.strip() or "unknown"
    return {
        "status": status,
        "publicKeyPath": public_key_path,
    }


def _identity_for_ssh_config(key_path: Path) -> str:
    try:
        relative = key_path.relative_to(Path.home())
    except ValueError:
        return str(key_path)
    return f"~/{relative.as_posix()}"


def ensure_local_studiobrain_ssh_config(env: dict[str, str], *, private_key_path: str) -> dict[str, object]:
    alias = str(env.get("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", DEFAULT_STUDIO_BRAIN_SSH_ALIAS)).strip() or DEFAULT_STUDIO_BRAIN_SSH_ALIAS
    host = env["STUDIO_BRAIN_DEPLOY_HOST"].strip()
    user = env["STUDIO_BRAIN_DEPLOY_USER"].strip()
    port = str(env["STUDIO_BRAIN_DEPLOY_PORT"]).strip()
    key_path = expand_home_path(private_key_path)
    config_path = Path.home() / ".ssh" / "config"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    start_marker = "# >>> studiobrain-codex >>>"
    end_marker = "# <<< studiobrain-codex <<<"
    managed_block = "\n".join(
        [
            start_marker,
            f"Host {alias}",
            f"  HostName {host}",
            f"  User {user}",
            f"  Port {port}",
            f"  IdentityFile {_identity_for_ssh_config(key_path)}",
            "  IdentitiesOnly yes",
            "  IdentityAgent none",
            end_marker,
        ]
    )
    existing = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    pattern = re.compile(rf"{re.escape(start_marker)}.*?{re.escape(end_marker)}", re.S)
    if pattern.search(existing):
        updated = pattern.sub(managed_block, existing)
        status = "updated"
    elif existing.strip():
        updated = existing.rstrip() + "\n\n" + managed_block + "\n"
        status = "added"
    else:
        updated = managed_block + "\n"
        status = "created"
    config_path.write_text(updated, encoding="utf-8")
    return {
        "status": status,
        "alias": alias,
        "configPath": str(config_path),
        "identityFile": _identity_for_ssh_config(key_path),
    }


def verify_native_windows_openssh_access(
    env: dict[str, str],
    *,
    use_alias: bool = True,
    timeout: int = 10,
) -> dict[str, object]:
    if not is_windows():
        return {"supported": False, "reason": "not-windows"}
    ssh_binary = resolve_windows_openssh_binary("ssh.exe")
    if not ssh_binary:
        return {"supported": False, "reason": "missing-windows-openssh"}
    key_info = resolve_studiobrain_key_path(env)
    key_path = str(key_info.get("path", "")).strip()
    if not key_path or not Path(key_path).exists():
        return {"supported": False, "reason": "missing-key", "binary": ssh_binary}

    ensure_private_key_permissions(Path(key_path))
    command = "bash -lc 'whoami && hostname && pwd'"
    if use_alias:
        target = str(env.get("STUDIO_BRAIN_DEPLOY_HOST_ALIAS", DEFAULT_STUDIO_BRAIN_SSH_ALIAS)).strip() or DEFAULT_STUDIO_BRAIN_SSH_ALIAS
        args = [
            ssh_binary,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout={}".format(timeout),
            "-o",
            "StrictHostKeyChecking=accept-new",
            target,
            command,
        ]
    else:
        target = f"{env['STUDIO_BRAIN_DEPLOY_USER'].strip()}@{env['STUDIO_BRAIN_DEPLOY_HOST'].strip()}"
        args = [
            ssh_binary,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout={}".format(timeout),
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "IdentityAgent=none",
            "-i",
            key_path,
            "-p",
            str(env["STUDIO_BRAIN_DEPLOY_PORT"]).strip(),
            target,
            command,
        ]

    result = subprocess.run(args, capture_output=True, text=True, check=False)
    return {
        "supported": True,
        "ok": result.returncode == 0,
        "transport": "windows-openssh",
        "binary": ssh_binary,
        "target": target,
        "exitCode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "usingAlias": use_alias,
    }


def install_remote_fail2ban_allowlist(
    ssh: "paramiko.SSHClient",
    *,
    env: dict[str, str],
    remote_parent: str,
    timeout: int = 180,
) -> dict[str, object]:
    ignore_ips = build_fail2ban_ignore_ips(env)
    command = (
        f"cd {shlex.quote(remote_parent)} && "
        f"STUDIO_BRAIN_FAIL2BAN_IGNORE_IPS={shlex.quote(' '.join(ignore_ips))} "
        "bash ./scripts/install-studiobrain-fail2ban-sshd.sh"
    )
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    return {
        "ok": code == 0,
        "exitCode": code,
        "ignoreIps": ignore_ips,
        "stdout": [line for line in out.splitlines() if line.strip()][-20:],
        "stderr": [line for line in err.splitlines() if line.strip()][-20:],
    }


def ensure_remote_directory(ssh: "paramiko.SSHClient", remote_path: str, timeout: int = 30) -> None:
    out, err, code = ssh_exec(ssh, f"mkdir -p {shlex.quote(remote_path)}", timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or f"failed to create remote directory {remote_path}")


def upload_repo_support_paths(
    ssh: "paramiko.SSHClient",
    *,
    repo_root: Path,
    remote_parent: str,
    local_paths: tuple[Path, ...],
    timeout: int = 60,
) -> dict[str, object]:
    uploaded: list[str] = []
    sftp = ssh.open_sftp()
    try:
        for local_root in local_paths:
            if not local_root.exists():
                continue
            candidates = (
                sorted(path for path in local_root.rglob("*") if path.is_file())
                if local_root.is_dir()
                else [local_root]
            )
            for candidate in candidates:
                relative = candidate.relative_to(repo_root).as_posix()
                remote_path = f"{remote_parent.rstrip('/')}/{relative}"
                ensure_remote_directory(ssh, str(Path(remote_path).parent).replace("\\", "/"), timeout=timeout)
                try:
                    payload = candidate.read_text(encoding="utf-8").replace("\r\n", "\n")
                    with sftp.file(remote_path, "w") as handle:
                        handle.write(payload)
                except UnicodeDecodeError:
                    sftp.put(str(candidate), remote_path)
                if candidate.suffix in {".sh", ".py"}:
                    try:
                        sftp.chmod(remote_path, 0o755)
                    except OSError:
                        pass
                uploaded.append(relative)
    finally:
        sftp.close()
    return {
        "uploaded": uploaded,
        "count": len(uploaded),
        "remoteParent": remote_parent,
    }


def read_remote_identity(ssh: "paramiko.SSHClient", timeout: int = 30) -> dict[str, object]:
    command = """
python3 - <<'PY'
import json
import os
import socket
import subprocess

payload = {
    "hostname": socket.gethostname(),
    "user": os.environ.get("USER", ""),
    "cwd": os.getcwd(),
}
uptime = subprocess.run(["uptime"], capture_output=True, text=True, check=False)
payload["uptime"] = uptime.stdout.strip()
print(json.dumps(payload))
PY
"""
    out, err, code = ssh_exec(ssh, command, timeout=timeout)
    if code != 0:
        raise RuntimeError(err or out or "failed to read remote identity")
    return json.loads(out.strip())
