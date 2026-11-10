import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  buildPilotExecutePayload,
  buildPilotRollbackPayload,
  buildProposalIdempotencyKey,
  canApproveProposalAction,
  canExecuteProposalAction,
  canRollbackProposalAction,
} from "./studioBrainGuards";
import {
  clearStoredStudioBrainBaseUrlOverride,
  getStoredStudioBrainBaseUrlOverride,
  resolveStudioBrainBaseUrlResolution,
  setStoredStudioBrainBaseUrlOverride,
} from "../../utils/studioBrain";
const __bundleClass_0 = "btn btn-secondary";
const __bundleClass_1 = "staff-actions-row";
const __bundleClass_2 = "staff-note staff-note-error";
const __bundleClass_3 = "staff-subtitle";
const __bundleClass_4 = "staff-kpi";
const __bundleClass_5 = "staff-table-wrap";
const __bundleClass_6 = "staff-table";
const __bundleClass_7 = "staff-mini";
const __bundleClass_8 = "staff-field";
const __bundleClass_9 = "staff-field staff-field-flex-1";
const __bundleClass_10 = "btn btn-ghost btn-small";


type Props = {
  user: User;
  active: boolean;
  disabled: boolean;
  adminToken: string;
};

type Capability = {
  id: string;
  target: string;
  requiresApproval: boolean;
  readOnly: boolean;
  maxCallsPerHour: number;
  risk: string;
};

type Proposal = {
  id: string;
  createdAt: string;
  requestedBy?: string;
  tenantId?: string;
  capabilityId: string;
  rationale: string;
  preview?: {
    summary?: string;
    expectedEffects?: string[];
  };
  status: string;
  approvedBy?: string;
  approvedAt?: string;
};

type QuotaBucket = {
  bucket: string;
  windowStart: string;
  count: number;
};

type CapabilityAuditEvent = {
  id: string;
  at: string;
  actorId: string;
  action: string;
  approvalState: string;
  rationale: string;
  metadata?: Record<string, unknown>;
};

type OpsAuditEvent = {
  id: string;
  at: string;
  actorId: string;
  action: string;
  rationale: string;
  metadata?: Record<string, unknown>;
};

type ConnectorHealthRow = {
  id: string;
  ok: boolean;
  latencyMs: number;
};

type OpsRecommendationDraft = {
  id: string;
  at: string;
  ruleId: string;
  severity: "low" | "medium" | "high";
  title: string;
  rationale: string;
  recommendation: string;
  snapshotDate: string;
};

type MarketingDraft = {
  id: string;
  draftId: string;
  at: string;
  status: "draft" | "needs_review" | "approved_for_publish";
  channel: "instagram" | "email";
  title: string;
  recommendation?: string;
};

type FinanceDraft = {
  id: string;
  at: string;
  ruleId: string;
  severity: "low" | "medium" | "high";
  title: string;
  rationale: string;
  recommendation: string;
  snapshotDate: string;
  evidenceRefs?: string[];
  confidence?: number;
};

type IntakeQueueRow = {
  intakeId: string;
  category: "illegal_content" | "weaponization" | "ip_infringement" | "fraud_risk" | "unknown";
  reasonCode: string;
  capabilityId?: string;
  actorId?: string;
  ownerUid?: string;
  at: string;
  summary?: string;
};

type RateLimitEvent = {
  id: string;
  at: string;
  actorId: string;
  action: string;
  rationale: string;
  metadata?: {
    bucket?: string;
    limit?: number;
    retryAfterSeconds?: number;
    method?: string;
    path?: string;
  };
};

type ScorecardMetric = {
  key: string;
  label: string;
  status: "ok" | "warning" | "critical";
  value: number | null;
  unit: "minutes" | "ratio" | "percent";
  owner: string;
  onCall: string;
};

type Scorecard = {
  computedAt: string;
  overallStatus: "ok" | "warning" | "critical";
  lastBreachAt: string | null;
  metrics: ScorecardMetric[];
};

type PolicyLintViolation = {
  capabilityId: string;
  code: string;
  message: string;
};

type PolicyLintStatus = {
  checkedAt: string;
  capabilitiesChecked: number;
  violations: PolicyLintViolation[];
};

type PolicyExemption = {
  id: string;
  capabilityId: string;
  ownerUid?: string;
  justification: string;
  approvedBy: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  status: "active" | "revoked" | "expired";
};

type PolicyState = {
  killSwitch: {
    enabled: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
    rationale: string | null;
  };
  exemptions: PolicyExemption[];
};

type SupportQueueSummary = {
  unread: number;
  awaitingInfo: number;
  awaitingApproval: number;
  securityHold: number;
  staffReview: number;
  warmTouchesDue: number;
  splitThreadSuspects: number;
  totalOpen: number;
  oldestOpenAt: string | null;
  slaAging: {
    fresh: number;
    warning: number;
    overdue: number;
  };
};

type SupportCaseRow = {
  supportRequestId: string;
  conversationKey: string;
  senderEmail: string | null;
  subject: string;
  decision: "auto_reply" | "ask_missing_info" | "staff_review" | "proposal_required" | "security_hold";
  riskState: "clear" | "possible_security_risk" | "high_risk";
  automationState: string;
  queueBucket: "unread" | "awaiting_info" | "awaiting_approval" | "security_hold" | "staff_review" | "resolved";
  threadDriftFlag: boolean;
  memberCareState: "none" | "due" | "drafted" | "sent" | "staff_follow_up";
  memberCareReason: "pickup_coordination" | "delay_reassurance" | "apology" | "gratitude" | "clarification" | null;
  lastCareTouchAt: string | null;
  nextRecommendedAction: string | null;
  supportSummary: string | null;
  emberMemoryScope: string | null;
  emberSummary: string | null;
  confusionState: "none" | "apologetic" | "uncertain" | "frustrated" | "grateful" | "overwhelmed";
  confusionReason: string | null;
  humanHandoff: boolean;
  linkedMemoryReviewCaseIds?: string[];
  policyResolution: {
    policySlug: string | null;
  };
  proposalId: string | null;
  proposalCapabilityId: string | null;
  lastReceivedAt: string;
};

