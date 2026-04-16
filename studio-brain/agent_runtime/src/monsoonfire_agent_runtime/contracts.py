from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class VerifierSpec:
    mode: str
    requiredChecks: list[str] = field(default_factory=list)
    requiredArtifacts: list[str] = field(default_factory=list)
    requiredDocs: list[str] = field(default_factory=list)
    gateVisualVerification: bool = False
    gateLiveDeploy: bool = False


@dataclass(slots=True)
class MissionEnvelope:
    schema: str
    generatedAt: str
    runId: str
    missionId: str
    missionTitle: str
    goal: str
    nonGoals: list[str]
    riskLane: str
    verifierSpec: VerifierSpec

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "MissionEnvelope":
        verifier = payload.get("verifierSpec") if isinstance(payload.get("verifierSpec"), dict) else {}
        return cls(
            schema=str(payload.get("schema", "")),
            generatedAt=str(payload.get("generatedAt", "")),
            runId=str(payload.get("runId", "")),
            missionId=str(payload.get("missionId", "")),
            missionTitle=str(payload.get("missionTitle", "")),
            goal=str(payload.get("goal", "")),
            nonGoals=[str(entry).strip() for entry in payload.get("nonGoals", []) if str(entry).strip()],
            riskLane=str(payload.get("riskLane", "background")),
            verifierSpec=VerifierSpec(
                mode=str(verifier.get("mode", "bounded_required")),
                requiredChecks=[str(entry).strip() for entry in verifier.get("requiredChecks", []) if str(entry).strip()],
                requiredArtifacts=[str(entry).strip() for entry in verifier.get("requiredArtifacts", []) if str(entry).strip()],
                requiredDocs=[str(entry).strip() for entry in verifier.get("requiredDocs", []) if str(entry).strip()],
                gateVisualVerification=bool(verifier.get("gateVisualVerification", False)),
                gateLiveDeploy=bool(verifier.get("gateLiveDeploy", False)),
            ),
        )


@dataclass(slots=True)
class ContextPack:
    schema: str
    groundingSources: list[str]
    memoriesInfluencingRun: list[str]
    startupBlockers: list[str]

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ContextPack":
        telemetry = payload.get("telemetry") if isinstance(payload.get("telemetry"), dict) else {}
        return cls(
            schema=str(payload.get("schema", "")),
            groundingSources=[str(entry).strip() for entry in payload.get("groundingSources", []) if str(entry).strip()],
            memoriesInfluencingRun=[str(entry).strip() for entry in payload.get("memoriesInfluencingRun", []) if str(entry).strip()],
            startupBlockers=[str(entry).strip() for entry in telemetry.get("startupBlockers", []) if str(entry).strip()],
        )


@dataclass(slots=True)
class ToolContract:
    toolId: str
    kind: str
    command: str
    purpose: str
    sideEffects: str
    verificationCommand: str
    selectableByAgent: bool = True
    generatedFrom: dict[str, Any] = field(default_factory=dict)
    nativeSpec: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ToolContract":
        return cls(
            toolId=str(payload.get("toolId", "")),
            kind=str(payload.get("kind", "")),
            command=str(payload.get("command", "")),
            purpose=str(payload.get("purpose", "")),
            sideEffects=str(payload.get("sideEffects", "")),
            verificationCommand=str(payload.get("verificationCommand", "")),
            selectableByAgent=bool(payload.get("selectableByAgent", True)),
            generatedFrom=payload.get("generatedFrom") if isinstance(payload.get("generatedFrom"), dict) else {},
            nativeSpec=payload.get("nativeSpec") if isinstance(payload.get("nativeSpec"), dict) else {},
        )


@dataclass(slots=True)
class RatholeSignal:
    signalId: str
    kind: str
    severity: str
    summary: str
    recommendedAction: str
    createdAt: str
    blocking: bool


@dataclass(slots=True)
class GoalMiss:
    category: str
    summary: str
    createdAt: str
