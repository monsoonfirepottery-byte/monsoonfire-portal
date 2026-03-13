import { safeJsonStringify, type LastRequest } from "../../api/functionsClient";

type SystemCheckRecord = {
  key: string;
  label: string;
  ok: boolean;
  atMs: number;
  details: string;
};

type QueryTrace = {
  atIso: string;
  collection: string;
  params: Record<string, unknown>;
};

type WriteTrace = {
  atIso: string;
  collection: string;
  docId: string;
  payload: Record<string, unknown>;
};

type ErrorRecord = {
  atIso: string;
  label: string;
  message: string;
};

type LastRequestWithPayload = LastRequest;

type NotificationSummary = {
  totalSent?: number;
  totalFailed?: number;
  successRate?: number;
};

type Props = {
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  runSystemPing: () => Promise<void>;
  runCalendarProbe: () => Promise<void>;
  runNotificationMetricsProbe: () => Promise<void>;
  runNotificationFailureDrillNow: () => Promise<void>;
  loadSystemStats: () => Promise<void>;
  busy: string;
  hasFunctionsAuthMismatch: boolean;
  usingLocalFunctions: boolean;
  showEmulatorTools: boolean;
  integrationTokenCount: number | null;
  systemChecks: SystemCheckRecord[];
  notificationMetricsSummary: NotificationSummary | null;
  fBaseUrl: string;
  devAdminEnabled: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  onOpenEmulatorUi: () => void;
  onRefreshHandlerLog: () => void;
  onClearHandlerLog: () => void;
  latestErrors: ErrorRecord[];
  lastWrite: WriteTrace | null;
  lastQuery: QueryTrace | null;
  lastReq: LastRequestWithPayload | null;
  lastErr: { atIso: string; message: string; stack: string | null } | null;
  copy: (value: string) => Promise<void>;
  copyStatus: string;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function sanitizeLastRequest(request: LastRequest | null): LastRequest | null {
  if (!request) return null;
  return {
    ...request,
    payload: (request as { payloadRedacted?: unknown }).payloadRedacted ?? request.payload,
  };
}

export default function SystemModule({
  busy,
  run,
  runSystemPing,
  runCalendarProbe,
  runNotificationMetricsProbe,
  runNotificationFailureDrillNow,
  loadSystemStats,
  hasFunctionsAuthMismatch,
  fBaseUrl,
  usingLocalFunctions,
  showEmulatorTools,
  integrationTokenCount,
  systemChecks,
  notificationMetricsSummary,
  devAdminEnabled,
  devAdminToken,
  onDevAdminTokenChange,
  onOpenEmulatorUi,
  onRefreshHandlerLog,
  onClearHandlerLog,
  latestErrors,
  lastWrite,
  lastQuery,
  lastReq,
  lastErr,
  copy,
  copyStatus,
}: Props) {
  const safeLastReq = sanitizeLastRequest(lastReq);

  return (
    <section className="card staff-console-card">
      <div className="card-title">System</div>
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
          onClick={() => void run("systemPing", runSystemPing)}
        >
          Ping functions
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("calendarProbe", runCalendarProbe)}
        >
          Probe calendar
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("notificationMetricsProbe", runNotificationMetricsProbe)}
        >
          Refresh notif metrics
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("notificationDrill", runNotificationFailureDrillNow)}
        >
          Run push failure drill
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("refreshSystemStats", loadSystemStats)}
        >
          Refresh token stats
        </button>
        <button className="btn btn-secondary" disabled>
          Studio Brain checks retired
        </button>
      </div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Local functions detected at <code>{fBaseUrl}</code> while auth emulator is disabled.
          Function-backed modules are paused to avoid false 401 errors.
        </div>
      ) : null}
      {devAdminEnabled ? (
        <label className="staff-field">Dev admin token<input type="password" value={devAdminToken} onChange={(e) => onDevAdminTokenChange(e.target.value)} /></label>
      ) : (
        <div className="staff-note">Dev admin token disabled outside emulator mode.</div>
      )}
      {showEmulatorTools ? <button type="button" className="btn btn-secondary" onClick={onOpenEmulatorUi}>Open Emulator UI</button> : null}
      <div className="card-title-row">
        <div className="staff-subtitle">Handler errors</div>
        <div className="staff-log-actions">
          <button type="button" className="btn btn-ghost" onClick={onRefreshHandlerLog}>Refresh</button>
          <button type="button" className="btn btn-ghost" onClick={onClearHandlerLog}>Clear</button>
        </div>
      </div>
      <div className="staff-log-list">
        {latestErrors.length === 0 ? <div className="staff-note">No handler errors logged.</div> : latestErrors.map((entry, idx) => <div key={`${entry.atIso}-${idx}`} className="staff-log-entry"><div className="staff-log-meta"><span className="staff-log-label">{entry.label}</span><span>{new Date(entry.atIso).toLocaleString()}</span></div><div className="staff-log-message">{entry.message}</div></div>)}
      </div>
      <div className="card-title-row">
        <div className="staff-subtitle">System checks</div>
      </div>
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
      <details className="staff-troubleshooting">
        <summary>Troubleshooting drawer</summary>
        <div className="staff-module-grid">
          <div className="staff-column">
            <div className="staff-subtitle">Last Firestore write</div>
            <pre>{safeJsonStringify(lastWrite)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastWrite))}>Copy write JSON</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last query params</div>
            <pre>{safeJsonStringify(lastQuery)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastQuery))}>Copy query JSON</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last GitHub/Functions call</div>
            <pre>{safeJsonStringify(safeLastReq)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(safeLastReq))}>Copy call JSON</button>
            <div className="staff-mini">curl hint</div>
            <pre>{safeLastReq?.curlExample ?? "(none)"}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeLastReq?.curlExample ?? "")} disabled={!safeLastReq?.curlExample}>Copy curl hint</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last error stack/message</div>
            <pre>{safeJsonStringify(lastErr)}</pre>
          </div>
        </div>
        {copyStatus ? (
          <div className="staff-note" role="status" aria-live="polite">
            {copyStatus}
          </div>
        ) : null}
      </details>
    </section>
  );
}
