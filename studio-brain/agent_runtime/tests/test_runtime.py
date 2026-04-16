from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from monsoonfire_agent_runtime.runtime import AgentRuntime, detect_rathole_signals


class AgentRuntimeTests(unittest.TestCase):
    def write_bundle(
        self,
        repo_root: Path,
        *,
        risk_lane: str = "background",
        tools: list[dict[str, object]] | None = None,
    ) -> Path:
        run_root = repo_root / "output" / "agent-runs" / "run-demo"
        run_root.mkdir(parents=True)
        mission = {
            "schema": "agent-mission-envelope.v1",
            "generatedAt": "2026-04-16T00:00:00Z",
            "runId": "run-demo",
            "missionId": "mission-demo",
            "missionTitle": "Demo Mission",
            "goal": "Stay bounded",
            "nonGoals": ["Do not wander"],
            "riskLane": risk_lane,
            "verifierSpec": {
                "mode": "required",
                "requiredChecks": ["python -c \"print('ok')\""],
                "requiredArtifacts": [],
                "requiredDocs": [],
                "gateVisualVerification": False,
                "gateLiveDeploy": False,
            },
        }
        context = {
            "schema": "agent-context-pack.v1",
            "groundingSources": ["startup-preflight"],
            "memoriesInfluencingRun": ["Mission memory"],
            "telemetry": {"startupBlockers": []},
        }
        tool_contracts = {"schema": "agent-tool-contract-registry.v1", "tools": tools or []}
        summary = {
            "schema": "agent-runtime-summary.v1",
            "runId": "run-demo",
            "missionId": "mission-demo",
            "status": "queued",
            "riskLane": risk_lane,
            "title": "Demo Mission",
            "goal": "Stay bounded",
            "groundingSources": ["startup-preflight"],
            "acceptance": {"total": 1, "pending": 1, "completed": 0, "failed": 0},
            "activeBlockers": [],
            "ratholeSignals": [],
            "memoriesInfluencingRun": ["Mission memory"],
            "goalMisses": [],
            "lastEventType": None,
            "updatedAt": "2026-04-16T00:00:00Z",
            "boardRow": {
                "id": "agent-runtime:run-demo",
                "owner": "agent-runtime",
                "task": "Demo Mission",
                "state": "queued",
                "blocker": "none",
                "next": "launch background runtime",
                "last_update": "2026-04-16T00:00:00Z",
            },
        }
        (run_root / "mission-envelope.json").write_text(json.dumps(mission), encoding="utf-8")
        (run_root / "context-pack.json").write_text(json.dumps(context), encoding="utf-8")
        (run_root / "tool-contracts.json").write_text(json.dumps(tool_contracts), encoding="utf-8")
        (run_root / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
        return run_root

    def test_detect_rathole_signals_flags_repeated_verifier_failures(self) -> None:
        signals = detect_rathole_signals(
            [
                {"type": "verification.completed", "occurredAt": "2026-04-16T00:00:00Z", "payload": {"status": "failed"}},
                {"type": "verification.completed", "occurredAt": "2026-04-16T00:01:00Z", "payload": {"status": "failed"}},
                {"type": "verification.completed", "occurredAt": "2026-04-16T00:02:00Z", "payload": {"status": "failed"}},
            ]
        )
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0].kind, "repeat_verifier_failure")
        self.assertTrue(signals[0].blocking)

    def test_high_risk_run_blocks_without_verifier_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            run_root = self.write_bundle(repo_root, risk_lane="high_risk")

            runtime = AgentRuntime(repo_root=repo_root, run_root=run_root, execute_verifier=False, dry_run=False)
            exit_code = runtime.run()

            self.assertEqual(exit_code, 2)
            written_summary = json.loads((run_root / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(written_summary["status"], "blocked")
            self.assertEqual(written_summary["goalMisses"][0]["category"], "verification_omission")

    def test_runtime_primitive_probe_execution_writes_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            probe_script = repo_root / "probe.py"
            probe_script.write_text("import json\nprint(json.dumps({'status': 'ok'}))\n", encoding="utf-8")
            tools = [
                {
                    "toolId": "verify.synthetic",
                    "kind": "runtime-primitive",
                    "command": f"\"{sys.executable}\" \"{probe_script}\"",
                    "purpose": "Synthetic runtime primitive.",
                    "sideEffects": "artifact_only",
                    "verificationCommand": f"\"{sys.executable}\" \"{probe_script}\"",
                    "nativeSpec": {
                        "runner": "process.spawn",
                        "cwd": ".",
                        "argv": [sys.executable, str(probe_script)],
                        "probeArgv": [sys.executable, str(probe_script)],
                        "probeCommand": f"\"{sys.executable}\" \"{probe_script}\"",
                    },
                }
            ]
            run_root = self.write_bundle(repo_root, tools=tools)

            runtime = AgentRuntime(repo_root=repo_root, run_root=run_root)
            payload = runtime.execute_tool_contract("verify.synthetic", probe=True)

            self.assertEqual(payload["returncode"], 0)
            self.assertTrue((repo_root / payload["artifactPath"]).exists())

    def test_benchmark_tool_reports_primitive_and_native_modes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            probe_script = repo_root / "probe.py"
            probe_script.write_text("print('ok')\n", encoding="utf-8")
            tools = [
                {
                    "toolId": "verify.synthetic",
                    "kind": "runtime-primitive",
                    "command": f"\"{sys.executable}\" \"{probe_script}\"",
                    "purpose": "Synthetic runtime primitive.",
                    "sideEffects": "artifact_only",
                    "verificationCommand": f"\"{sys.executable}\" \"{probe_script}\"",
                    "nativeSpec": {
                        "runner": "process.spawn",
                        "cwd": ".",
                        "argv": [sys.executable, str(probe_script)],
                        "probeArgv": [sys.executable, str(probe_script)],
                        "probeCommand": f"\"{sys.executable}\" \"{probe_script}\"",
                    },
                }
            ]
            run_root = self.write_bundle(repo_root, tools=tools)

            runtime = AgentRuntime(repo_root=repo_root, run_root=run_root)
            payload = runtime.benchmark_tool("verify.synthetic", iterations=2, warmup=0)

            self.assertEqual(payload["summary"]["primitiveRunner"]["count"], 2)
            self.assertEqual(payload["summary"]["nativeDirect"]["count"], 2)
            self.assertIn("legacyShell", payload["summary"])


if __name__ == "__main__":
    unittest.main()
