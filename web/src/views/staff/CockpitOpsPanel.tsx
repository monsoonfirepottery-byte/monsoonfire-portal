import { type ReactNode } from "react";
import { safeJsonStringify, type LastRequest } from "../../api/functionsClient";
import type { ShiftStatusSummary } from "./shiftStatus";

const COCKPIT_TABS = [
  { key: "triage", label: "Action queue" },
  { key: "automation", label: "Automation" },
  { key: "platform", label: "Platform" },
  { key: "finance", label: "Commerce" },
  { key: "operations", label: "Operations" },
  { key: "policyAgentOps", label: "Policy & Agent Ops" },
  { key: "reports", label: "Reports" },
  { key: "moduleTelemetry", label: "Telemetry" },
] as const;

type CockpitTabKey = (typeof COCKPIT_TABS)[number]["key"];

type CockpitOverviewAlert = {
  id: string;
  createdAtMs: number;
  severity: "high" | "medium" | "low";
  label: string;
  actionLabel: string;
  module: string;
};

type CockpitKpis = {
  highAlerts: number;
  mediumAlerts: number;
  openReports: number;
  failedChecks: number;
  totalChecks: number;
  recentErrors: number;
  authMismatch: boolean;
};

type CockpitAutomationKpis = {
  monitored: number;
  healthy: number;
  failing: number;
  inProgress: number;
  stale: number;
  threads: number;
  loadedAtMs: number;
};

type CockpitAutomationWorkflow = {
  key: string;
  label: string;
  workflowFile: string;
  outputHint: string;
  runUrl: string;
  status: string;
  conclusion: string;
  createdAtMs: number;
  isStale: boolean;
};

type CockpitAutomationIssue = {
  key: string;
  title: string;
  issueNumber: number;
  issueUrl: string;
  purpose: string;
  state: string;
  updatedAtMs: number;
  latestCommentPreview: string;
  latestCommentUrl: string;
  error: string;
};

type CockpitAutomationDashboard = {
  loading: boolean;
  error: string;
  loadedAtMs: number;
  workflows: CockpitAutomationWorkflow[];
  issues: CockpitAutomationIssue[];
};

type SystemCheckRecord = {
  key: string;
  label: string;
  ok: boolean;
  atMs: number;
  details: string;
};

type QueryTrace = { atIso: string; collection: string; params: Record<string, unknown> };
type WriteTrace = { atIso: string; collection: string; docId: string; payload: Record<string, unknown> };

type ModuleUsageRow = {
  key: string;
  label: string;
  owner: string;
  visits: number;
  dwellMs: number;
  firstActionMs: number | null;
};

type ErrorRecord = { atIso: string; label: string; message: string };

type NotificationSummary = {
  totalSent?: number;
  totalFailed?: number;
  successRate?: number;
};

type Props = {
  busy: string;
  cockpitTab: CockpitTabKey;
  setCockpitTab: (next: CockpitTabKey) => void;
  overviewAlerts: CockpitOverviewAlert[];
  shiftStatus: ShiftStatusSummary;
  cockpitKpis: CockpitKpis;
  automationKpis: CockpitAutomationKpis;
  automationDashboard: CockpitAutomationDashboard;
  hasFunctionsAuthMismatch: boolean;
  onRefreshCockpit: () => void;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  openModuleFromCockpit: (module: string) => void;
  openMessagesInbox: () => void;
  loadReportOps: () => Promise<void>;
  loadSystemStats: () => Promise<void>;
  loadAutomationHealthDashboard: () => Promise<void>;
  usingLocalFunctions: boolean;
  showEmulatorTools: boolean;
  integrationTokenCount: number | null;
  notificationMetricsSummary: NotificationSummary | null;
  runSystemPing: () => Promise<void>;
  runCalendarProbe: () => Promise<void>;
  runNotificationMetricsProbe: () => Promise<void>;
  runNotificationFailureDrillNow: () => Promise<void>;
  fBaseUrl: string;
  devAdminEnabled: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  onOpenEmulatorUi: () => void;
  onRefreshHandlerLog: () => void;
  onClearHandlerLog: () => void;
  latestErrors: ErrorRecord[];
  systemChecks: SystemCheckRecord[];
  lastWrite: WriteTrace | null;
  lastQuery: QueryTrace | null;
  lastReq: LastRequest | null;
  lastErr: { atIso: string; message: string; stack: string | null } | null;
  copy: (value: string) => Promise<void>;
  copyStatus: string;
  reservationNotificationPolicyContent: ReactNode;
  resetModuleTelemetry: () => void;
  moduleUsageRows: ModuleUsageRow[];
  lowEngagementModules: string[];
  operationsContent: ReactNode;
  moduleTelemetrySnapshot: unknown;
  commerceContent: ReactNode;
  stripeContent: ReactNode;
  agentOpsContent: ReactNode;
  governanceContent: ReactNode;
  reportsContent: ReactNode;
  githubRepoSlug: string;
};

