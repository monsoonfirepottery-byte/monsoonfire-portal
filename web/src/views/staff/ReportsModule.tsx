import { useEffect, useMemo, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";

type ReportStatus = "open" | "triaged" | "actioned" | "resolved" | "dismissed";
type ReportSeverity = "low" | "medium" | "high";
type ReportCategory =
  | "broken_link"
  | "incorrect_info"
  | "spam"
  | "safety"
  | "harassment_hate"
  | "copyright"
  | "other";
type ReportTargetType = "youtube_video" | "blog_post" | "studio_update" | "event";
type ContentActionType = "unpublish" | "replace_link" | "flag_for_review" | "disable_from_feed";
type PolicyRule = {
  id: string;
  title: string;
  description: string;
};
type ActivePolicy = {
  version: string;
  title: string;
  rules: PolicyRule[];
};

type ReportRow = {
  id: string;
  status: ReportStatus;
  category: ReportCategory;
  severity: ReportSeverity;
  targetType: ReportTargetType;
  note: string;
  reporterUid: string;
  assigneeUid: string;
  createdAtMs: number;
  updatedAtMs: number;
  resolvedAtMs: number;
  lastPolicyVersion: string;
  lastRuleId: string;
  lastReasonCode: string;
  resolutionCode: string;
  coordinationSignal: boolean;
  coordinationReportCount: number;
  coordinationUniqueReporterCount: number;
  targetRef: { id?: string; url?: string; videoId?: string; slug?: string };
  targetSnapshot: { title?: string; url?: string; source?: string; author?: string };
};

type InternalNote = {
  id: string;
  note: string;
  authorUid: string;
  createdAtMs: number;
};

type AppealStatus = "open" | "in_review" | "upheld" | "reversed" | "rejected";
type AppealRow = {
  id: string;
  reportId: string;
  reporterUid: string;
  status: AppealStatus;
  note: string;
  decisionReasonCode: string;
  decisionNote: string;
  createdAtMs: number;
  updatedAtMs: number;
  reviewedByUid: string;
  reviewedAtMs: number;
};

type Props = {
  client: FunctionsClient;
  active: boolean;
  disabled: boolean;
};

type ListReportsResponse = { ok: boolean; reports?: Array<Record<string, unknown>> };
type ListReportAppealsResponse = { ok: boolean; appeals?: Array<Record<string, unknown>> };
type CurrentPolicyResponse = { ok: boolean; policy?: Record<string, unknown> | null };
type BasicResponse = { ok: boolean; message?: string };

const DEFAULT_REASON_TEMPLATES = [
  "policy_violation_confirmed",
  "insufficient_context",
  "false_positive",
  "duplicate_report",
  "resolved_via_update",
];

const RULE_TEMPLATE_MATCHERS: Array<{ matcher: RegExp; reasons: string[] }> = [
  {
    matcher: /(safety|threat|self[-_]?harm|danger)/i,
    reasons: ["safety_escalated", "credible_risk", "needs_immediate_review"],
  },
  {
    matcher: /(harass|hate|abuse|discrimination)/i,
    reasons: ["harassment_confirmed", "hate_content_confirmed", "harassment_unsubstantiated"],
  },
  {
    matcher: /(copyright|ip|dmca|license)/i,
    reasons: ["copyright_claim_received", "copyright_violation_confirmed", "copyright_claim_rejected"],
  },
  {
    matcher: /(spam|scam|promo)/i,
    reasons: ["spam_confirmed", "coordinated_spam", "no_spam_detected"],
  },
  {
    matcher: /(broken|link|url)/i,
    reasons: ["broken_link_confirmed", "link_replaced", "link_valid_on_check"],
  },
  {
    matcher: /(incorrect|misinfo|accuracy|info)/i,
    reasons: ["incorrect_info_confirmed", "editorial_correction_requested", "information_verified"],
  },
];

const RESOLUTION_TEMPLATES = [
  "action_complete",
  "resolved_without_action",
  "dismissed_non_violation",
  "dismissed_duplicate",
  "moved_to_manual_review",
];

const APPEAL_REASON_TEMPLATES = [
  "new_evidence_received",
  "insufficient_initial_review",
  "policy_misapplied",
  "decision_upheld",
  "no_new_evidence",
];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown): boolean {
  return v === true;
}

function toMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const maybe = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") {
      return Math.floor(maybe.seconds * 1000 + (typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0) / 1_000_000);
    }
  }
  return 0;
}

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function reasonTemplatesForRule(ruleId: string): string[] {
  const templates = [...DEFAULT_REASON_TEMPLATES];
  for (const entry of RULE_TEMPLATE_MATCHERS) {
    if (entry.matcher.test(ruleId)) {
      templates.push(...entry.reasons);
    }
  }
  return Array.from(new Set(templates));
}

function normalizeReport(row: Record<string, unknown>): ReportRow {
  const targetRef = (row.targetRef ?? {}) as Record<string, unknown>;
  const targetSnapshot = (row.targetSnapshot ?? {}) as Record<string, unknown>;
  return {
    id: str(row.id),
    status: (str(row.status, "open") as ReportStatus),
    category: (str(row.category, "other") as ReportCategory),
    severity: (str(row.severity, "low") as ReportSeverity),
    targetType: (str(row.targetType, "blog_post") as ReportTargetType),
    note: str(row.note),
    reporterUid: str(row.reporterUid),
    assigneeUid: str(row.assigneeUid),
    createdAtMs: toMs(row.createdAt),
    updatedAtMs: toMs(row.updatedAt),
    resolvedAtMs: toMs(row.resolvedAt),
    lastPolicyVersion: str(row.lastPolicyVersion),
    lastRuleId: str(row.lastRuleId),
    lastReasonCode: str(row.lastReasonCode),
    resolutionCode: str(row.resolutionCode),
    coordinationSignal: bool(row.coordinationSignal),
    coordinationReportCount: Number(row.coordinationReportCount ?? 0) || 0,
    coordinationUniqueReporterCount: Number(row.coordinationUniqueReporterCount ?? 0) || 0,
    targetRef: {
      id: str(targetRef.id),
      url: str(targetRef.url),
      videoId: str(targetRef.videoId),
      slug: str(targetRef.slug),
    },
    targetSnapshot: {
      title: str(targetSnapshot.title),
      url: str(targetSnapshot.url),
      source: str(targetSnapshot.source),
      author: str(targetSnapshot.author),
    },
  };
}

function normalizeAppeal(row: Record<string, unknown>): AppealRow {
  return {
    id: str(row.id),
    reportId: str(row.reportId),
    reporterUid: str(row.reporterUid),
    status: (str(row.status, "open") as AppealStatus),
    note: str(row.note),
    decisionReasonCode: str(row.decisionReasonCode),
    decisionNote: str(row.decisionNote),
    createdAtMs: toMs(row.createdAt),
    updatedAtMs: toMs(row.updatedAt),
    reviewedByUid: str(row.reviewedByUid),
    reviewedAtMs: toMs(row.reviewedAt),
  };
}

