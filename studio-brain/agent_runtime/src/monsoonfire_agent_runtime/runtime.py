from __future__ import annotations

import json
import subprocess
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request

from .contracts import ContextPack, GoalMiss, MissionEnvelope, RatholeSignal, ToolContract


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{json.dumps(payload)}\n")


def post_webhook(webhook_url: str, bearer_token: str, payload: dict[str, Any]) -> None:
    if not webhook_url:
        return
    req = request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            **({"authorization": f"Bearer {bearer_token}"} if bearer_token else {}),
        },
        method="POST",
    )
    with request.urlopen(req, timeout=20) as response:  # noqa: S310 - owner-configured local webhook
        response.read()


def classify_goal_miss(command: str, stderr: str, status: str) -> str:
    lowered = f"{command}\n{stderr}".lower()
    if "not found" in lowered or "enoent" in lowered:
        return "tool_mismatch"
    if "dirty" in lowered or "merge" in lowered or "conflict" in lowered:
        return "hidden_repo_state"
    if status == "verification_failed":
        return "verification_omission"
    return "bad_grounding"


def detect_rathole_signals(events: list[dict[str, Any]]) -> list[RatholeSignal]:
    recent = events[-8:]
    signals: list[RatholeSignal] = []
    verification_failures = [
        event
        for event in recent
        if event.get("type") == "verification.completed" and str(event.get("payload", {}).get("status")) == "failed"
    ]
    if len(verification_failures) >= 3:
        last_failed = verification_failures[-1]
        signals.append(
            RatholeSignal(
                signalId=f"rathole-{uuid.uuid4().hex[:10]}",
                kind="repeat_verifier_failure",
                severity="critical",
                summary="Verifier checks failed repeatedly without a state change.",
                recommendedAction="Re-ground on the mission envelope and stop retrying until the blocker is explicit.",
                createdAt=str(last_failed.get("occurredAt") or utc_now_iso()),
                blocking=True,
            )
        )

    recent_types = [str(event.get("type", "")) for event in recent]
    if len(recent) >= 6 and recent_types.count("mission.state.changed") == 0:
        signals.append(
            RatholeSignal(
                signalId=f"rathole-{uuid.uuid4().hex[:10]}",
                kind="no_state_change",
                severity="warning",
                summary="Recent runtime events did not move mission state forward.",
                recommendedAction="Shrink scope to the critical path or hand off with a blocker.",
                createdAt=utc_now_iso(),
                blocking=False,
            )
        )
    return signals