type MemoryVerificationRunRow = {
  id: string;
  caseId: string | null;
  verifierKind: string;
  trigger: string;
  resultStatus: "passed" | "failed" | "needs-review" | "skipped";
  resultSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type MemoryReviewCaseRow = {
  id: string;
  caseType: "resolve-conflict" | "revalidate" | "retire" | "promote-guidance";
  status: "open" | "in-progress" | "resolved" | "dismissed";
  scope: string | null;
  primaryMemoryId: string | null;
  linkedMemoryIds: string[];
  priority: number;
  reasonCodes: string[];
  recommendedActions: Array<
    "verify_now" | "accept_winner" | "keep_quarantined" | "retire_memory" | "dismiss_case" | "promote_guidance" | "reject_promotion"
  >;
  lastVerificationRunId: string | null;
  updatedAt: string;
  resolution: string | null;
};

type SupportDeadLetter = {
  id: string;
  messageId: string | null;
  mailbox: string;
  errorMessage: string;
  createdAt: string;
};

const NO_BASE_URL_MESSAGE = "Studio Brain is not configured for this browser host.";

function when(iso: string | undefined): string {
  if (!iso) return "-";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
}

export default function StudioBrainModule({ user, active, disabled, adminToken }: Props) {
  const [, setResolutionVersion] = useState(0);
  const studioBrainResolution = resolveStudioBrainBaseUrlResolution();
  const studioBrainBaseUrl = studioBrainResolution.baseUrl;
  const [baseUrlDraft, setBaseUrlDraft] = useState(() => getStoredStudioBrainBaseUrlOverride());
  const [baseUrlStatus, setBaseUrlStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [quotaBuckets, setQuotaBuckets] = useState<QuotaBucket[]>([]);
  const [auditRows, setAuditRows] = useState<CapabilityAuditEvent[]>([]);
  const [delegationTraceRows, setDelegationTraceRows] = useState<CapabilityAuditEvent[]>([]);
  const [connectorRows, setConnectorRows] = useState<ConnectorHealthRow[]>([]);
  const [opsRecommendationRows, setOpsRecommendationRows] = useState<OpsRecommendationDraft[]>([]);
  const [marketingDraftRows, setMarketingDraftRows] = useState<MarketingDraft[]>([]);
  const [financeDraftRows, setFinanceDraftRows] = useState<FinanceDraft[]>([]);
  const [marketingReviewRationale, setMarketingReviewRationale] = useState("Reviewed for tone and factual consistency before publish queue.");
  const [intakeQueueRows, setIntakeQueueRows] = useState<IntakeQueueRow[]>([]);
  const [intakeDecisionReasonCode, setIntakeDecisionReasonCode] = useState("staff_override_context_verified");
  const [intakeDecisionRationale, setIntakeDecisionRationale] = useState("Staff reviewed context and recorded a manual intake decision.");
  const [rateLimitRows, setRateLimitRows] = useState<RateLimitEvent[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [policyLint, setPolicyLint] = useState<PolicyLintStatus | null>(null);
  const [opsAuditRows, setOpsAuditRows] = useState<OpsAuditEvent[]>([]);
  const [supportQueueSummary, setSupportQueueSummary] = useState<SupportQueueSummary | null>(null);
  const [supportCaseRows, setSupportCaseRows] = useState<SupportCaseRow[]>([]);
  const [supportDeadLetterRows, setSupportDeadLetterRows] = useState<SupportDeadLetter[]>([]);
  const [memoryReviewCaseRows, setMemoryReviewCaseRows] = useState<MemoryReviewCaseRow[]>([]);
  const [memoryVerificationRuns, setMemoryVerificationRuns] = useState<MemoryVerificationRunRow[]>([]);
  const [tenantContext, setTenantContext] = useState("monsoonfire-main");
  const [capabilityId, setCapabilityId] = useState("firestore.batch.close");
  const [rationale, setRationale] = useState("Close this batch after final QA pass completes.");
  const [batchIdDraft, setBatchIdDraft] = useState("mfb-demo-001");
  const [rejectReason, setRejectReason] = useState("Policy mismatch in final review.");
  const [reopenReason, setReopenReason] = useState("Need another review pass with updated context.");
  const [approvalRationale, setApprovalRationale] = useState("Approved after staff review and compliance verification.");
  const [resetReason, setResetReason] = useState("Emergency quota reset during incident triage.");
  const [killSwitchRationale, setKillSwitchRationale] = useState("Emergency freeze while validating policy behavior.");
  const [pilotRollbackReason, setPilotRollbackReason] = useState("Rollback pilot note due to incorrect context.");
  const [pilotIdempotencyKey, setPilotIdempotencyKey] = useState("");
  const [exemptionJustification, setExemptionJustification] = useState("Temporary policy exemption for incident mitigation with operator monitoring.");
  const [exemptionOwnerUid, setExemptionOwnerUid] = useState("");
  const [exemptionExpiresAt, setExemptionExpiresAt] = useState("");
  const [exemptionRevokeReason, setExemptionRevokeReason] = useState("Exemption no longer required after incident closure.");
  const [auditActionPrefix, setAuditActionPrefix] = useState("");
  const [auditActorFilter, setAuditActorFilter] = useState("");
  const [auditApprovalFilter, setAuditApprovalFilter] = useState("");
  const [proposalRiskFilter, setProposalRiskFilter] = useState("");
  const [proposalCapabilityFilter, setProposalCapabilityFilter] = useState("");
  const [proposalOwnerFilter, setProposalOwnerFilter] = useState("");
  const [proposalTenantFilter, setProposalTenantFilter] = useState("");
  const [proposalAgeFilter, setProposalAgeFilter] = useState("all");
  const [policy, setPolicy] = useState<PolicyState>({
    killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
    exemptions: [],
  });

  const hasAdminToken = adminToken.trim().length > 0;
  const disabledByToken = disabled || !hasAdminToken;

  const saveBaseUrlOverride = () => {
    setStoredStudioBrainBaseUrlOverride(baseUrlDraft);
    const nextResolution = resolveStudioBrainBaseUrlResolution();
    setResolutionVersion((prev) => prev + 1);
    setBaseUrlStatus(
      nextResolution.baseUrl
        ? `Studio Brain URL set to ${nextResolution.baseUrl}.`
        : nextResolution.reason || "Studio Brain URL is still unavailable.",
    );
  };

  const clearBaseUrlOverride = () => {
    clearStoredStudioBrainBaseUrlOverride();
    setBaseUrlDraft("");
    const nextResolution = resolveStudioBrainBaseUrlResolution();
    setResolutionVersion((prev) => prev + 1);
    setBaseUrlStatus(nextResolution.reason || "Studio Brain URL override cleared.");
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy || disabledByToken) return;
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!studioBrainBaseUrl) {
      throw new Error(studioBrainResolution.reason || NO_BASE_URL_MESSAGE);
    }
    const idToken = await user.getIdToken();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
      "x-studio-brain-admin-token": adminToken.trim(),
      ...(init?.headers ?? {}),
    };
    const resp = await fetch(`${studioBrainBaseUrl}${path}`, { ...init, headers });
    const payload = (await resp.json()) as T & { ok?: boolean; message?: string };
    if (!resp.ok) {
      throw new Error(payload.message || `Request failed (${resp.status})`);
    }
    return payload;
  };

  const loadAll = async () => {
    const auditParams = new URLSearchParams();
    auditParams.set("limit", "100");
    if (auditActionPrefix.trim()) auditParams.set("actionPrefix", auditActionPrefix.trim());
    if (auditActorFilter.trim()) auditParams.set("actorId", auditActorFilter.trim());
    if (auditApprovalFilter.trim()) auditParams.set("approvalState", auditApprovalFilter.trim());
    const [
      capResp,
      quotaResp,
      auditResp,
      delegationResp,
      recommendationResp,
      marketingResp,
      financeResp,
      intakeResp,
      rateLimitResp,
      scorecardResp,
      lintResp,
      opsAuditResp,
      supportQueueResp,
      memoryReviewResp,
      supportDeadLettersResp,
    ] = await Promise.all([
      fetchJson<{ capabilities?: Capability[]; proposals?: Proposal[]; policy?: PolicyState; connectors?: ConnectorHealthRow[] }>("/api/capabilities", {
        method: "GET",
      }),
      fetchJson<{ buckets?: QuotaBucket[] }>("/api/capabilities/quotas?limit=50", {
        method: "GET",
      }),
      fetchJson<{ rows?: CapabilityAuditEvent[] }>(`/api/capabilities/audit?${auditParams.toString()}`, {
        method: "GET",
      }),
      fetchJson<{ rows?: CapabilityAuditEvent[] }>(`/api/capabilities/delegation/traces?limit=50`, {
        method: "GET",
      }),
      fetchJson<{ rows?: OpsRecommendationDraft[] }>(`/api/ops/recommendations/drafts?limit=30`, {
        method: "GET",
      }),
      fetchJson<{ rows?: MarketingDraft[] }>(`/api/marketing/drafts?limit=30`, {
        method: "GET",
      }),
      fetchJson<{ rows?: FinanceDraft[] }>(`/api/finance/reconciliation/drafts?limit=30`, {
        method: "GET",
      }),
      fetchJson<{ rows?: IntakeQueueRow[] }>(`/api/intake/review-queue?limit=50`, {
        method: "GET",
      }),
      fetchJson<{ rows?: RateLimitEvent[] }>(`/api/capabilities/rate-limits/events?limit=50`, {
        method: "GET",
      }),
      fetchJson<{ scorecard?: Scorecard }>(`/api/ops/scorecard`, {
        method: "GET",
      }),
      fetchJson<{ checkedAt: string; capabilitiesChecked: number; violations: PolicyLintViolation[] }>(`/api/capabilities/policy-lint`, {
        method: "GET",
      }),
      fetchJson<{ rows?: OpsAuditEvent[] }>(`/api/ops/audit?limit=50`, {
        method: "GET",
      }),
      fetchJson<{ summary?: SupportQueueSummary; recentCases?: SupportCaseRow[] }>(`/api/support-ops/queue?limit=20`, {
        method: "GET",
      }),
      fetchJson<{ rows?: MemoryReviewCaseRow[]; latestVerificationRuns?: MemoryVerificationRunRow[] }>(`/api/memory/review-cases?limit=20`, {
        method: "GET",
      }),
      fetchJson<{ rows?: SupportDeadLetter[] }>(`/api/support-ops/dead-letters?limit=10`, {
        method: "GET",
      }),
    ]);
    setCapabilities(Array.isArray(capResp.capabilities) ? capResp.capabilities : []);
    setProposals(Array.isArray(capResp.proposals) ? capResp.proposals : []);
    setQuotaBuckets(Array.isArray(quotaResp.buckets) ? quotaResp.buckets : []);
    setAuditRows(Array.isArray(auditResp.rows) ? auditResp.rows : []);
    setDelegationTraceRows(Array.isArray(delegationResp.rows) ? delegationResp.rows : []);
    setConnectorRows(Array.isArray(capResp.connectors) ? capResp.connectors : []);
    setOpsRecommendationRows(Array.isArray(recommendationResp.rows) ? recommendationResp.rows : []);
    setMarketingDraftRows(Array.isArray(marketingResp.rows) ? marketingResp.rows : []);
    setFinanceDraftRows(Array.isArray(financeResp.rows) ? financeResp.rows : []);
    setIntakeQueueRows(Array.isArray(intakeResp.rows) ? intakeResp.rows : []);
    setRateLimitRows(Array.isArray(rateLimitResp.rows) ? rateLimitResp.rows : []);
    setScorecard(scorecardResp.scorecard ?? null);
    setPolicyLint({
      checkedAt: lintResp.checkedAt,
      capabilitiesChecked: lintResp.capabilitiesChecked,
      violations: Array.isArray(lintResp.violations) ? lintResp.violations : [],
    });
    setOpsAuditRows(Array.isArray(opsAuditResp.rows) ? opsAuditResp.rows : []);
    setSupportQueueSummary(supportQueueResp.summary ?? null);
    setSupportCaseRows(Array.isArray(supportQueueResp.recentCases) ? supportQueueResp.recentCases : []);
    setMemoryReviewCaseRows(Array.isArray(memoryReviewResp.rows) ? memoryReviewResp.rows : []);
    setMemoryVerificationRuns(Array.isArray(memoryReviewResp.latestVerificationRuns) ? memoryReviewResp.latestVerificationRuns : []);
    setSupportDeadLetterRows(Array.isArray(supportDeadLettersResp.rows) ? supportDeadLettersResp.rows : []);
    if (capResp.policy) {
      setPolicy({
        killSwitch: capResp.policy.killSwitch ?? { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
        exemptions: Array.isArray(capResp.policy.exemptions) ? capResp.policy.exemptions : [],
      });
    }
  };

  useEffect(() => {
    if (!active || disabledByToken || !studioBrainBaseUrl) return;
    void run("loadStudioBrain", loadAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabledByToken, auditActionPrefix, auditActorFilter, auditApprovalFilter, studioBrainBaseUrl]);

  const capabilityById = useMemo(() => new Map(capabilities.map((row) => [row.id, row])), [capabilities]);
  const latestVerificationRunByCaseId = useMemo(
    () => new Map(memoryVerificationRuns.filter((row) => row.caseId).map((row) => [row.caseId as string, row])),
    [memoryVerificationRuns],
  );
  const filteredProposals = useMemo(() => {
    const now = Date.now();
    return proposals.filter((row) => {
      if (proposalCapabilityFilter && row.capabilityId !== proposalCapabilityFilter) return false;
      if (proposalOwnerFilter.trim()) {
        const owner = String(row.requestedBy ?? "").toLowerCase();
        if (!owner.includes(proposalOwnerFilter.trim().toLowerCase())) return false;
      }
      if (proposalTenantFilter.trim()) {
        const tenant = String(row.tenantId ?? "").toLowerCase();
        if (!tenant.includes(proposalTenantFilter.trim().toLowerCase())) return false;
      }
      if (proposalRiskFilter) {
        const risk = capabilityById.get(row.capabilityId)?.risk ?? "";
        if (risk !== proposalRiskFilter) return false;
      }
      if (proposalAgeFilter !== "all") {
        const createdMs = Date.parse(row.createdAt);
        if (Number.isFinite(createdMs)) {
          const ageMin = (now - createdMs) / 60_000;
          if (proposalAgeFilter === "lt60" && ageMin >= 60) return false;
          if (proposalAgeFilter === "60to240" && (ageMin < 60 || ageMin > 240)) return false;
          if (proposalAgeFilter === "gt240" && ageMin <= 240) return false;
        }
      }
      return true;
    });
  }, [capabilityById, proposalAgeFilter, proposalCapabilityFilter, proposalOwnerFilter, proposalRiskFilter, proposalTenantFilter, proposals]);

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Studio Brain Admin</div>
        <button className={__bundleClass_0} disabled={Boolean(busy) || disabledByToken} onClick={() => void run("refreshStudioBrain", loadAll)}>
          Refresh
        </button>
      </div>
      <div className="staff-note">
        {studioBrainBaseUrl ? (
          <>
            Advanced administration surface. Use Control Tower for daily room, service, and incident operations.
            <br />
            Direct browser access to <code>{studioBrainBaseUrl}</code> requires both
            <code>Authorization: Bearer &lt;Firebase ID token&gt;</code> and
            <code>x-studio-brain-admin-token</code> when configured.
          </>
        ) : (
          <span>Studio Brain is disabled for this host. Configure a reachable browser URL or set a runtime override below.</span>
        )}
      </div>
      {!studioBrainBaseUrl ? (
        <div className="staff-note">
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span>Studio Brain base URL override</span>
            <input
              type="url"
              placeholder="https://studio-brain.example.com"
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className={__bundleClass_1} style={{ marginTop: "10px" }}>
            <button type="button" className="btn btn-primary" onClick={saveBaseUrlOverride}>
              Save URL
            </button>
            <button type="button" className={__bundleClass_0} onClick={clearBaseUrlOverride}>
              Clear
            </button>
          </div>
          {baseUrlStatus ? <div style={{ marginTop: "8px" }}>{baseUrlStatus}</div> : null}
        </div>
      ) : null}
      {!hasAdminToken ? (
        <div className={__bundleClass_2}>Set a Dev admin token in System module to access Studio Brain endpoints.</div>
      ) : null}
      {scorecard ? (
        <>
          <div className={__bundleClass_3}>SLO scorecard</div>
          <div className="staff-kpi-grid">
            <div className={__bundleClass_4}><span>Overall</span><strong>{scorecard.overallStatus}</strong></div>
            <div className={__bundleClass_4}><span>Computed</span><strong>{when(scorecard.computedAt)}</strong></div>
            <div className={__bundleClass_4}><span>Last breach</span><strong>{when(scorecard.lastBreachAt ?? undefined)}</strong></div>
            <div className={__bundleClass_4}><span>Metrics tracked</span><strong>{scorecard.metrics.length}</strong></div>
          </div>
          <div className={__bundleClass_5}>
            <table className={__bundleClass_6}>
              <thead><tr><th>Metric</th><th>Status</th><th>Value</th><th>Owner</th><th>On-call</th></tr></thead>
              <tbody>
                {scorecard.metrics.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.status}</td>
                    <td>{row.value ?? "-"} {row.unit === "percent" ? "%" : row.unit === "minutes" ? "min" : row.unit}</td>
                    <td>{row.owner}</td>
                    <td>{row.onCall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {policyLint ? (
        <>
          <div className={__bundleClass_3}>Policy lint</div>
          <div className="staff-kpi-grid">
            <div className={__bundleClass_4}><span>Checked</span><strong>{when(policyLint.checkedAt)}</strong></div>
            <div className={__bundleClass_4}><span>Capabilities</span><strong>{policyLint.capabilitiesChecked}</strong></div>
            <div className={__bundleClass_4}><span>Violations</span><strong>{policyLint.violations.length}</strong></div>
          </div>
          {policyLint.violations.length > 0 ? (
            <div className={__bundleClass_5}>
              <table className={__bundleClass_6}>
                <thead><tr><th>Capability</th><th>Code</th><th>Message</th></tr></thead>
                <tbody>
                  {policyLint.violations.map((row, index) => (
                    <tr key={`${row.capabilityId}-${row.code}-${index}`}>
                      <td><code>{row.capabilityId}</code></td>
                      <td><code>{row.code}</code></td>
                      <td>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="staff-note">No policy lint violations.</div>
          )}
        </>
      ) : null}

      {supportQueueSummary ? (
        <>
          <div className={__bundleClass_3}>Support ops queue</div>
          <div className="staff-kpi-grid">
            <div className={__bundleClass_4}><span>Unread</span><strong>{supportQueueSummary.unread}</strong></div>
            <div className={__bundleClass_4}><span>Awaiting info</span><strong>{supportQueueSummary.awaitingInfo}</strong></div>
            <div className={__bundleClass_4}><span>Awaiting approval</span><strong>{supportQueueSummary.awaitingApproval}</strong></div>
            <div className={__bundleClass_4}><span>Security hold</span><strong>{supportQueueSummary.securityHold}</strong></div>
            <div className={__bundleClass_4}><span>Staff review</span><strong>{supportQueueSummary.staffReview}</strong></div>
            <div className={__bundleClass_4}><span>Warm touches due</span><strong>{supportQueueSummary.warmTouchesDue}</strong></div>
            <div className={__bundleClass_4}><span>Split thread suspects</span><strong>{supportQueueSummary.splitThreadSuspects}</strong></div>
            <div className={__bundleClass_4}><span>Oldest open</span><strong>{when(supportQueueSummary.oldestOpenAt ?? undefined)}</strong></div>
            <div className={__bundleClass_4}><span>SLA fresh</span><strong>{supportQueueSummary.slaAging.fresh}</strong></div>
            <div className={__bundleClass_4}><span>SLA warning</span><strong>{supportQueueSummary.slaAging.warning}</strong></div>
            <div className={__bundleClass_4}><span>SLA overdue</span><strong>{supportQueueSummary.slaAging.overdue}</strong></div>
          </div>
          <div className={__bundleClass_5}>
            <table className={__bundleClass_6}>
              <thead><tr><th>Received</th><th>Case</th><th>Queue</th><th>Care</th><th>Risk</th><th>Decision</th><th>Policy</th></tr></thead>
              <tbody>
                {supportCaseRows.length === 0 ? (
                  <tr><td colSpan={7}>No support-op cases mirrored yet.</td></tr>
                ) : (
                  supportCaseRows.map((row) => (
                    <tr key={row.supportRequestId}>
                      <td>{when(row.lastReceivedAt)}</td>
                      <td>
                        <code>{row.supportRequestId}</code>
                        <div className={__bundleClass_7}>{row.subject}</div>
                        {row.senderEmail ? <div className={__bundleClass_7}>{row.senderEmail}</div> : null}
                        {row.supportSummary ? <div className={__bundleClass_7}>{row.supportSummary}</div> : null}
                        {row.emberSummary ? <div className={__bundleClass_7}>Ember: {row.emberSummary}</div> : null}
                        {row.emberMemoryScope ? <div className={__bundleClass_7}><code>{row.emberMemoryScope}</code></div> : null}
                        {row.threadDriftFlag ? <div className={__bundleClass_7}>Thread drift suspect</div> : null}
                        {row.linkedMemoryReviewCaseIds && row.linkedMemoryReviewCaseIds.length > 0 ? (
                          <div className={__bundleClass_7}>Memory reviews: {row.linkedMemoryReviewCaseIds.join(", ")}</div>
                        ) : null}
                      </td>
                      <td>{row.queueBucket}</td>
                      <td>
                        {row.memberCareState}
                        {row.memberCareReason ? <div className={__bundleClass_7}>{row.memberCareReason.replaceAll("_", " ")}</div> : null}
                        {row.lastCareTouchAt ? <div className={__bundleClass_7}>Last touch {when(row.lastCareTouchAt)}</div> : null}
                      </td>
                      <td>
                        {row.riskState}
                        {row.confusionState !== "none" ? <div className={__bundleClass_7}>Confusion: {row.confusionState}</div> : null}
                        {row.confusionReason ? <div className={__bundleClass_7}>{row.confusionReason}</div> : null}
                        {row.humanHandoff ? <div className={__bundleClass_7}>Human handoff</div> : null}
                      </td>
                      <td>
                        {row.decision}
                        <div className={__bundleClass_7}>{row.automationState}</div>
                        {row.proposalId ? <div className={__bundleClass_7}>Proposal: {row.proposalId}</div> : null}
                        {row.nextRecommendedAction ? <div className={__bundleClass_7}>{row.nextRecommendedAction}</div> : null}
                      </td>
                      <td>{row.policyResolution?.policySlug ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className={__bundleClass_3}>Memory review</div>
          <div className={__bundleClass_5}>
            <table className={__bundleClass_6}>
              <thead><tr><th>Updated</th><th>Case</th><th>Scope</th><th>Linked memories</th><th>Verifier</th><th>Actions</th></tr></thead>
              <tbody>
                {memoryReviewCaseRows.length === 0 ? (
                  <tr><td colSpan={6}>No open memory review cases.</td></tr>
                ) : (
                  memoryReviewCaseRows.map((row) => {
                    const verification = latestVerificationRunByCaseId.get(row.id);
                    return (
                      <tr key={row.id}>
                        <td>{when(row.updatedAt)}</td>
                        <td>
                          <code>{row.id}</code>
                          <div className={__bundleClass_7}>{row.caseType}</div>
                          <div className={__bundleClass_7}>{row.status}</div>
                          {row.resolution ? <div className={__bundleClass_7}>{row.resolution}</div> : null}
                        </td>
                        <td>{row.scope ?? "-"}</td>
                        <td>
                          <div className={__bundleClass_7}>{row.primaryMemoryId ?? "-"}</div>
                          <div className={__bundleClass_7}>{row.linkedMemoryIds.join(", ") || "-"}</div>
                          {row.reasonCodes.length > 0 ? <div className={__bundleClass_7}>{row.reasonCodes.join(", ")}</div> : null}
                        </td>
                        <td>
                          {verification ? (
                            <>
                              <div>{verification.resultStatus}</div>
                              <div className={__bundleClass_7}>{verification.verifierKind}</div>
                              {verification.resultSummary ? <div className={__bundleClass_7}>{verification.resultSummary}</div> : null}
                            </>
                          ) : (
                            row.lastVerificationRunId ?? "-"
                          )}
                        </td>
                        <td>
                          <div className={__bundleClass_1} style={{ flexWrap: "wrap" }}>
                            {row.recommendedActions.slice(0, 3).map((action) => (
                              <button
                                key={`${row.id}-${action}`}
                                type="button"
                                className={__bundleClass_0}
                                disabled={Boolean(busy) || disabledByToken}
                                onClick={() =>
                                  void run(`memory-review:${action}`, async () => {
                                    await fetchJson(`/api/memory/review-cases/${encodeURIComponent(row.id)}/actions`, {
                                      method: "POST",
                                      body: JSON.stringify({
                                        action,
                                        actorId: user.uid,
                                        selectedMemoryId: row.primaryMemoryId ?? row.linkedMemoryIds[0] ?? undefined,
                                      }),
                                    });
                                    await loadAll();
                                    setStatus(`Memory review ${action} applied.`);
                                  })
                                }
                              >
                                {action.replaceAll("_", " ")}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className={__bundleClass_3}>Support dead letters</div>
          <div className={__bundleClass_5}>
            <table className={__bundleClass_6}>
              <thead><tr><th>At</th><th>Mailbox</th><th>Message</th><th>Error</th></tr></thead>
              <tbody>
                {supportDeadLetterRows.length === 0 ? (
                  <tr><td colSpan={4}>No support dead letters.</td></tr>
                ) : (
                  supportDeadLetterRows.map((row) => (
                    <tr key={row.id}>
                      <td>{when(row.createdAt)}</td>
                      <td>{row.mailbox}</td>
                      <td><code>{row.messageId ?? row.id}</code></td>
                      <td>{row.errorMessage}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="staff-module-grid">
        <div className="staff-column">
          <div className={__bundleClass_3}>Create proposal</div>
          <label className={__bundleClass_8}>
            Capability
            <select value={capabilityId} onChange={(event) => setCapabilityId(event.target.value)}>
              {capabilities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id}
                </option>
              ))}
            </select>
          </label>
          <label className={__bundleClass_8}>
            Batch ID
            <input value={batchIdDraft} onChange={(event) => setBatchIdDraft(event.target.value)} />
          </label>
          <label className={__bundleClass_8}>
            Tenant
            <input value={tenantContext} onChange={(event) => setTenantContext(event.target.value)} />
          </label>
          <label className={__bundleClass_8}>
            Rationale
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} />
          </label>
          <label className={__bundleClass_8}>
            Reject reason
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
          </label>
          <button
            className="btn btn-primary"
            disabled={Boolean(busy) || disabledByToken || !capabilityId || !rationale.trim()}
            onClick={() =>
              void run("createStudioBrainProposal", async () => {
                await fetchJson("/api/capabilities/proposals", {
                  method: "POST",
                  body: JSON.stringify({
                    actorType: "staff",
                    actorId: user.uid,
                    ownerUid: user.uid,
                    tenantId: tenantContext.trim() || user.uid,
                    capabilityId,
                    rationale: rationale.trim(),
                    previewSummary: `Proposal from Staff Console for ${capabilityId}`,
                    requestInput: { batchId: batchIdDraft.trim() || null, tenantId: tenantContext.trim() || user.uid },
                    expectedEffects: ["Audited proposal lifecycle."],
                    requestedBy: user.uid,
                  }),
                });
                await loadAll();
                setStatus("Proposal created.");
              })
            }
          >
            Create proposal
          </button>
        </div>

        <div className="staff-column">
      <div className={__bundleClass_3}>Capabilities</div>
          <div className={__bundleClass_5}>
            <table className={__bundleClass_6}>
              <thead><tr><th>ID</th><th>Target</th><th>Approval</th><th>Risk</th></tr></thead>
              <tbody>
                {capabilities.length === 0 ? <tr><td colSpan={4}>No capabilities loaded.</td></tr> : capabilities.map((row) => (
                  <tr key={row.id}>
                    <td><code>{row.id}</code></td>
                    <td>{row.target}</td>
                    <td>{row.requiresApproval ? "required" : "exempt"}</td>
                    <td>{row.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={__bundleClass_3}>Policy controls</div>
      <div className="staff-note">
        Kill switch: <strong>{policy.killSwitch.enabled ? "ENABLED" : "disabled"}</strong>
        {policy.killSwitch.updatedAt ? ` (updated ${when(policy.killSwitch.updatedAt)} by ${policy.killSwitch.updatedBy ?? "unknown"})` : ""}
      </div>
      {policy.killSwitch.rationale ? <div className="staff-note">Last rationale: {policy.killSwitch.rationale}</div> : null}
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Kill switch rationale
          <input value={killSwitchRationale} onChange={(event) => setKillSwitchRationale(event.target.value)} />
        </label>
        <button
          className={__bundleClass_0}
          disabled={Boolean(busy) || disabledByToken || !killSwitchRationale.trim()}
          onClick={() =>
            void run("toggle-kill-switch", async () => {
              await fetchJson("/api/capabilities/policy/kill-switch", {
                method: "POST",
                body: JSON.stringify({
                  enabled: !policy.killSwitch.enabled,
                  rationale: killSwitchRationale.trim(),
                }),
              });
              await loadAll();
              setStatus(`Kill switch ${!policy.killSwitch.enabled ? "enabled" : "disabled"}.`);
            })
          }
        >
          {policy.killSwitch.enabled ? "Disable kill switch" : "Enable kill switch"}
        </button>
      </div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_8}>
          Exemption owner UID (optional)
          <input value={exemptionOwnerUid} onChange={(event) => setExemptionOwnerUid(event.target.value)} placeholder="all owners if blank" />
        </label>
        <label className={__bundleClass_8}>
          Expires at (optional ISO)
          <input value={exemptionExpiresAt} onChange={(event) => setExemptionExpiresAt(event.target.value)} placeholder="2026-02-13T05:00:00.000Z" />
        </label>
      </div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Exemption justification
          <input value={exemptionJustification} onChange={(event) => setExemptionJustification(event.target.value)} />
        </label>
        <button
          className="btn btn-primary"
          disabled={Boolean(busy) || disabledByToken || !capabilityId || !exemptionJustification.trim()}
          onClick={() =>
            void run("create-exemption", async () => {
              await fetchJson("/api/capabilities/policy/exemptions", {
                method: "POST",
                body: JSON.stringify({
                  capabilityId,
                  ownerUid: exemptionOwnerUid.trim() || undefined,
                  expiresAt: exemptionExpiresAt.trim() || undefined,
                  justification: exemptionJustification.trim(),
                }),
              });
              await loadAll();
              setStatus("Policy exemption created.");
            })
          }
        >
          Create exemption
        </button>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>Capability</th><th>Owner</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead>
          <tbody>
            {policy.exemptions.length === 0 ? <tr><td colSpan={5}>No exemptions.</td></tr> : policy.exemptions.slice(0, 25).map((row) => (
              <tr key={row.id}>
                <td><code>{row.capabilityId}</code></td>
                <td>{row.ownerUid ? <code>{row.ownerUid}</code> : "all owners"}</td>
                <td>{row.status}</td>
                <td>{when(row.expiresAt)}</td>
                <td>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || row.status !== "active" || !exemptionRevokeReason.trim()}
                    onClick={() =>
                      void run(`revoke-${row.id}`, async () => {
                        await fetchJson(`/api/capabilities/policy/exemptions/${encodeURIComponent(row.id)}/revoke`, {
                          method: "POST",
                          body: JSON.stringify({ reason: exemptionRevokeReason.trim() }),
                        });
                        await loadAll();
                        setStatus(`Revoked exemption ${row.id}.`);
                      })
                    }
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Exemption revoke reason
          <input value={exemptionRevokeReason} onChange={(event) => setExemptionRevokeReason(event.target.value)} />
        </label>
      </div>
      <div className={__bundleClass_3}>Connector health</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>Connector</th><th>Status</th><th>Latency ms</th></tr></thead>
          <tbody>
            {connectorRows.length === 0 ? <tr><td colSpan={3}>No connector health rows.</td></tr> : connectorRows.map((row) => (
              <tr key={row.id}>
                <td><code>{row.id}</code></td>
                <td>{row.ok ? "healthy" : "degraded"}</td>
                <td>{row.latencyMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={__bundleClass_3}>Recent proposals</div>
      {intakeQueueRows.length > 0 ? (
        <div className={__bundleClass_2}>
          Intake risk banner: {intakeQueueRows.length} high-risk intake item(s) are blocked pending staff review.
        </div>
      ) : null}
      <div className={__bundleClass_1}>
        <label className={__bundleClass_8}>
          Pilot idempotency key
          <input value={pilotIdempotencyKey} onChange={(event) => setPilotIdempotencyKey(event.target.value)} placeholder="pilot-key-..." />
        </label>
        <label className={__bundleClass_8}>
          Pilot rollback reason
          <input value={pilotRollbackReason} onChange={(event) => setPilotRollbackReason(event.target.value)} />
        </label>
        <label className={__bundleClass_8}>
          Risk
          <select value={proposalRiskFilter} onChange={(event) => setProposalRiskFilter(event.target.value)}>
            <option value="">All</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label className={__bundleClass_8}>
          Capability
          <select value={proposalCapabilityFilter} onChange={(event) => setProposalCapabilityFilter(event.target.value)}>
            <option value="">All</option>
            {capabilities.map((row) => (
              <option key={row.id} value={row.id}>{row.id}</option>
            ))}
          </select>
        </label>
        <label className={__bundleClass_8}>
          Owner
          <input value={proposalOwnerFilter} onChange={(event) => setProposalOwnerFilter(event.target.value)} placeholder="requestedBy uid" />
        </label>
        <label className={__bundleClass_8}>
          Tenant
          <input value={proposalTenantFilter} onChange={(event) => setProposalTenantFilter(event.target.value)} placeholder="tenant id" />
        </label>
        <label className={__bundleClass_8}>
          Age
          <select value={proposalAgeFilter} onChange={(event) => setProposalAgeFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="lt60">&lt; 60m</option>
            <option value="60to240">60m-240m</option>
            <option value="gt240">&gt; 240m</option>
          </select>
        </label>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Capability</th><th>Status</th><th>Impact</th><th>Audit</th><th>Actions</th></tr></thead>
          <tbody>
            {filteredProposals.length === 0 ? <tr><td colSpan={6}>No proposals matching filters.</td></tr> : filteredProposals.slice(0, 25).map((row) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td>
                <td><code>{row.capabilityId}</code></td>
                <td>{row.status}</td>
                <td>
                  <div className={__bundleClass_7}>{row.preview?.summary ?? row.rationale}</div>
                  <div className={__bundleClass_7}>tenant: {row.tenantId ?? "-"}</div>
                  <div className={__bundleClass_7}>{(row.preview?.expectedEffects ?? []).slice(0, 1).join("")}</div>
                </td>
                <td>
                  <div className={__bundleClass_7}>
                    chain: {auditRows.filter((evt) => String(evt.metadata?.proposalId ?? "") === row.id).length}
                  </div>
                </td>
                <td className={__bundleClass_1}>
                  <button
                    className={__bundleClass_10}
                    disabled={
                      !canApproveProposalAction({
                        busy: Boolean(busy),
                        disabledByToken,
                        approvalRationale,
                      })
                    }
                    onClick={() =>
                      void run(`approve-${row.id}`, async () => {
                        await fetchJson(`/api/capabilities/proposals/${row.id}/approve`, {
                          method: "POST",
                          body: JSON.stringify({ approvedBy: user.uid, rationale: approvalRationale.trim() }),
                        });
                        await loadAll();
                        setStatus(`Approved ${row.id}.`);
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken}
                    onClick={() =>
                      void run(`dry-run-${row.id}`, async () => {
                        const payload = await fetchJson<{ dryRun?: unknown }>(`/api/capabilities/proposals/${row.id}/dry-run`, {
                          method: "GET",
                        });
                        setStatus(`Dry-run for ${row.id}: ${JSON.stringify(payload.dryRun ?? {})}`);
                      })
                    }
                  >
                    Dry run
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={
                      !canExecuteProposalAction({
                        busy: Boolean(busy),
                        disabledByToken,
                      })
                    }
                    onClick={() =>
                      void run(`execute-${row.id}`, async () => {
                        const idempotencyKey = buildProposalIdempotencyKey({
                          manualKey: pilotIdempotencyKey,
                          proposalId: row.id,
                          nowMs: Date.now(),
                        });
                        await fetchJson(`/api/capabilities/proposals/${row.id}/execute`, {
                          method: "POST",
                          body: JSON.stringify(
                            buildPilotExecutePayload({
                              userUid: user.uid,
                              tenantContext,
                              idempotencyKey,
                            })
                          ),
                        });
                        setPilotIdempotencyKey(idempotencyKey);
                        await loadAll();
                        setStatus(`Executed ${row.id}.`);
                      })
                    }
                  >
                    Execute
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={
                      !canRollbackProposalAction({
                        busy: Boolean(busy),
                        disabledByToken,
                        proposalStatus: row.status,
                        rollbackReason: pilotRollbackReason,
                        idempotencyKey: pilotIdempotencyKey,
                      })
                    }
                    onClick={() =>
                      void run(`rollback-${row.id}`, async () => {
                        await fetchJson(`/api/capabilities/proposals/${row.id}/rollback`, {
                          method: "POST",
                          body: JSON.stringify(
                            buildPilotRollbackPayload({
                              idempotencyKey: pilotIdempotencyKey,
                              reason: pilotRollbackReason,
                            })
                          ),
                        });
                        await loadAll();
                        setStatus(`Rollback requested for ${row.id}.`);
                      })
                    }
                  >
                    Rollback
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || !rejectReason.trim()}
                    onClick={() =>
                      void run(`reject-${row.id}`, async () => {
                        await fetchJson(`/api/capabilities/proposals/${row.id}/reject`, {
                          method: "POST",
                          body: JSON.stringify({ reason: rejectReason.trim() }),
                        });
                        await loadAll();
                        setStatus(`Rejected ${row.id}.`);
                      })
                    }
                  >
                    Reject
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || row.status !== "rejected" || !reopenReason.trim()}
                    onClick={() =>
                      void run(`reopen-${row.id}`, async () => {
                        await fetchJson(`/api/capabilities/proposals/${row.id}/reopen`, {
                          method: "POST",
                          body: JSON.stringify({ reason: reopenReason.trim() }),
                        });
                        await loadAll();
                        setStatus(`Reopened ${row.id}.`);
                      })
                    }
                  >
                    Reopen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Approval rationale
          <input value={approvalRationale} onChange={(event) => setApprovalRationale(event.target.value)} />
        </label>
        <label className={__bundleClass_9}>
          Reopen reason (admin only)
          <input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
        </label>
      </div>

      <div className={__bundleClass_3}>Quota buckets</div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Reset reason
          <input value={resetReason} onChange={(event) => setResetReason(event.target.value)} />
        </label>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>Bucket</th><th>Count</th><th>Window start</th><th>Reset</th></tr></thead>
          <tbody>
            {quotaBuckets.length === 0 ? <tr><td colSpan={4}>No quota buckets yet.</td></tr> : quotaBuckets.slice(0, 25).map((bucket) => (
              <tr key={bucket.bucket}>
                <td><code>{bucket.bucket}</code></td>
                <td>{bucket.count}</td>
                <td>{when(bucket.windowStart)}</td>
                <td>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || !resetReason.trim()}
                    onClick={() =>
                      void run(`reset-${bucket.bucket}`, async () => {
                        await fetchJson(`/api/capabilities/quotas/${encodeURIComponent(bucket.bucket)}/reset`, {
                          method: "POST",
                          body: JSON.stringify({ reason: resetReason.trim() }),
                        });
                        await loadAll();
                        setStatus(`Reset ${bucket.bucket}.`);
                      })
                    }
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_3}>Rate limit events</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Actor</th><th>Bucket</th><th>Path</th><th>Retry after</th></tr></thead>
          <tbody>
            {rateLimitRows.length === 0 ? <tr><td colSpan={5}>No recent rate-limit events.</td></tr> : rateLimitRows.slice(0, 25).map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td><code>{row.actorId}</code></td>
                <td><code>{row.metadata?.bucket ?? "-"}</code></td>
                <td><code>{row.metadata?.path ?? "-"}</code></td>
                <td>{row.metadata?.retryAfterSeconds ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={__bundleClass_3}>Capability audit</div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_8}>
          Action prefix
          <input value={auditActionPrefix} onChange={(event) => setAuditActionPrefix(event.target.value)} placeholder="capability.firestore" />
        </label>
        <label className={__bundleClass_8}>
          Actor ID
          <input value={auditActorFilter} onChange={(event) => setAuditActorFilter(event.target.value)} placeholder="staff uid" />
        </label>
        <label className={__bundleClass_8}>
          Approval
          <select value={auditApprovalFilter} onChange={(event) => setAuditApprovalFilter(event.target.value)}>
            <option value="">All</option>
            <option value="required">required</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="exempt">exempt</option>
          </select>
        </label>
      </div>

      <div className={__bundleClass_3}>Delegation traces</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Action</th><th>Actor</th><th>Approval</th><th>Rationale</th></tr></thead>
          <tbody>
            {delegationTraceRows.length === 0 ? <tr><td colSpan={5}>No delegation traces yet.</td></tr> : delegationTraceRows.slice(0, 20).map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td><code>{row.action}</code></td>
                <td><code>{row.actorId}</code></td>
                <td>{row.approvalState}</td>
                <td>{row.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={__bundleClass_3}>Ops recommendation drafts</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Rule</th><th>Severity</th><th>Title</th><th>Recommendation</th></tr></thead>
          <tbody>
            {opsRecommendationRows.length === 0 ? <tr><td colSpan={5}>No recommendation drafts yet.</td></tr> : opsRecommendationRows.slice(0, 20).map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td><code>{row.ruleId}</code></td>
                <td>{row.severity}</td>
                <td>{row.title}</td>
                <td>{row.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_3}>Marketing drafts</div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_9}>
          Review rationale
          <input value={marketingReviewRationale} onChange={(event) => setMarketingReviewRationale(event.target.value)} />
        </label>
      </div>
      <div className={__bundleClass_3}>Intake review queue</div>
      <div className={__bundleClass_1}>
        <label className={__bundleClass_8}>
          Decision reason code
          <select value={intakeDecisionReasonCode} onChange={(event) => setIntakeDecisionReasonCode(event.target.value)}>
            <option value="staff_override_context_verified">staff_override_context_verified</option>
            <option value="staff_override_rights_attested">staff_override_rights_attested</option>
            <option value="policy_confirmed_block">policy_confirmed_block</option>
            <option value="policy_confirmed_illegal">policy_confirmed_illegal</option>
          </select>
        </label>
        <label className={__bundleClass_9}>
          Decision rationale
          <input value={intakeDecisionRationale} onChange={(event) => setIntakeDecisionRationale(event.target.value)} />
        </label>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Category</th><th>Reason</th><th>Capability</th><th>Actor</th><th>Action</th></tr></thead>
          <tbody>
            {intakeQueueRows.length === 0 ? <tr><td colSpan={6}>No blocked intake items.</td></tr> : intakeQueueRows.slice(0, 20).map((row) => (
              <tr key={`${row.intakeId}-${row.at}`}>
                <td>{when(row.at)}</td>
                <td>{row.category}</td>
                <td><code>{row.reasonCode}</code></td>
                <td><code>{row.capabilityId ?? "-"}</code></td>
                <td><code>{row.actorId ?? "-"}</code></td>
                <td className={__bundleClass_1}>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || intakeDecisionRationale.trim().length < 10 || !intakeDecisionReasonCode.startsWith("staff_override_")}
                    onClick={() =>
                      void run(`intake-grant-${row.intakeId}`, async () => {
                        await fetchJson(`/api/intake/review-queue/${encodeURIComponent(row.intakeId)}/override`, {
                          method: "POST",
                          body: JSON.stringify({
                            decision: "override_granted",
                            reasonCode: intakeDecisionReasonCode,
                            rationale: intakeDecisionRationale.trim(),
                          }),
                        });
                        await loadAll();
                        setStatus(`Override granted for ${row.intakeId}.`);
                      })
                    }
                  >
                    Grant override
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || intakeDecisionRationale.trim().length < 10 || !intakeDecisionReasonCode.startsWith("policy_")}
                    onClick={() =>
                      void run(`intake-deny-${row.intakeId}`, async () => {
                        await fetchJson(`/api/intake/review-queue/${encodeURIComponent(row.intakeId)}/override`, {
                          method: "POST",
                          body: JSON.stringify({
                            decision: "override_denied",
                            reasonCode: intakeDecisionReasonCode,
                            rationale: intakeDecisionRationale.trim(),
                          }),
                        });
                        await loadAll();
                        setStatus(`Override denied for ${row.intakeId}.`);
                      })
                    }
                  >
                    Deny override
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_3}>Finance reconciliation drafts</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Rule</th><th>Severity</th><th>Title</th><th>Action</th></tr></thead>
          <tbody>
            {financeDraftRows.length === 0 ? (
              <tr><td colSpan={5}>No finance drafts yet.</td></tr>
            ) : (
              financeDraftRows.slice(0, 20).map((row) => (
                <tr key={row.id}>
                  <td>{when(row.at)}</td>
                  <td><code>{row.ruleId}</code></td>
                  <td>{row.severity}</td>
                  <td>
                    {row.title}
                    <div className={__bundleClass_7}>{row.rationale}</div>
                    <div className={__bundleClass_7}>{row.recommendation}</div>
                    {row.evidenceRefs?.length ? <div className={__bundleClass_7}>Evidence: {row.evidenceRefs.join(", ")}</div> : null}
                  </td>
                  <td>
                    <button
                      className={__bundleClass_10}
                      disabled={Boolean(busy) || disabledByToken}
                      onClick={() =>
                        void run(`finance-proposal-${row.id}`, async () => {
                          await fetchJson("/api/capabilities/proposals", {
                            method: "POST",
                            body: JSON.stringify({
                              actorType: "staff",
                              actorId: user.uid,
                              ownerUid: user.uid,
                              capabilityId: "finance.reconciliation.adjust",
                              rationale: `Finance reconciliation draft ${row.ruleId} from ${row.snapshotDate}.`,
                              previewSummary: row.title,
                              requestInput: {
                                ruleId: row.ruleId,
                                snapshotDate: row.snapshotDate,
                                evidenceRefs: row.evidenceRefs ?? [],
                              },
                              expectedEffects: ["Staff-reviewed finance correction proposal created."],
                              requestedBy: user.uid,
                            }),
                          });
                          await loadAll();
                          setStatus(`Created finance correction proposal for ${row.ruleId}.`);
                        })
                      }
                    >
                      Create proposal
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_3}>Audit export</div>
      <div className={__bundleClass_1}>
        <button
          className={__bundleClass_0}
          disabled={Boolean(busy) || disabledByToken}
          onClick={() =>
            void run("exportAuditBundle", async () => {
              const payload = await fetchJson<{ bundle?: unknown }>("/api/capabilities/audit/export?limit=500", { method: "GET" });
              await navigator.clipboard.writeText(JSON.stringify(payload.bundle ?? {}, null, 2));
              setStatus("Copied signed audit export bundle JSON to clipboard.");
            })
          }
        >
          Copy audit export bundle
        </button>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Draft</th><th>Channel</th><th>Status</th><th>Title</th><th>Action</th></tr></thead>
          <tbody>
            {marketingDraftRows.length === 0 ? <tr><td colSpan={6}>No marketing drafts yet.</td></tr> : marketingDraftRows.slice(0, 20).map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td><code>{row.draftId}</code></td>
                <td>{row.channel}</td>
                <td>{row.status}</td>
                <td>{row.title}</td>
                <td className={__bundleClass_1}>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || row.status !== "draft" || marketingReviewRationale.trim().length < 10}
                    onClick={() =>
                      void run(`mk-review-${row.draftId}`, async () => {
                        await fetchJson(`/api/marketing/drafts/${encodeURIComponent(row.draftId)}/review`, {
                          method: "POST",
                          body: JSON.stringify({
                            toStatus: "needs_review",
                            rationale: marketingReviewRationale.trim(),
                          }),
                        });
                        await loadAll();
                        setStatus(`Moved ${row.draftId} to needs_review.`);
                      })
                    }
                  >
                    Mark needs_review
                  </button>
                  <button
                    className={__bundleClass_10}
                    disabled={Boolean(busy) || disabledByToken || row.status !== "needs_review" || marketingReviewRationale.trim().length < 10}
                    onClick={() =>
                      void run(`mk-approve-${row.draftId}`, async () => {
                        await fetchJson(`/api/marketing/drafts/${encodeURIComponent(row.draftId)}/review`, {
                          method: "POST",
                          body: JSON.stringify({
                            toStatus: "approved_for_publish",
                            rationale: marketingReviewRationale.trim(),
                          }),
                        });
                        await loadAll();
                        setStatus(`Moved ${row.draftId} to approved_for_publish.`);
                      })
                    }
                  >
                    Approve for publish
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Action</th><th>Actor</th><th>Approval</th><th>Rationale</th></tr></thead>
          <tbody>
            {auditRows.length === 0 ? <tr><td colSpan={5}>No capability audit events yet.</td></tr> : auditRows.slice(0, 30).map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td><code>{row.action}</code></td>
                <td><code>{row.actorId}</code></td>
                <td>{row.approvalState}</td>
                <td>{row.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={__bundleClass_3}>Ops audit timeline</div>
      <div className={__bundleClass_5}>
        <table className={__bundleClass_6}>
          <thead><tr><th>At</th><th>Action</th><th>Actor</th><th>Rationale</th></tr></thead>
          <tbody>
            {opsAuditRows.length === 0 ? (
              <tr><td colSpan={4}>No ops audit events yet.</td></tr>
            ) : (
              opsAuditRows.slice(0, 30).map((row) => (
                <tr key={row.id}>
                  <td>{when(row.at)}</td>
                  <td><code>{row.action}</code></td>
                  <td><code>{row.actorId}</code></td>
                  <td>{row.rationale}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {status ? <div className="staff-note">{status}</div> : null}
      {error ? <div className={__bundleClass_2}>{error}</div> : null}
    </section>
  );
}