export default function ReportsModule({ client, active, disabled }: Props) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [activePolicy, setActivePolicy] = useState<ActivePolicy | null>(null);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | ReportStatus>("open");
  const [filterSeverity, setFilterSeverity] = useState<"all" | ReportSeverity>("all");
  const [filterCategory, setFilterCategory] = useState<"all" | ReportCategory>("all");
  const [filterType, setFilterType] = useState<"all" | ReportTargetType>("all");
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>([]);
  const [newInternalNote, setNewInternalNote] = useState("");
  const [nextStatus, setNextStatus] = useState<ReportStatus>("triaged");
  const [resolutionCode, setResolutionCode] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [contentActionType, setContentActionType] = useState<ContentActionType>("flag_for_review");
  const [actionReason, setActionReason] = useState("");
  const [replacementUrl, setReplacementUrl] = useState("");
  const [nextAppealStatus, setNextAppealStatus] = useState<AppealStatus>("in_review");
  const [appealDecisionReasonCode, setAppealDecisionReasonCode] = useState("");
  const [appealDecisionNote, setAppealDecisionNote] = useState("");

  const selected = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId]
  );
  const selectedAppeals = useMemo(
    () => appeals.filter((appeal) => appeal.reportId === selectedReportId),
    [appeals, selectedReportId]
  );
  const selectedActiveAppeal = useMemo(
    () =>
      selectedAppeals.find(
        (appeal) => appeal.status === "open" || appeal.status === "in_review"
      ) ?? selectedAppeals[0] ?? null,
    [selectedAppeals]
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy || disabled) return;
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

  const loadReports = async () => {
    const resp = await client.postJson<ListReportsResponse>("listReports", {
      status: filterStatus,
      severity: filterSeverity,
      category: filterCategory,
      targetType: filterType,
      limit: 120,
    });
    const rows = Array.isArray(resp.reports)
      ? resp.reports.map((row) => normalizeReport(row))
      : [];
    setReports(rows);
    if (!selectedReportId && rows.length > 0) setSelectedReportId(rows[0].id);
    if (selectedReportId && !rows.some((row) => row.id === selectedReportId)) {
      setSelectedReportId(rows[0]?.id ?? "");
    }
  };

  const loadAppeals = async () => {
    const resp = await client.postJson<ListReportAppealsResponse>("listReportAppeals", {
      status: "all",
      limit: 120,
    });
    const rows = Array.isArray(resp.appeals) ? resp.appeals.map((row) => normalizeAppeal(row)) : [];
    setAppeals(rows);
  };

  const loadActivePolicy = async () => {
    const resp = await client.postJson<CurrentPolicyResponse>("getModerationPolicyCurrent", {});
    const row = resp.policy as Record<string, unknown> | null | undefined;
    if (!row) {
      setActivePolicy(null);
      setSelectedRuleId("");
      return;
    }
    const rulesRaw = Array.isArray(row.rules) ? row.rules : [];
    const rules: PolicyRule[] = rulesRaw
      .map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: str(item.id).trim(),
          title: str(item.title).trim(),
          description: str(item.description).trim(),
        };
      })
      .filter((rule) => rule.id.length > 0);

    const nextPolicy: ActivePolicy = {
      version: str(row.version || row.id),
      title: str(row.title),
      rules,
    };
    setActivePolicy(nextPolicy);
    if (!selectedRuleId && rules.length > 0) {
      setSelectedRuleId(rules[0].id);
    }
  };

  const loadInternalNotes = async (reportId: string) => {
    if (!reportId) {
      setInternalNotes([]);
      return;
    }
    const snap = await getDocs(
      query(
        collection(db, "communityReports", reportId, "internalNotes"),
        orderBy("createdAt", "desc"),
        limit(20)
      )
    );
    const rows: InternalNote[] = snap.docs.map((docSnap) => {
      const row = docSnap.data() as Record<string, unknown>;
      return {
        id: docSnap.id,
        note: str(row.note),
        authorUid: str(row.authorUid),
        createdAtMs: toMs(row.createdAt),
      };
    });
    setInternalNotes(rows);
  };

  useEffect(() => {
    if (!active || disabled) return;
    void run("loadReports", async () => {
      await Promise.all([loadReports(), loadAppeals(), loadActivePolicy()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled, filterStatus, filterSeverity, filterCategory, filterType]);

  useEffect(() => {
    if (!active || disabled) return;
    void run("loadNotes", async () => {
      await loadInternalNotes(selectedReportId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled, selectedReportId]);

  useEffect(() => {
    if (!selected) return;
    setNextStatus(selected.status === "open" ? "triaged" : selected.status);
    setContentActionType(selected.targetType === "youtube_video" ? "disable_from_feed" : "unpublish");
  }, [selected]);

  useEffect(() => {
    if (!selectedActiveAppeal) {
      setNextAppealStatus("in_review");
      setAppealDecisionReasonCode("");
      setAppealDecisionNote("");
      return;
    }
    setNextAppealStatus(selectedActiveAppeal.status);
    setAppealDecisionReasonCode(selectedActiveAppeal.decisionReasonCode || "");
    setAppealDecisionNote(selectedActiveAppeal.decisionNote || "");
  }, [selectedActiveAppeal]);

  useEffect(() => {
    if (!activePolicy || !activePolicy.rules.length) return;
    if (!selectedRuleId || !activePolicy.rules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(activePolicy.rules[0].id);
    }
  }, [activePolicy, selectedRuleId]);

  const statusCounts = useMemo(() => {
    return {
      total: reports.length,
      open: reports.filter((report) => report.status === "open").length,
      triaged: reports.filter((report) => report.status === "triaged").length,
      actioned: reports.filter((report) => report.status === "actioned").length,
      resolved: reports.filter((report) => report.status === "resolved").length,
    };
  }, [reports]);

  const selectedRule = useMemo(
    () => (activePolicy?.rules ?? []).find((rule) => rule.id === selectedRuleId) ?? null,
    [activePolicy, selectedRuleId]
  );

  const reasonTemplates = useMemo(() => reasonTemplatesForRule(selectedRuleId), [selectedRuleId]);

  const consistency = useMemo(() => {
    const reviewed = reports.filter((report) =>
      report.status === "triaged" ||
      report.status === "actioned" ||
      report.status === "resolved" ||
      report.status === "dismissed"
    );
    const policyLinked = reviewed.filter(
      (report) => report.lastPolicyVersion.trim() && report.lastRuleId.trim() && report.lastReasonCode.trim()
    );
    const coveragePct = reviewed.length ? Math.round((policyLinked.length / reviewed.length) * 100) : 0;
    const reasonCounts = new Map<string, number>();
    for (const report of policyLinked) {
      const key = report.lastReasonCode.trim();
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
    let topReason = "-";
    let topReasonCount = 0;
    for (const [reason, count] of reasonCounts.entries()) {
      if (count > topReasonCount) {
        topReason = reason;
        topReasonCount = count;
      }
    }

    const resolutionDurationsHours = reports
      .filter((report) => (report.status === "resolved" || report.status === "dismissed") && report.resolvedAtMs > 0 && report.createdAtMs > 0)
      .map((report) => (report.resolvedAtMs - report.createdAtMs) / 3_600_000)
      .filter((hours) => Number.isFinite(hours) && hours >= 0);
    const medianResolutionHours = median(resolutionDurationsHours);

    const now = Date.now();
    const openOver48h = reports.filter((report) =>
      report.status === "open" &&
      report.createdAtMs > 0 &&
      now - report.createdAtMs > 48 * 60 * 60 * 1000
    ).length;
    const highSeverityOver24h = reports.filter((report) =>
      report.status === "open" &&
      report.severity === "high" &&
      report.createdAtMs > 0 &&
      now - report.createdAtMs > 24 * 60 * 60 * 1000
    ).length;

    return {
      reviewedCount: reviewed.length,
      policyLinkedCount: policyLinked.length,
      coveragePct,
      topReason,
      topReasonCount,
      uniqueReasonCount: reasonCounts.size,
      medianResolutionHours,
      openOver48h,
      highSeverityOver24h,
    };
  }, [reports]);

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Reports</div>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled}
          onClick={() => void run("refreshReports", loadReports)}
        >
          Refresh reports
        </button>
      </div>

      {disabled ? (
        <div className="staff-note">
          Reports module requires function auth. Enable auth emulator (`VITE_USE_AUTH_EMULATOR=true`) or point Functions to production.
        </div>
      ) : null}
      {!disabled && !activePolicy ? (
        <div className="staff-note staff-note-error">
          No active Code of Conduct policy is published. Open Governance module, publish a policy version, then return to reports triage.
        </div>
      ) : null}
      {activePolicy ? (
        <div className="staff-note">
          Active policy: <strong>{activePolicy.version}</strong> {activePolicy.title ? `· ${activePolicy.title}` : ""}
        </div>
      ) : null}

      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Total</span><strong>{statusCounts.total}</strong></div>
        <div className="staff-kpi"><span>Open</span><strong>{statusCounts.open}</strong></div>
        <div className="staff-kpi"><span>Triaged</span><strong>{statusCounts.triaged}</strong></div>
        <div className="staff-kpi"><span>Actioned</span><strong>{statusCounts.actioned}</strong></div>
        <div className="staff-kpi"><span>Resolved</span><strong>{statusCounts.resolved}</strong></div>
      </div>

      <div className="staff-note">
        Decision consistency: {consistency.coveragePct}% of reviewed reports include policy + rule + reason linkage.
      </div>

      <div className="staff-kpi-grid">
        <div className="staff-kpi">
          <span>Policy-linked reviews</span>
          <strong>{consistency.policyLinkedCount}/{consistency.reviewedCount}</strong>
        </div>
        <div className="staff-kpi">
          <span>Top reason code</span>
          <strong>{consistency.topReason}</strong>
          <small className="staff-kpi-subtle">{consistency.topReasonCount} uses</small>
        </div>
        <div className="staff-kpi">
          <span>Unique reason codes</span>
          <strong>{consistency.uniqueReasonCount}</strong>
        </div>
        <div className="staff-kpi">
          <span>Median resolution</span>
          <strong>{consistency.medianResolutionHours ? `${consistency.medianResolutionHours.toFixed(1)}h` : "-"}</strong>
        </div>
        <div className="staff-kpi">
          <span>Open over 48h</span>
          <strong>{consistency.openOver48h}</strong>
        </div>
        <div className="staff-kpi">
          <span>High severity over 24h</span>
          <strong>{consistency.highSeverityOver24h}</strong>
        </div>
      </div>

      <div className="staff-actions-row">
        <select className="staff-member-role-filter" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as "all" | ReportStatus)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="triaged">Triaged</option>
          <option value="actioned">Actioned</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select className="staff-member-role-filter" value={filterSeverity} onChange={(event) => setFilterSeverity(event.target.value as "all" | ReportSeverity)}>
          <option value="all">All severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select className="staff-member-role-filter" value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as "all" | ReportCategory)}>
          <option value="all">All categories</option>
          <option value="broken_link">Broken link</option>
          <option value="incorrect_info">Incorrect info</option>
          <option value="spam">Spam</option>
          <option value="safety">Safety</option>
          <option value="harassment_hate">Harassment / hate</option>
          <option value="copyright">Copyright</option>
          <option value="other">Other</option>
        </select>
        <select className="staff-member-role-filter" value={filterType} onChange={(event) => setFilterType(event.target.value as "all" | ReportTargetType)}>
          <option value="all">All target types</option>
          <option value="youtube_video">YouTube video</option>
          <option value="blog_post">Blog post</option>
          <option value="studio_update">Studio update</option>
          <option value="event">Event</option>
        </select>
      </div>

      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr><th>Target</th><th>Status</th><th>Severity</th><th>Category</th><th>Created</th></tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr><td colSpan={5}>No reports found with current filters.</td></tr>
                ) : (
                  reports.map((report) => (
                    <tr
                      key={report.id}
                      className={`staff-click-row ${selectedReportId === report.id ? "active" : ""}`}
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <td>
                        <div>{report.targetSnapshot.title || report.targetRef.id || report.id}</div>
                        <div className="staff-mini"><code>{report.id}</code> · {report.targetType}</div>
                      </td>
                      <td><span className="pill">{report.status}</span></td>
                      <td>{report.severity}</td>
                      <td>{report.category}</td>
                      <td>{when(report.createdAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="staff-column">
          <div className="staff-subtitle">Report details</div>
          {selected ? (
            <>
              <div className="staff-note">
                <strong>{selected.targetSnapshot.title || selected.targetRef.id || selected.id}</strong><br />
                <span>{selected.targetType} · status {selected.status}</span><br />
                <span>Reporter: <code>{selected.reporterUid}</code></span><br />
                {selected.assigneeUid ? (
                  <>
                    <span>Assigned: <code>{selected.assigneeUid}</code></span><br />
                  </>
                ) : null}
                <span>Created: {when(selected.createdAtMs)} · Updated: {when(selected.updatedAtMs)}</span><br />
                {selected.lastReasonCode ? (
                  <>
                    <span>Last reason: <code>{selected.lastReasonCode}</code></span><br />
                  </>
                ) : null}
                {selected.coordinationSignal ? (
                  <>
                    <span>
                      Coordination signal detected: {selected.coordinationUniqueReporterCount} unique reporters / {selected.coordinationReportCount} reports in the active window.
                    </span>
                    <br />
                  </>
                ) : null}
                {selected.targetSnapshot.url ? (
                  <a href={selected.targetSnapshot.url} target="_blank" rel="noreferrer">Open target</a>
                ) : null}
              </div>

              {selectedRule ? (
                <div className="staff-note">
                  Policy guidance: <strong>{selectedRule.id}</strong> · {selectedRule.title}
                  {selectedRule.description ? <><br />{selectedRule.description}</> : null}
                </div>
              ) : null}

              <label className="staff-field">
                Set status
                <div className="staff-actions-row">
                  <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value as ReportStatus)}>
                    <option value="open">Open</option>
                    <option value="triaged">Triaged</option>
                    <option value="actioned">Actioned</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                  <input
                    placeholder="Resolution code (optional)"
                    value={resolutionCode}
                    onChange={(event) => setResolutionCode(event.target.value)}
                  />
                  <select value={selectedRuleId} onChange={(event) => setSelectedRuleId(event.target.value)}>
                    {(activePolicy?.rules ?? []).map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.id} · {rule.title}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Reason code (required)"
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={Boolean(busy) || disabled || !activePolicy?.version || !selectedRuleId.trim() || !reasonCode.trim()}
                    onClick={() =>
                      void run("updateReportStatus", async () => {
                        const policyVersion = activePolicy?.version ?? "";
                        await client.postJson<BasicResponse>("updateReportStatus", {
                          reportId: selected.id,
                          status: nextStatus,
                          policyVersion,
                          ruleId: selectedRuleId.trim(),
                          reasonCode: reasonCode.trim(),
                          resolutionCode: resolutionCode.trim() || null,
                        });
                        await loadReports();
                        setStatus("Report status updated.");
                      })
                    }
                  >
                    Save status
                  </button>
                </div>
                <div className="staff-template-list">
                  {reasonTemplates.map((template) => (
                    <button
                      key={`status-reason-${template}`}
                      type="button"
                      className={`staff-template-chip ${reasonCode === template ? "active" : ""}`}
                      onClick={() => setReasonCode(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
                {(nextStatus === "resolved" || nextStatus === "dismissed") ? (
                  <div className="staff-template-list">
                    {RESOLUTION_TEMPLATES.map((template) => (
                      <button
                        key={`resolution-${template}`}
                        type="button"
                        className={`staff-template-chip ${resolutionCode === template ? "active" : ""}`}
                        onClick={() => setResolutionCode(template)}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>

              <label className="staff-field">
                Internal note
                <textarea
                  value={newInternalNote}
                  maxLength={2400}
                  onChange={(event) => setNewInternalNote(event.target.value)}
                  placeholder="Internal triage note"
                />
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy) || disabled || !newInternalNote.trim()}
                  onClick={() =>
                    void run("addInternalNote", async () => {
                      await client.postJson<BasicResponse>("addInternalNote", {
                        reportId: selected.id,
                        note: newInternalNote.trim(),
                      });
                      setNewInternalNote("");
                      await loadInternalNotes(selected.id);
                      setStatus("Internal note added.");
                    })
                  }
                >
                  Add internal note
                </button>
              </label>

              <label className="staff-field">
                Content action
                <div className="staff-actions-row">
                  <select value={contentActionType} onChange={(event) => setContentActionType(event.target.value as ContentActionType)}>
                    {selected.targetType === "youtube_video" ? (
                      <>
                        <option value="disable_from_feed">Disable from feed</option>
                        <option value="replace_link">Replace link</option>
                        <option value="flag_for_review">Flag for review</option>
                      </>
                    ) : (
                      <>
                        <option value="unpublish">Unpublish</option>
                        <option value="replace_link">Replace link</option>
                        <option value="flag_for_review">Flag for review</option>
                      </>
                    )}
                  </select>
                  <input
                    placeholder="Action reason (optional)"
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                  />
                  <input
                    placeholder="Replacement URL (optional)"
                    value={replacementUrl}
                    onChange={(event) => setReplacementUrl(event.target.value)}
                  />
                  <select value={selectedRuleId} onChange={(event) => setSelectedRuleId(event.target.value)}>
                    {(activePolicy?.rules ?? []).map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.id} · {rule.title}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Reason code (required)"
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value)}
                  />
                  <button
                    className="btn btn-secondary"
                    disabled={Boolean(busy) || disabled || !activePolicy?.version || !selectedRuleId.trim() || !reasonCode.trim()}
                    onClick={() =>
                      void run("takeContentAction", async () => {
                        const policyVersion = activePolicy?.version ?? "";
                        await client.postJson<BasicResponse>("takeContentAction", {
                          reportId: selected.id,
                          policyVersion,
                          ruleId: selectedRuleId.trim(),
                          reasonCode: reasonCode.trim(),
                          actionType: contentActionType,
                          reason: actionReason.trim() || null,
                          replacementUrl: replacementUrl.trim() || null,
                        });
                        await loadReports();
                        setStatus("Content action recorded.");
                      })
                    }
                  >
                    Apply action
                  </button>
                </div>
                <div className="staff-template-list">
                  {reasonTemplates.map((template) => (
                    <button
                      key={`action-reason-${template}`}
                      type="button"
                      className={`staff-template-chip ${reasonCode === template ? "active" : ""}`}
                      onClick={() => setReasonCode(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
              </label>

              <div className="staff-subtitle">Internal notes</div>
              <div className="staff-log-list">
                {internalNotes.length === 0 ? (
                  <div className="staff-note">No internal notes yet.</div>
                ) : (
                  internalNotes.map((note) => (
                    <div key={note.id} className="staff-log-entry">
                      <div className="staff-log-meta">
                        <span className="staff-log-label">{note.authorUid || "staff"}</span>
                        <span>{when(note.createdAtMs)}</span>
                      </div>
                      <div className="staff-log-message">{note.note}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="staff-subtitle">Appeals</div>
              {selectedAppeals.length === 0 ? (
                <div className="staff-note">No appeals for this report.</div>
              ) : (
                <div className="staff-log-list">
                  {selectedAppeals.map((appeal) => (
                    <div key={appeal.id} className="staff-log-entry">
                      <div className="staff-log-meta">
                        <span className="staff-log-label">{appeal.status}</span>
                        <span>{when(appeal.createdAtMs)}</span>
                      </div>
                      <div className="staff-log-message">
                        <strong>Appeal note:</strong> {appeal.note || "-"}<br />
                        <strong>Reporter:</strong> <code>{appeal.reporterUid || "-"}</code><br />
                        <strong>Decision reason:</strong> {appeal.decisionReasonCode || "-"}<br />
                        <strong>Decision note:</strong> {appeal.decisionNote || "-"}<br />
                        <strong>Reviewed by:</strong> <code>{appeal.reviewedByUid || "-"}</code> · {when(appeal.reviewedAtMs)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedActiveAppeal ? (
                <label className="staff-field">
                  Review active appeal
                  <div className="staff-actions-row">
                    <select value={nextAppealStatus} onChange={(event) => setNextAppealStatus(event.target.value as AppealStatus)}>
                      <option value="open">Open</option>
                      <option value="in_review">In review</option>
                      <option value="upheld">Upheld</option>
                      <option value="reversed">Reversed</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <input
                      placeholder="Decision reason code"
                      value={appealDecisionReasonCode}
                      onChange={(event) => setAppealDecisionReasonCode(event.target.value)}
                    />
                    <input
                      placeholder="Decision note (optional)"
                      value={appealDecisionNote}
                      onChange={(event) => setAppealDecisionNote(event.target.value)}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={Boolean(busy) || disabled || !selectedActiveAppeal.id}
                      onClick={() =>
                        void run("updateReportAppeal", async () => {
                          await client.postJson<BasicResponse>("updateReportAppeal", {
                            appealId: selectedActiveAppeal.id,
                            status: nextAppealStatus,
                            decisionReasonCode: appealDecisionReasonCode.trim() || null,
                            decisionNote: appealDecisionNote.trim() || null,
                          });
                          await Promise.all([loadReports(), loadAppeals()]);
                          setStatus("Appeal updated.");
                        })
                      }
                    >
                      Save appeal decision
                    </button>
                  </div>
                  <div className="staff-template-list">
                    {APPEAL_REASON_TEMPLATES.map((template) => (
                      <button
                        key={`appeal-reason-${template}`}
                        type="button"
                        className={`staff-template-chip ${appealDecisionReasonCode === template ? "active" : ""}`}
                        onClick={() => setAppealDecisionReasonCode(template)}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </label>
              ) : null}
            </>
          ) : (
            <div className="staff-note">Select a report to inspect details and apply actions.</div>
          )}
        </div>
      </div>

      {status ? <div className="staff-note">{status}</div> : null}
      {error ? <div className="staff-note staff-note-error">{error}</div> : null}
    </section>
  );
}
