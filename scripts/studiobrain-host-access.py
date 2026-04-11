#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import json
import sys

SCRIPTS_LIB = Path(__file__).resolve().parent / "lib"
if str(SCRIPTS_LIB) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_LIB))

from studiobrain_host_access import (
    build_fail2ban_ignore_ips,
    connect_studiobrain_ssh,
    ensure_local_studiobrain_keypair,
    ensure_local_studiobrain_ssh_config,
    install_remote_fail2ban_allowlist,
    install_remote_public_key,
    is_windows,
    load_studiobrain_deploy_env,
    read_remote_identity,
    resolve_studiobrain_key_path,
    sudo_ssh_exec,
    ssh_exec,
    verify_native_windows_openssh_access,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = REPO_ROOT / "secrets/studio-brain/studio-brain-mcp.env"
HOME_STUDIO_MCP_ENV_PATH = Path.home() / "secrets" / "studio-brain" / "studio-brain-mcp.env"
REMOTE_PARENT = "/home/wuff/monsoonfire-portal"


def load_env() -> dict[str, str]:
    return load_studiobrain_deploy_env(
        env_path=ENV_PATH,
        home_env_path=HOME_STUDIO_MCP_ENV_PATH,
    )


def command_check(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    result: dict[str, object] = {
        "ok": False,
        "resolvedKey": resolve_studiobrain_key_path(env),
        "ignoreIps": build_fail2ban_ignore_ips(env),
    }
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        result["auth"] = auth
        result["remote"] = read_remote_identity(ssh, timeout=args.timeout)
        native_cli = verify_native_windows_openssh_access(env, timeout=args.timeout)
        result["nativeCli"] = native_cli
        result["ok"] = True if not native_cli.get("supported") else bool(native_cli.get("ok"))
        return result
    except Exception as exc:
        result["error"] = str(exc)
        return result
    finally:
        if ssh is not None:
            ssh.close()


def command_bootstrap_access(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    keypair = ensure_local_studiobrain_keypair(env)
    ssh_config = ensure_local_studiobrain_ssh_config(env, private_key_path=str(keypair["privateKeyPath"]))
    result: dict[str, object] = {
        "ok": False,
        "keypair": keypair,
        "sshConfig": ssh_config,
        "ignoreIps": build_fail2ban_ignore_ips(env),
    }
    ssh = None
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        result["initialAuth"] = auth
        result["remoteBefore"] = read_remote_identity(ssh, timeout=args.timeout)
        result["authorizedKey"] = install_remote_public_key(
            ssh,
            public_key_path=str(keypair["publicKeyPath"]),
            timeout=args.timeout,
        )
        if args.install_fail2ban:
            result["fail2ban"] = install_remote_fail2ban_allowlist(
                ssh,
                env=env,
                remote_parent=REMOTE_PARENT,
                timeout=max(args.timeout, 120),
            )
        else:
            result["fail2ban"] = {"ok": True, "skipped": True, "ignoreIps": build_fail2ban_ignore_ips(env)}
    except Exception as exc:
        result["error"] = str(exc)
        return result
    finally:
        if ssh is not None:
            ssh.close()

    verification_env = dict(env)
    verification_env["STUDIO_BRAIN_DEPLOY_KEY_PATH"] = str(keypair["privateKeyPath"])
    verification_env.pop("STUDIO_BRAIN_DEPLOY_PASSWORD", None)
    verify_ssh = None
    try:
        verify_ssh, verify_auth = connect_studiobrain_ssh(verification_env, timeout=args.timeout)
        result["verificationAuth"] = verify_auth
        result["remoteAfter"] = read_remote_identity(verify_ssh, timeout=args.timeout)
        native_cli = verify_native_windows_openssh_access(verification_env, timeout=args.timeout)
        result["nativeCli"] = native_cli
        result["ok"] = bool((result.get("fail2ban") or {}).get("ok", True)) and (
            True if not native_cli.get("supported") else bool(native_cli.get("ok"))
        )
        return result
    except Exception as exc:
        result["error"] = f"bootstrap completed but key verification failed: {exc}"
        return result
    finally:
        if verify_ssh is not None:
            verify_ssh.close()


def command_install_fail2ban(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    result: dict[str, object] = {
        "ok": False,
        "ignoreIps": build_fail2ban_ignore_ips(env),
    }
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        result["auth"] = auth
        payload = install_remote_fail2ban_allowlist(
            ssh,
            env=env,
            remote_parent=REMOTE_PARENT,
            timeout=max(args.timeout, 120),
        )
        result.update(payload)
        if is_windows():
            result["nativeCli"] = verify_native_windows_openssh_access(env, timeout=args.timeout)
        return result
    except Exception as exc:
        result["error"] = str(exc)
        return result
    finally:
        if ssh is not None:
            ssh.close()


def command_run(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    result: dict[str, object] = {
        "ok": False,
        "command": args.command,
    }
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        result["auth"] = auth
        out, err, code = ssh_exec(ssh, args.command, timeout=args.timeout)
        result["ok"] = code == 0
        result["exitCode"] = code
        result["stdout"] = out
        result["stderr"] = err
        return result
    except Exception as exc:
        result["error"] = str(exc)
        return result
    finally:
        if ssh is not None:
            ssh.close()


def command_sudo_run(args: argparse.Namespace) -> dict[str, object]:
    env = load_env()
    ssh = None
    result: dict[str, object] = {
        "ok": False,
        "command": args.command,
    }
    try:
        ssh, auth = connect_studiobrain_ssh(env, timeout=args.timeout)
        result["auth"] = auth
        out, err, code = sudo_ssh_exec(ssh, args.command, env=env, timeout=args.timeout)
        result["ok"] = code == 0
        result["exitCode"] = code
        result["stdout"] = out
        result["stderr"] = err
        return result
    except Exception as exc:
        result["error"] = str(exc)
        return result
    finally:
        if ssh is not None:
            ssh.close()


def command_relay_status(args: argparse.Namespace) -> dict[str, object]:
    command = "\n".join(
        [
            "systemctl --user show studio-brain.service -p ActiveState -p SubState -p MainPID -p NRestarts",
            "systemctl --user show studio-brain-discord-relay.service -p ActiveState -p SubState -p UnitFileState -p MainPID",
            "systemctl --user show studio-brain-discord-relay.timer -p ActiveState -p SubState -p UnitFileState -p NextElapseUSecRealtime",
            "journalctl --user -u studio-brain-discord-relay.service -n 80 --no-pager",
        ]
    )
    args.command = command
    payload = command_run(args)
    payload["journalTail"] = payload.get("stdout", "").splitlines()[-80:]
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage Studio Brain host access for Codex.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--timeout", type=int, default=20, help="SSH command timeout in seconds.")
    subparsers = parser.add_subparsers(dest="command_name", required=True)

    check_parser = subparsers.add_parser("check", help="Verify SSH reachability and report the active auth path.")
    check_parser.set_defaults(handler=command_check)

    bootstrap_parser = subparsers.add_parser(
        "bootstrap-access",
        help="Create the local Codex key/config, install the public key remotely, and refresh fail2ban allowlists.",
    )
    bootstrap_parser.add_argument(
        "--skip-fail2ban",
        action="store_false",
        dest="install_fail2ban",
        help="Skip the remote fail2ban allowlist refresh.",
    )
    bootstrap_parser.set_defaults(handler=command_bootstrap_access, install_fail2ban=True)

    fail2ban_parser = subparsers.add_parser(
        "install-fail2ban",
        help="Reinstall the tracked fail2ban sshd jail config with the current management IP allowlist.",
    )
    fail2ban_parser.set_defaults(handler=command_install_fail2ban)

    run_parser = subparsers.add_parser("run", help="Run an arbitrary shell command on the Studio Brain host.")
    run_parser.add_argument("command", help="Remote shell command to execute.")
    run_parser.set_defaults(handler=command_run)

    sudo_run_parser = subparsers.add_parser(
        "sudo-run",
        help="Run an arbitrary shell command on the Studio Brain host via sudo.",
    )
    sudo_run_parser.add_argument("command", help="Remote shell command to execute with sudo.")
    sudo_run_parser.set_defaults(handler=command_sudo_run)

    relay_parser = subparsers.add_parser("relay-status", help="Inspect Studio Brain and Discord relay systemd state.")
    relay_parser.set_defaults(handler=command_relay_status)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    result = args.handler(args)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