def percentile(sorted_values: list[int], ratio: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    index = ratio * (len(sorted_values) - 1)
    lower = int(index)
    upper = min(lower + 1, len(sorted_values) - 1)
    remainder = index - lower
    return float(sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * remainder)


class AgentRuntime:
    def __init__(
        self,
        repo_root: Path,
        run_root: Path,
        dry_run: bool = False,
        execute_verifier: bool = False,
        webhook_url: str = "",
        bearer_token: str = "",
        command_timeout_sec: int = 1800,
    ) -> None:
        self.repo_root = repo_root
        self.run_root = run_root
        self.dry_run = dry_run
        self.execute_verifier = execute_verifier
        self.webhook_url = webhook_url
        self.bearer_token = bearer_token
        self.command_timeout_sec = command_timeout_sec
        self.mission = MissionEnvelope.from_dict(read_json(run_root / "mission-envelope.json"))
        self.context = ContextPack.from_dict(read_json(run_root / "context-pack.json"))
        tool_payload = read_json(run_root / "tool-contracts.json")
        self.tool_contracts = [ToolContract.from_dict(item) for item in tool_payload.get("tools", []) if isinstance(item, dict)]
        self.ledger_path = run_root / "run-ledger.jsonl"
        self.summary_path = run_root / "summary.json"
        self.verifier_dir = run_root / "verifier"
        self.verifier_dir.mkdir(parents=True, exist_ok=True)
        self.events: list[dict[str, Any]] = []
        if self.ledger_path.exists():
            for line in self.ledger_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    self.events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        self.summary = read_json(self.summary_path) if self.summary_path.exists() else {}

    def emit_event(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        event = {
            "schema": "agent-run-ledger-event.v1",
            "eventId": f"evt_{uuid.uuid4().hex}",
            "runId": self.mission.runId,
            "missionId": self.mission.missionId,
            "type": event_type,
            "occurredAt": utc_now_iso(),
            "payload": payload or {},
        }
        self.events.append(event)
        append_jsonl(self.ledger_path, event)
        self.summary["lastEventType"] = event_type
        self.summary["updatedAt"] = event["occurredAt"]
        self.write_summary()
        post_webhook(self.webhook_url, self.bearer_token, {"event": event, "summary": self.summary})

    def write_summary(self) -> None:
        write_json(self.summary_path, self.summary)

    def set_state(self, status: str, blocker: str = "", next_step: str = "") -> None:
        self.summary["status"] = status
        board_row = self.summary.get("boardRow", {})
        board_row["state"] = status
        if blocker:
            board_row["blocker"] = blocker
        if next_step:
            board_row["next"] = next_step
        board_row["last_update"] = utc_now_iso()
        self.summary["boardRow"] = board_row
        self.write_summary()
        self.emit_event("mission.state.changed", {"status": status, "blocker": blocker, "next": next_step})

    def add_goal_miss(self, category: str, summary: str) -> None:
        goal_miss = GoalMiss(category=category, summary=summary, createdAt=utc_now_iso())
        goal_misses = self.summary.setdefault("goalMisses", [])
        goal_misses.append(asdict(goal_miss))
        self.write_summary()
        self.emit_event("goal.miss", asdict(goal_miss))

    def sync_rathole_signals(self) -> None:
        signals = [asdict(signal) for signal in detect_rathole_signals(self.events)]
        self.summary["ratholeSignals"] = signals
        self.write_summary()
        for signal in signals:
            if not any(
                event.get("type") == "rathole.detected" and event.get("payload", {}).get("signalId") == signal["signalId"]
                for event in self.events
            ):
                self.emit_event("rathole.detected", signal)

    def resolve_tool_contract(self, tool_id: str) -> ToolContract:
        normalized = str(tool_id or "").strip()
        for tool in self.tool_contracts:
            if tool.toolId == normalized:
                return tool
        raise ValueError(f"Unknown tool contract: {normalized}")

    def resolve_tool_cwd(self, tool: ToolContract) -> Path:
        native_spec = tool.nativeSpec if isinstance(tool.nativeSpec, dict) else {}
        configured = str(native_spec.get("cwd", "")).strip()
        return self.repo_root / configured if configured and configured != "." else self.repo_root

    def run_process(
        self,
        *,
        argv: list[str] | None = None,
        command: str = "",
        cwd: Path | None = None,
        shell: bool = False,
    ) -> dict[str, Any]:
        started = time.monotonic()
        try:
            if shell:
                result = subprocess.run(
                    command,
                    shell=True,
                    cwd=str(cwd or self.repo_root),
                    capture_output=True,
                    text=True,
                    timeout=self.command_timeout_sec,
                )
                executed = command
            else:
                exec_argv = [str(entry) for entry in (argv or []) if str(entry).strip()]
                result = subprocess.run(
                    exec_argv,
                    shell=False,
                    cwd=str(cwd or self.repo_root),
                    capture_output=True,
                    text=True,
                    timeout=self.command_timeout_sec,
                )
                executed = exec_argv
        except FileNotFoundError as error:
            duration_ms = int((time.monotonic() - started) * 1000)
            return {
                "returncode": 127,
                "durationMs": duration_ms,
                "stdout": "",
                "stderr": str(error),
                "cwd": str((cwd or self.repo_root).resolve()),
                "shell": shell,
                "command": command if shell else [str(entry) for entry in (argv or []) if str(entry).strip()],
            }
        duration_ms = int((time.monotonic() - started) * 1000)
        return {
            "returncode": result.returncode,
            "durationMs": duration_ms,
            "stdout": result.stdout[-20000:],
            "stderr": result.stderr[-20000:],
            "cwd": str((cwd or self.repo_root).resolve()),
            "shell": shell,
            "command": executed,
        }

    def write_tool_artifact(
        self,
        tool: ToolContract,
        payload: dict[str, Any],
        *,
        artifact_root: Path | None = None,
        suffix: str = "",
    ) -> Path:
        root = artifact_root or (self.run_root / "tools")
        root.mkdir(parents=True, exist_ok=True)
        safe_tool_id = tool.toolId.replace(".", "-")
        file_name = f"{safe_tool_id}{('-' + suffix) if suffix else ''}.json"
        artifact_path = root / file_name
        write_json(artifact_path, payload)
        return artifact_path

    def execute_tool_contract(
        self,
        tool_id: str,
        *,
        probe: bool = False,
        emit_events: bool = True,
        artifact_root: Path | None = None,
        artifact_suffix: str = "",
    ) -> dict[str, Any]:
        tool = self.resolve_tool_contract(tool_id)
        native_spec = tool.nativeSpec if isinstance(tool.nativeSpec, dict) else {}
        if tool.kind != "runtime-primitive" or not native_spec:
            raise ValueError(f"Tool {tool_id} does not expose a runtime primitive.")
        argv = native_spec.get("probeArgv") if probe else native_spec.get("argv")
        if not isinstance(argv, list) or not argv:
            raise ValueError(f"Tool {tool_id} is missing {'probeArgv' if probe else 'argv'} in nativeSpec.")
        cwd = self.resolve_tool_cwd(tool)
        if emit_events:
            self.emit_event(
                "tool.started",
                {"toolId": tool.toolId, "probe": probe, "kind": tool.kind},
            )
        result_payload = self.run_process(argv=[str(entry) for entry in argv], cwd=cwd)
        artifact_payload = {
            "schema": "agent-tool-execution-artifact.v1",
            "toolId": tool.toolId,
            "kind": tool.kind,
            "probe": probe,
            **result_payload,
        }
        artifact_path = self.write_tool_artifact(tool, artifact_payload, artifact_root=artifact_root, suffix=artifact_suffix)
        relative_artifact = str(artifact_path.relative_to(self.repo_root)).replace("\\", "/")
        result_payload["artifactPath"] = relative_artifact
        if emit_events:
            self.emit_event(
                "tool.completed",
                {
                    "toolId": tool.toolId,
                    "probe": probe,
                    "status": "passed" if result_payload["returncode"] == 0 else "failed",
                    "durationMs": result_payload["durationMs"],
                    "artifactPath": relative_artifact,
                },
            )
        return result_payload

    def summarize_benchmark_samples(self, samples: list[dict[str, Any]]) -> dict[str, Any]:
        durations = sorted(int(sample.get("durationMs", 0)) for sample in samples)
        failures = [sample for sample in samples if int(sample.get("returncode", 1)) != 0]
        average = (sum(durations) / len(durations)) if durations else 0.0
        return {
            "count": len(samples),
            "avgMs": round(average, 2),
            "minMs": durations[0] if durations else 0,
            "medianMs": round(percentile(durations, 0.5), 2),
            "p95Ms": round(percentile(durations, 0.95), 2),
            "maxMs": durations[-1] if durations else 0,
            "failureCount": len(failures),
        }

    def benchmark_tool(
        self,
        tool_id: str,
        *,
        iterations: int = 5,
        warmup: int = 1,
        output_path: Path | None = None,
    ) -> dict[str, Any]:
        tool = self.resolve_tool_contract(tool_id)
        native_spec = tool.nativeSpec if isinstance(tool.nativeSpec, dict) else {}
        probe_argv = native_spec.get("probeArgv")
        probe_command = str(native_spec.get("probeCommand", "")).strip()
        if not isinstance(probe_argv, list) or not probe_argv:
            raise ValueError(f"Tool {tool_id} does not expose probeArgv; refusing live benchmark.")

        benchmark_root = self.repo_root / "output" / "qa" / "native-tool-benchmarks" / tool.toolId.replace(".", "-")
        benchmark_root.mkdir(parents=True, exist_ok=True)
        sample_sets: dict[str, list[dict[str, Any]]] = {
            "primitiveRunner": [],
            "nativeDirect": [],
        }
        if probe_command:
            sample_sets["legacyShell"] = []

        total_rounds = max(1, int(iterations)) + max(0, int(warmup))
        cwd = self.resolve_tool_cwd(tool)
        for round_index in range(total_rounds):
            is_warmup = round_index < max(0, int(warmup))
            primitive_sample = self.execute_tool_contract(
                tool.toolId,
                probe=True,
                emit_events=False,
                artifact_root=benchmark_root / "primitive-runner",
                artifact_suffix=f"round-{round_index + 1:02d}",
            )
            if not is_warmup:
                sample_sets["primitiveRunner"].append(primitive_sample)

            native_sample = self.run_process(argv=[str(entry) for entry in probe_argv], cwd=cwd)
            if not is_warmup:
                sample_sets["nativeDirect"].append(native_sample)

            if "legacyShell" in sample_sets:
                shell_sample = self.run_process(command=probe_command, cwd=cwd, shell=True)
                if not is_warmup:
                    sample_sets["legacyShell"].append(shell_sample)

        summary = {mode: self.summarize_benchmark_samples(samples) for mode, samples in sample_sets.items()}
        native_avg = float(summary["nativeDirect"]["avgMs"] or 0.0)
        primitive_avg = float(summary["primitiveRunner"]["avgMs"] or 0.0)
        shell_avg = float(summary.get("legacyShell", {}).get("avgMs", 0.0) or 0.0)
        payload = {
            "schema": "agent-tool-benchmark.v1",
            "generatedAt": utc_now_iso(),
            "toolId": tool.toolId,
            "kind": tool.kind,
            "probeOnly": True,
            "iterations": max(1, int(iterations)),
            "warmup": max(0, int(warmup)),
            "summary": summary,
            "comparisons": {
                "primitiveVsNativeAvgMs": round(primitive_avg - native_avg, 2),
                "primitiveVsNativePct": round(((primitive_avg - native_avg) / native_avg) * 100, 2) if native_avg > 0 else 0.0,
                **(
                    {
                        "primitiveVsShellAvgMs": round(primitive_avg - shell_avg, 2),
                        "primitiveVsShellPct": round(((primitive_avg - shell_avg) / shell_avg) * 100, 2) if shell_avg > 0 else 0.0,
                    }
                    if "legacyShell" in summary
                    else {}
                ),
            },
        }
        destination = output_path or (benchmark_root / "benchmark.json")
        write_json(destination, payload)
        return {"artifactPath": str(destination.relative_to(self.repo_root)).replace("\\", "/"), **payload}

    def run_verifier(self) -> bool:
        checks = list(self.mission.verifierSpec.requiredChecks)
        acceptance = self.summary.setdefault("acceptance", {})
        acceptance["total"] = len(checks)
        acceptance["pending"] = len(checks)
        acceptance["completed"] = 0
        acceptance["failed"] = 0
        self.write_summary()

        all_passed = True
        for index, command in enumerate(checks, start=1):
            self.emit_event("verification.started", {"command": command, "index": index})
            if self.dry_run or not self.execute_verifier:
                payload = {
                    "command": command,
                    "status": "skipped" if self.dry_run else "blocked",
                    "reason": "dry-run" if self.dry_run else "verifier execution disabled",
                }
                acceptance["pending"] = max(0, acceptance["pending"] - 1)
                if self.dry_run:
                    acceptance["completed"] = acceptance.get("completed", 0) + 1
                else:
                    all_passed = False
                    acceptance["failed"] = acceptance.get("failed", 0) + 1
                self.write_summary()
                self.emit_event("verification.completed", payload)
                continue

            started = time.monotonic()
            result = subprocess.run(
                command,
                shell=True,
                cwd=str(self.repo_root),
                capture_output=True,
                text=True,
                timeout=self.command_timeout_sec,
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            command_slug = f"check-{index:02d}"
            artifact_path = self.verifier_dir / f"{command_slug}.json"
            artifact_payload = {
                "schema": "agent-verifier-artifact.v1",
                "command": command,
                "returncode": result.returncode,
                "durationMs": duration_ms,
                "stdout": result.stdout[-20000:],
                "stderr": result.stderr[-20000:],
            }
            write_json(artifact_path, artifact_payload)
            acceptance["pending"] = max(0, acceptance["pending"] - 1)
            if result.returncode == 0:
                acceptance["completed"] = acceptance.get("completed", 0) + 1
                payload = {
                    "command": command,
                    "status": "passed",
                    "durationMs": duration_ms,
                    "artifactPath": str(artifact_path.relative_to(self.repo_root)).replace("\\", "/"),
                }
            else:
                acceptance["failed"] = acceptance.get("failed", 0) + 1
                all_passed = False
                payload = {
                    "command": command,
                    "status": "failed",
                    "durationMs": duration_ms,
                    "artifactPath": str(artifact_path.relative_to(self.repo_root)).replace("\\", "/"),
                }
                category = classify_goal_miss(command, result.stderr, "verification_failed")
                self.add_goal_miss(category, f"Verifier command failed: {command}")
            self.write_summary()
            self.emit_event("verification.completed", payload)
        return all_passed

    def run(self) -> int:
        self.emit_event(
            "mission.started",
            {"title": self.mission.missionTitle, "goal": self.mission.goal, "riskLane": self.mission.riskLane},
        )
        self.emit_event(
            "context.loaded",
            {
                "groundingSources": self.context.groundingSources,
                "memoriesInfluencingRun": self.context.memoriesInfluencingRun,
                "startupBlockers": self.context.startupBlockers,
            },
        )

        if self.context.startupBlockers:
            blocker = self.context.startupBlockers[0]
            self.add_goal_miss("bad_grounding", blocker)
            self.set_state("blocked", blocker=blocker, next_step="repair startup continuity or collect more live samples")
            self.sync_rathole_signals()
            return 2

        self.set_state("running", next_step="run verifier broker")

        if self.mission.riskLane == "high_risk" and not self.execute_verifier:
            blocker = "High-risk missions require verifier execution before completion."
            self.add_goal_miss("verification_omission", blocker)
            self.set_state("blocked", blocker=blocker, next_step="re-run with --execute-verifier")
            self.sync_rathole_signals()
            return 2

        all_passed = self.run_verifier()
        self.sync_rathole_signals()
        blocking_signal = next((signal for signal in self.summary.get("ratholeSignals", []) if bool(signal.get("blocking"))), None)
        if blocking_signal:
            self.set_state(
                "blocked",
                blocker=str(blocking_signal.get("summary", "Blocking rathole detected.")),
                next_step=str(blocking_signal.get("recommendedAction", "re-ground the mission")),
            )
            return 2

        if not all_passed:
            self.set_state("blocked", blocker="Verifier checks failed.", next_step="inspect verifier artifacts and narrow the mission")
            return 2

        final_state = "verified" if self.execute_verifier or self.dry_run else "completed"
        self.set_state(final_state, next_step="handoff or continue with bounded mutate phase")
        self.emit_event("mission.completed", {"status": final_state})
        return 0