function sanitizeLastRequest(request: LastRequest | null) {
  if (!request) return null;
  return {
    ...request,
    payload: (request as { payloadRedacted?: unknown }).payloadRedacted ?? request.payload,
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatDurationMs(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatLatencyMs(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function whenDate(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleDateString();
}

export default function CockpitOpsPanel({
  busy,
  cockpitTab,
  setCockpitTab,
  overviewAlerts,
  shiftStatus,
  cockpitKpis,
  automationKpis,
  automationDashboard,
  hasFunctionsAuthMismatch,
  onRefreshCockpit,
  run,
  openModuleFromCockpit,
  openMessagesInbox,
  loadReportOps,
  loadSystemStats,
  loadAutomationHealthDashboard,
  usingLocalFunctions,
  showEmulatorTools,
  integrationTokenCount,
  notificationMetricsSummary,
  runSystemPing,
  runCalendarProbe,
  runNotificationMetricsProbe,
  runNotificationFailureDrillNow,
  fBaseUrl,
  devAdminEnabled,
  devAdminToken,
  onDevAdminTokenChange,
  onOpenEmulatorUi,
  onRefreshHandlerLog,
  onClearHandlerLog,
  latestErrors,
  systemChecks,
  lastWrite,
  lastQuery,
  lastReq,
  lastErr,
  copy,
  copyStatus,
  reservationNotificationPolicyContent,
  resetModuleTelemetry,
  moduleUsageRows,
  lowEngagementModules,
  operationsContent,
  moduleTelemetrySnapshot,
  commerceContent,
  stripeContent,
  agentOpsContent,
  governanceContent,
  reportsContent,
  githubRepoSlug,
}: Props) {
  const actionableOverviewAlerts = overviewAlerts.filter((alert) => alert.severity !== "low");
  const shiftStatusNoteClass =
    shiftStatus.tone === "action"
      ? "staff-note-error"
      : shiftStatus.tone === "watch"
        ? "staff-note-warn"
        : "staff-note-ok";

  const openShiftStatusTarget = (target: string) => {
    if (target === "messages") {
      void openMessagesInbox();
      return;
    }
    openModuleFromCockpit(target);
  };

  return (
    <section className="staff-module-grid">
      <section className="card staff-console-card">
        <div className="card-title-row">
          <div className="card-title">Ops Cockpit</div>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refreshCockpit", async () => {
                await Promise.allSettled([loadReportOps(), loadSystemStats(), loadAutomationHealthDashboard()]);
                onRefreshCockpit();
              })
            }
          >
            Refresh cockpit
          </button>
        </div>
        <div className="staff-kpi-grid">
          <div className="staff-kpi"><span>High alerts</span><strong>{cockpitKpis.highAlerts}</strong></div>
          <div className="staff-kpi"><span>Medium alerts</span><strong>{cockpitKpis.mediumAlerts}</strong></div>
          <div className="staff-kpi"><span>Open reports</span><strong>{cockpitKpis.openReports}</strong></div>
          <div className="staff-kpi"><span>Failed checks</span><strong>{cockpitKpis.failedChecks}</strong></div>
          <div className="staff-kpi"><span>Checks loaded</span><strong>{cockpitKpis.totalChecks}</strong></div>
          <div className="staff-kpi"><span>Recent handler errors</span><strong>{cockpitKpis.recentErrors}</strong></div>
        </div>
        {cockpitKpis.authMismatch ? (
          <div className="staff-note">
            Local Functions is active while Auth emulator is disabled. Cockpit data may be partial for function-backed operations.
          </div>
        ) : null}
        <nav className="segmented staff-cockpit-tabs" aria-label="Ops cockpit tabs">
          {COCKPIT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cockpitTab === tab.key ? "active" : ""}
              onClick={() => setCockpitTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {cockpitTab === "triage" ? (
          <>
            <section className="staff-shift-status-card" data-tone={shiftStatus.tone}>
              <div className="staff-shift-status-header">
                <div className="staff-column">
                  <div className="staff-subtitle">Shift status</div>
                  <div className="staff-shift-status-headline">{shiftStatus.headline}</div>
                </div>
                <span className={`pill staff-shift-status-pill staff-shift-status-pill-${shiftStatus.tone}`}>
                  {shiftStatus.label}
                </span>
              </div>
              <div className={`staff-note ${shiftStatusNoteClass}`}>
                {shiftStatus.tone === "clear"
                  ? "Start with the action queue only if a new issue appears during the shift."
                  : "Start with the first reason below, then work down the queue if more items remain."}
              </div>
              {shiftStatus.reasons.length > 0 ? (
                <div className="staff-shift-status-reasons">
                  {shiftStatus.reasons.map((reason) => (
                    <div key={reason.id} className="staff-shift-status-reason">
                      <div className="staff-shift-status-reason-top">
                        <span className={`pill ${reason.tone === "action" ? "staff-pill-danger" : "staff-pill-warn"}`}>
                          {reason.tone === "action" ? "Now" : "Watch"}
                        </span>
                        <div className="staff-shift-status-reason-label">{reason.label}</div>
                      </div>
                      <div className="staff-actions-row">
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={() => openShiftStatusTarget(reason.actionTarget)}
                        >
                          {reason.actionLabel}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
            <div className="staff-subtitle">Action queue</div>
            {actionableOverviewAlerts.length === 0 ? (
              <div className={`staff-note ${shiftStatus.reasons.length === 0 ? "staff-note-ok" : "staff-note-muted"}`}>
                {shiftStatus.reasons.length === 0
                  ? "No open triage actions right now."
                  : "No additional queue items beyond the shift-status reasons above."}
              </div>
            ) : (
              <div className="staff-log-list">
                {actionableOverviewAlerts.map((alert) => (
                  <div key={alert.id} className="staff-log-entry">
                    <div className="staff-log-meta">
                      <span className="staff-log-label">{alert.severity.toUpperCase()}</span>
                      <span>{whenDate(alert.createdAtMs)}</span>
                    </div>
                    <div className="staff-log-message">
                      {alert.label}
                      <div className="staff-actions-row staff-actions-row--mt8">
                        <button className="btn btn-ghost btn-small" onClick={() => openModuleFromCockpit(alert.module)}>
                          {alert.actionLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
        {cockpitTab === "automation" ? (
          <>
            <div className="staff-subtitle">Automation health dashboard</div>
            <div className="staff-kpi-grid">
              <div className="staff-kpi"><span>Monitored workflows</span><strong>{automationKpis.monitored}</strong></div>
              <div className="staff-kpi"><span>Healthy</span><strong>{automationKpis.healthy}</strong></div>
              <div className="staff-kpi"><span>Failing</span><strong>{automationKpis.failing}</strong></div>
              <div className="staff-kpi"><span>In progress</span><strong>{automationKpis.inProgress}</strong></div>
              <div className="staff-kpi"><span>Stale workflows</span><strong>{automationKpis.stale}</strong></div>
              <div className="staff-kpi"><span>Rolling threads</span><strong>{automationKpis.threads}</strong></div>
            </div>
            <div className="staff-actions-row">
              <button
                className="btn btn-secondary btn-small"
                disabled={Boolean(busy) || automationDashboard.loading}
                onClick={() => void run("refreshAutomationHealth", loadAutomationHealthDashboard)}
              >
                {automationDashboard.loading ? "Refreshing..." : "Refresh automation dashboard"}
              </button>
              <a
                className="btn btn-ghost btn-small"
                href={`https://github.com/${githubRepoSlug}/actions/workflows/portal-automation-health-daily.yml`}
                target="_blank"
                rel="noreferrer"
              >
                Open daily workflow
              </a>
              <a
                className="btn btn-ghost btn-small"
                href={`https://github.com/${githubRepoSlug}/actions/workflows/portal-automation-weekly-digest.yml`}
                target="_blank"
                rel="noreferrer"
              >
                Open weekly digest
              </a>
            </div>
            {automationDashboard.error ? (
              <div className="staff-note staff-note-error">
                Automation dashboard fetch error: {automationDashboard.error}
              </div>
            ) : null}
            <div className="staff-mini">
              Source: GitHub Actions + rolling issues for <code>{githubRepoSlug}</code>.
              {automationKpis.loadedAtMs ? ` Last refresh ${when(automationKpis.loadedAtMs)}.` : " Not loaded yet."}
            </div>
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Conclusion</th>
                    <th>Last run</th>
                    <th>Output</th>
                  </tr>
                </thead>
                <tbody>
                  {automationDashboard.workflows.length === 0 ? (
                    <tr><td colSpan={5}>No automation workflow status loaded yet.</td></tr>
                  ) : (
                    automationDashboard.workflows.map((workflow) => (
                      <tr key={workflow.key}>
                        <td>
                          <div>{workflow.label}</div>
                          <div className="staff-mini"><code>{workflow.workflowFile}</code></div>
                          <div className="staff-mini">{workflow.outputHint}</div>
                        </td>
                        <td><span className="pill">{workflow.status || "-"}</span></td>
                        <td>
                          <span className="pill">
                            {workflow.conclusion || (workflow.status === "queued" || workflow.status === "in_progress" ? "running" : "unknown")}
                          </span>
                        </td>
                        <td>
                          {workflow.createdAtMs ? when(workflow.createdAtMs) : "-"}
                          {workflow.isStale ? <div className="staff-mini">stale</div> : null}
                        </td>
                        <td>
                          {workflow.runUrl ? (
                            <a href={workflow.runUrl} target="_blank" rel="noreferrer">Run</a>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="staff-subtitle">Rolling output threads</div>
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Thread</th>
                    <th>State</th>
                    <th>Updated</th>
                    <th>Latest output preview</th>
                  </tr>
                </thead>
                <tbody>
                  {automationDashboard.issues.length === 0 ? (
                    <tr><td colSpan={4}>No rolling issue threads loaded yet.</td></tr>
                  ) : (
                    automationDashboard.issues.map((issue) => (
                      <tr key={issue.key}>
                        <td>
                          {issue.issueUrl ? (
                            <a href={issue.issueUrl} target="_blank" rel="noreferrer">{issue.title}</a>
                          ) : (
                            issue.title
                          )}
                          <div className="staff-mini">#{issue.issueNumber} · {issue.purpose}</div>
                          {issue.error ? <div className="staff-mini">{issue.error}</div> : null}
                        </td>
                        <td><span className="pill">{issue.state || "-"}</span></td>
                        <td>{issue.updatedAtMs ? when(issue.updatedAtMs) : "-"}</td>
                        <td>
                          {issue.latestCommentPreview || "-"}
                          {issue.latestCommentUrl ? (
                            <div className="staff-mini">
                              <a href={issue.latestCommentUrl} target="_blank" rel="noreferrer">Open latest comment</a>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {cockpitTab === "platform" ? (
          <>
            <div className="staff-subtitle">Platform diagnostics</div>
            <div className="staff-note">
              Technical probes and raw diagnostics live here. Use this tab when shift status flags tool degradation.
            </div>
            <div className="staff-kpi-grid">
              <div className="staff-kpi"><span>Functions base</span><strong>{usingLocalFunctions ? "Local" : "Remote"}</strong></div>
              <div className="staff-kpi"><span>Auth mode</span><strong>{showEmulatorTools ? "Emulator" : "Production"}</strong></div>
              <div className="staff-kpi"><span>Integration tokens</span><strong>{integrationTokenCount ?? 0}</strong></div>
              <div className="staff-kpi"><span>System checks</span><strong>{systemChecks.length}</strong></div>
              <div className="staff-kpi"><span>Notif success</span><strong>{notificationMetricsSummary ? `${num(notificationMetricsSummary.successRate, 0)}%` : "-"}</strong></div>
              <div className="staff-kpi"><span>Notif failed</span><strong>{notificationMetricsSummary ? num(notificationMetricsSummary.totalFailed, 0) : "-"}</strong></div>
            </div>
            <div className="staff-actions-row">
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || hasFunctionsAuthMismatch}
                onClick={() => void run("cockpitSystemPing", runSystemPing)}
              >
                Ping functions
              </button>
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || hasFunctionsAuthMismatch}
                onClick={() => void run("cockpitCalendarProbe", runCalendarProbe)}
              >
                Probe calendar
              </button>
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || hasFunctionsAuthMismatch}
                onClick={() => void run("cockpitNotificationMetricsProbe", runNotificationMetricsProbe)}
              >
                Refresh notif metrics
              </button>
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || hasFunctionsAuthMismatch}
                onClick={() => void run("cockpitNotificationDrill", runNotificationFailureDrillNow)}
              >
                Run push failure drill
              </button>
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || hasFunctionsAuthMismatch}
                onClick={() => void run("cockpitRefreshSystemStats", loadSystemStats)}
              >
                Refresh token stats
              </button>
            </div>
            {hasFunctionsAuthMismatch ? (
              <div className="staff-note">
                Local functions detected at <code>{fBaseUrl}</code> while auth emulator is disabled.
                Function-backed modules are paused to avoid false 401 errors.
              </div>
            ) : null}
            {reservationNotificationPolicyContent}
            <div className="card-title-row">
              <div className="staff-subtitle">Recent handler errors</div>
              <div className="staff-log-actions">
                <button type="button" className="btn btn-ghost" onClick={onRefreshHandlerLog}>Refresh</button>
                <button type="button" className="btn btn-ghost" onClick={onClearHandlerLog}>Clear</button>
              </div>
            </div>
            <div className="staff-log-list">
              {latestErrors.length === 0 ? <div className="staff-note">No handler errors logged.</div> : latestErrors.map((entry, idx) => <div key={`${entry.atIso}-${idx}`} className="staff-log-entry"><div className="staff-log-meta"><span className="staff-log-label">{entry.label}</span><span>{new Date(entry.atIso).toLocaleString()}</span></div><div className="staff-log-message">{entry.message}</div></div>)}
            </div>
            <details className="staff-troubleshooting">
              <summary>Developer troubleshooting and raw diagnostics</summary>
              <div className="staff-module-grid">
                <div className="staff-column">
                  <div className="staff-subtitle">System checks</div>
                  <div className="staff-table-wrap">
                    <table className="staff-table">
                      <thead><tr><th>Check</th><th>Status</th><th>Ran at</th><th>Details</th></tr></thead>
                      <tbody>
                        {systemChecks.length === 0 ? (
                          <tr><td colSpan={4}>No checks run yet.</td></tr>
                        ) : (
                          systemChecks.map((entry) => (
                            <tr key={`${entry.key}-${entry.atMs}`}>
                              <td>{entry.label}</td>
                              <td><span className="pill">{entry.ok ? "ok" : "failed"}</span></td>
                              <td>{when(entry.atMs)}</td>
                              <td>{entry.details}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="staff-column">
                  {devAdminEnabled ? (
                    <label className="staff-field">Dev admin token<input type="password" value={devAdminToken} onChange={(e) => onDevAdminTokenChange(e.target.value)} /></label>
                  ) : (
                    <div className="staff-note">Dev admin token disabled outside emulator mode.</div>
                  )}
                  {showEmulatorTools ? <button type="button" className="btn btn-secondary" onClick={onOpenEmulatorUi}>Open Emulator UI</button> : null}
                  <div className="staff-subtitle">Last Firestore write</div>
                  <pre>{safeJsonStringify(lastWrite)}</pre>
                  <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastWrite))}>Copy write JSON</button>
                </div>
                <div className="staff-column">
                  <div className="staff-subtitle">Last query params</div>
                  <pre>{safeJsonStringify(lastQuery)}</pre>
                  <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastQuery))}>Copy query JSON</button>
                  <div className="staff-subtitle">Last GitHub/Functions call</div>
                  <pre>{safeJsonStringify(sanitizeLastRequest(lastReq))}</pre>
                  <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(sanitizeLastRequest(lastReq)))}>Copy call JSON</button>
                  <div className="staff-mini">curl hint</div>
                  <pre>{lastReq?.curlExample ?? "(none)"}</pre>
                  <button className="btn btn-ghost" onClick={() => void copy(lastReq?.curlExample ?? "")} disabled={!lastReq?.curlExample}>Copy curl hint</button>
                </div>
                <div className="staff-column">
                  <div className="staff-subtitle">Last error stack/message</div>
                  <pre>{safeJsonStringify(lastErr)}</pre>
                  {copyStatus ? (
                    <div className="staff-note" role="status" aria-live="polite">
                      {copyStatus}
                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          </>
        ) : null}
        {cockpitTab === "moduleTelemetry" ? (
          <>
            <div className="staff-subtitle">Module engagement telemetry (rolling local)</div>
            <div className="staff-actions-row">
              <button className="btn btn-ghost btn-small" onClick={resetModuleTelemetry}>
                Reset telemetry
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => void copy(safeJsonStringify(moduleTelemetrySnapshot))}>
                Copy telemetry JSON
              </button>
            </div>
            <div className="staff-note">
              {lowEngagementModules.length === 0
                ? "No low-engagement modules detected in the current telemetry sample."
                : `Low-engagement modules in the current telemetry sample: ${lowEngagementModules.join(", ")}`}
            </div>
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Owner</th>
                    <th>Visits</th>
                    <th>Dwell</th>
                    <th>First action</th>
                  </tr>
                </thead>
                <tbody>
                  {moduleUsageRows.length === 0 ? (
                    <tr><td colSpan={5}>No module activity captured yet.</td></tr>
                  ) : (
                    moduleUsageRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.owner}</td>
                        <td>{row.visits}</td>
                        <td>{formatDurationMs(row.dwellMs)}</td>
                        <td>{formatLatencyMs(row.firstActionMs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {cockpitTab === "finance" ? (
          <>
            <div className="staff-module-grid">
              <div className="staff-column">
                {commerceContent}
              </div>
              <div className="staff-column">
                {stripeContent}
              </div>
            </div>
          </>
        ) : null}
        {cockpitTab === "operations" ? (
          <>
            {operationsContent}
          </>
        ) : null}
      </section>
      {cockpitTab === "policyAgentOps" ? (
        <>
          <div className="card staff-console-card">{agentOpsContent}</div>
          <div className="card staff-console-card">{governanceContent}</div>
        </>
      ) : null}
      {cockpitTab === "reports" ? <div className="card staff-console-card">{reportsContent}</div> : null}
    </section>
  );
}
