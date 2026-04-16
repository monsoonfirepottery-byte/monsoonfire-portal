from __future__ import annotations

import argparse
import json
from pathlib import Path

from .runtime import AgentRuntime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Monsoon Fire agent runtime")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run a prepared mission bundle")
    run_parser.add_argument("--repo-root", required=True)
    run_parser.add_argument("--run-root", required=True)
    run_parser.add_argument("--dry-run", action="store_true")
    run_parser.add_argument("--execute-verifier", action="store_true")
    run_parser.add_argument("--webhook-url", default="")
    run_parser.add_argument("--bearer-token", default="")
    run_parser.add_argument("--command-timeout-sec", type=int, default=1800)

    run_tool_parser = subparsers.add_parser("run-tool", help="Execute a runtime primitive tool from the prepared bundle")
    run_tool_parser.add_argument("--repo-root", required=True)
    run_tool_parser.add_argument("--run-root", required=True)
    run_tool_parser.add_argument("--tool-id", required=True)
    run_tool_parser.add_argument("--probe", action="store_true")
    run_tool_parser.add_argument("--command-timeout-sec", type=int, default=1800)

    benchmark_parser = subparsers.add_parser(
        "benchmark-tool", help="Benchmark a runtime primitive against direct/native invocation"
    )
    benchmark_parser.add_argument("--repo-root", required=True)
    benchmark_parser.add_argument("--run-root", required=True)
    benchmark_parser.add_argument("--tool-id", required=True)
    benchmark_parser.add_argument("--iterations", type=int, default=5)
    benchmark_parser.add_argument("--warmup", type=int, default=1)
    benchmark_parser.add_argument("--output-path", default="")
    benchmark_parser.add_argument("--command-timeout-sec", type=int, default=1800)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "run":
        runtime = AgentRuntime(
            repo_root=Path(args.repo_root),
            run_root=Path(args.run_root),
            dry_run=bool(args.dry_run),
            execute_verifier=bool(args.execute_verifier),
            webhook_url=str(args.webhook_url),
            bearer_token=str(args.bearer_token),
            command_timeout_sec=int(args.command_timeout_sec),
        )
        return runtime.run()
    if args.command == "run-tool":
        runtime = AgentRuntime(
            repo_root=Path(args.repo_root),
            run_root=Path(args.run_root),
            command_timeout_sec=int(args.command_timeout_sec),
        )
        payload = runtime.execute_tool_contract(str(args.tool_id), probe=bool(args.probe))
        print(json.dumps(payload, indent=2))
        return 0 if int(payload.get("returncode", 1)) == 0 else int(payload.get("returncode", 1))
    if args.command == "benchmark-tool":
        runtime = AgentRuntime(
            repo_root=Path(args.repo_root),
            run_root=Path(args.run_root),
            command_timeout_sec=int(args.command_timeout_sec),
        )
        output_path = Path(args.output_path) if str(args.output_path).strip() else None
        payload = runtime.benchmark_tool(
            str(args.tool_id),
            iterations=int(args.iterations),
            warmup=int(args.warmup),
            output_path=output_path,
        )
        print(json.dumps(payload, indent=2))
        status = [
            int(metrics.get("failureCount", 0))
            for metrics in payload.get("summary", {}).values()
            if isinstance(metrics, dict)
        ]
        return 0 if sum(status) == 0 else 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
