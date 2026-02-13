import type { ActionProposal } from "../capabilities/model";
import type { AuditEvent } from "../stores/interfaces";

export type ScoreStatus = "ok" | "warning" | "critical";

export type ScoreMetric = {
  key:
    | "snapshot_freshness"
    | "proposal_decision_latency"
    | "audit_completeness"
    | "tenant_context_completeness"
    | "connector_health";
  label: string;
  status: ScoreStatus;
  value: number | null;
  unit: "minutes" | "ratio" | "percent";
  warningThreshold: number;
  criticalThreshold: number;
  owner: string;
  onCall: string;
};

export type Scorecard = {
  computedAt: string;
  overallStatus: ScoreStatus;
  lastBreachAt: string | null;
  metrics: ScoreMetric[];
};

function statusByUpperBound(value: number | null, warning: number, critical: number): ScoreStatus {
  if (value === null) return "critical";
  if (value >= critical) return "critical";
  if (value >= warning) return "warning";
  return "ok";
}

function statusByLowerBound(value: number | null, warning: number, critical: number): ScoreStatus {
  if (value === null) return "critical";
  if (value <= critical) return "critical";
  if (value <= warning) return "warning";
  return "ok";
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxStatus(a: ScoreStatus, b: ScoreStatus): ScoreStatus {
  const rank: Record<ScoreStatus, number> = { ok: 0, warning: 1, critical: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function computeScorecard(input: {
  now: Date;
  snapshotGeneratedAt: string | null;
  proposals: ActionProposal[];
  auditRows: AuditEvent[];
  connectors: Array<{ id: string; ok: boolean; latencyMs: number }>;
  lastBreachAt: string | null;
}): Scorecard {
  const snapshotAgeMinutes = input.snapshotGeneratedAt
    ? Math.max(0, (input.now.getTime() - Date.parse(input.snapshotGeneratedAt)) / 60_000)
    : null;
  const snapshotMetric: ScoreMetric = {
    key: "snapshot_freshness",
    label: "Snapshot freshness",
    status: statusByUpperBound(snapshotAgeMinutes, 30, 120),
    value: snapshotAgeMinutes === null ? null : Math.round(snapshotAgeMinutes),
    unit: "minutes",
    warningThreshold: 30,
    criticalThreshold: 120,
    owner: "Studio Ops",
    onCall: "ops-primary",
  };

  const decisionLatenciesMinutes = input.proposals
    .filter((proposal) => proposal.approvedAt)
    .map((proposal) => {
      const createdMs = Date.parse(proposal.createdAt);
      const approvedMs = Date.parse(proposal.approvedAt ?? "");
      if (!Number.isFinite(createdMs) || !Number.isFinite(approvedMs)) return null;
      return Math.max(0, (approvedMs - createdMs) / 60_000);
    })
    .filter((value): value is number => value !== null);
  const decisionLatencyMinutes = avg(decisionLatenciesMinutes);
  const decisionMetric: ScoreMetric = {
    key: "proposal_decision_latency",
    label: "Proposal decision latency (avg)",
    status: statusByUpperBound(decisionLatencyMinutes, 60, 240),
    value: decisionLatencyMinutes === null ? null : Math.round(decisionLatencyMinutes),
    unit: "minutes",
    warningThreshold: 60,
    criticalThreshold: 240,
    owner: "Policy Desk",
    onCall: "governance-primary",
  };

  const proposalIds = new Set(input.proposals.map((proposal) => proposal.id));
  const auditedProposalIds = new Set(
    input.auditRows
      .map((row) => row.metadata?.proposalId)
      .filter((proposalId): proposalId is string => typeof proposalId === "string" && proposalIds.has(proposalId))
  );
  const completenessRatio = input.proposals.length > 0 ? auditedProposalIds.size / input.proposals.length : 1;
  const completenessPercent = Math.round(completenessRatio * 100);
  const completenessMetric: ScoreMetric = {
    key: "audit_completeness",
    label: "Audit completeness",
    status: statusByLowerBound(completenessRatio, 0.98, 0.9),
    value: completenessPercent,
    unit: "percent",
    warningThreshold: 98,
    criticalThreshold: 90,
    owner: "Compliance",
    onCall: "trust-safety-primary",
  };

  const capabilityAuditRows = input.auditRows.filter(
    (row) =>
      row.action.startsWith("capability.") &&
      typeof row.metadata?.proposalId === "string" &&
      row.metadata.proposalId.trim().length > 0
  );
  const tenantCompleteRows = capabilityAuditRows.filter((row) => {
    const tenantId = row.metadata?.tenantId;
    return typeof tenantId === "string" && tenantId.trim().length > 0;
  });
  const tenantCompletenessRatio =
    capabilityAuditRows.length > 0 ? tenantCompleteRows.length / capabilityAuditRows.length : 1;
  const tenantCompletenessMetric: ScoreMetric = {
    key: "tenant_context_completeness",
    label: "Tenant context completeness",
    status: statusByLowerBound(tenantCompletenessRatio, 0.99, 0.95),
    value: Math.round(tenantCompletenessRatio * 100),
    unit: "percent",
    warningThreshold: 99,
    criticalThreshold: 95,
    owner: "Platform",
    onCall: "platform-primary",
  };

  const healthyRatio =
    input.connectors.length > 0 ? input.connectors.filter((row) => row.ok).length / input.connectors.length : 1;
  const connectorMetric: ScoreMetric = {
    key: "connector_health",
    label: "Connector health",
    status: statusByLowerBound(healthyRatio, 0.99, 0.8),
    value: Math.round(healthyRatio * 100),
    unit: "percent",
    warningThreshold: 99,
    criticalThreshold: 80,
    owner: "Integrations",
    onCall: "platform-primary",
  };

  const metrics = [snapshotMetric, decisionMetric, completenessMetric, tenantCompletenessMetric, connectorMetric];
  const overallStatus = metrics.reduce<ScoreStatus>((acc, metric) => maxStatus(acc, metric.status), "ok");
  return {
    computedAt: input.now.toISOString(),
    overallStatus,
    lastBreachAt: input.lastBreachAt,
    metrics,
  };
}
