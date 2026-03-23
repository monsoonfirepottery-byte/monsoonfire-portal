#!/usr/bin/env node

import { createHash } from "node:crypto";

export const POSTURE_MODES = Object.freeze({
  LOCAL_ADVISORY: "local_advisory",
  LIVE_HOST_AUTHORITATIVE: "live_host_authoritative",
  AUTHENTICATED_PRIVILEGED_CHECK: "authenticated_privileged_check",
});

export const DATA_CLASSIFICATIONS = Object.freeze({
  OPERATIONAL_METADATA: "operational_metadata",
  SENSITIVE_OPERATIONAL_EVIDENCE: "sensitive_operational_evidence",
});

export const REDACTION_STATES = Object.freeze({
  VERIFIED_REDACTED: "verified_redacted",
  REQUIRES_REVIEW: "requires_review",
});

export const DEFAULT_RETENTION_DAYS = Object.freeze({
  [DATA_CLASSIFICATIONS.OPERATIONAL_METADATA]: 180,
  [DATA_CLASSIFICATIONS.SENSITIVE_OPERATIONAL_EVIDENCE]: 30,
});

export const DEFAULT_ACCESS_SCOPES = Object.freeze({
  [DATA_CLASSIFICATIONS.OPERATIONAL_METADATA]: ["platform-primary", "ops-primary"],
  [DATA_CLASSIFICATIONS.SENSITIVE_OPERATIONAL_EVIDENCE]: ["platform-primary", "ops-primary", "trust-safety-primary"],
});

export const POSTURE_POLICY_DEFAULTS = Object.freeze({
  shadowWindowDays: 7,
  maxExpiringOverrides: 1,
});

export const ESCALATION_THRESHOLDS = Object.freeze({
  readyzConsecutiveFailures: 5,
  readyzContinuousRedMinutes: 5,
  dependencyRepeatWindowMinutes: 30,
  dependencyRepeatCount: 3,
  containerFlapWindowMinutes: 10,
  containerFlapCount: 3,
  trustSafetyMediumRepeatWindowHours: 24,
  trustSafetyMediumRepeatCount: 2,
  authAbuseWindowMinutes: 30,
  authAbuseRepeatCount: 3,
});

const IDENTIFIER_KEY_PATTERN = /(?:^|[_-])(actor|report|intake|proposal|case|bundle)id$/i;

export function normalizePostureMode(value, fallback = POSTURE_MODES.LOCAL_ADVISORY) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.values(POSTURE_MODES).includes(normalized)) {
    return normalized;
  }
  return fallback;
}

export function classifyExecutionAuthority({
  mode,
  envMode,
  approvedRemoteRunner = false,
  hasFallbackArtifacts = false,
}) {
  const normalizedMode = normalizePostureMode(mode);
  const normalizedEnvMode = String(envMode || "").trim().toLowerCase();
  const reasons = [];

  if (normalizedMode === POSTURE_MODES.LOCAL_ADVISORY) {
    reasons.push("local advisory mode requested");
    return {
      mode: normalizedMode,
      authoritative: false,
      status: "advisory_only",
      reasons,
    };
  }

  if (normalizedEnvMode === "fallback") {
    reasons.push(".env.example fallback cannot clear or fail a live deploy");
    return {
      mode: normalizedMode,
      authoritative: false,
      status: "advisory_evidence_only",
      reasons,
    };
  }

  if (hasFallbackArtifacts) {
    reasons.push("repo-local fallback artifacts cannot clear or fail a live deploy on their own");
  }

  if (approvedRemoteRunner) {
    reasons.push("approved remote runner bound to target host runtime");
  } else {
    reasons.push("target host runtime required");
  }

  return {
    mode: normalizedMode,
    authoritative: true,
    status:
      normalizedMode === POSTURE_MODES.AUTHENTICATED_PRIVILEGED_CHECK
        ? "authoritative_privileged_probe"
        : "authoritative_live_host",
    reasons,
  };
}

export function buildArtifactProvenance({
  mode,
  envSource,
  envMode,
  approvedRemoteRunner = false,
  host = "",
  generator = "",
  generatedAt = new Date().toISOString(),
  dataClassification = DATA_CLASSIFICATIONS.OPERATIONAL_METADATA,
  redactionState = REDACTION_STATES.VERIFIED_REDACTED,
  retentionDays,
  accessScope,
  legalHold = false,
  sourceSystems = [],
  hasFallbackArtifacts = false,
}) {
  const authority = classifyExecutionAuthority({
    mode,
    envMode,
    approvedRemoteRunner,
    hasFallbackArtifacts,
  });
  const normalizedClassification = Object.values(DATA_CLASSIFICATIONS).includes(dataClassification)
    ? dataClassification
    : DATA_CLASSIFICATIONS.OPERATIONAL_METADATA;
  return {
    schemaVersion: "studio-brain-posture-provenance.v1",
    mode: authority.mode,
    authority: authority.status,
    authoritative: authority.authoritative,
    approvedRemoteRunner: Boolean(approvedRemoteRunner),
    envSource: String(envSource || ""),
    envMode: String(envMode || ""),
    generatedAt,
    host,
    generator,
    dataClassification: normalizedClassification,
    redactionState,
    retentionDays:
      Number.isInteger(retentionDays) && retentionDays > 0
        ? retentionDays
        : DEFAULT_RETENTION_DAYS[normalizedClassification],
    accessScope:
      Array.isArray(accessScope) && accessScope.length > 0
        ? accessScope
        : [...DEFAULT_ACCESS_SCOPES[normalizedClassification]],
    legalHold: Boolean(legalHold),
    sourceSystems: Array.isArray(sourceSystems) ? [...sourceSystems] : [],
    notes: authority.reasons,
  };
}

export function hashIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return `sha256:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export function redactSharedIdentifier(keyName, value) {
  if (typeof value !== "string") {
    return value;
  }
  if (!IDENTIFIER_KEY_PATTERN.test(String(keyName || ""))) {
    return value;
  }
  return hashIdentifier(value);
}
