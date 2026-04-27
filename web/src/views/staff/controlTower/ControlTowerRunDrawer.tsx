import { useEffect } from "react";
import type { AgentRuntimeRunDetail } from "../../../utils/studioBrainControlTower";

type Props = {
  open: boolean;
  detail: AgentRuntimeRunDetail | null;
  busy: boolean;
  statusMessage: string;
  errorMessage: string;
  onClose: () => void;
  onRefresh: () => void;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "No timestamp yet";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString();
}

function stepTone(status: AgentRuntimeRunDetail["steps"][number]["status"]): "danger" | "warn" | "ok" | "neutral" {
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "running" || status === "pending") return "warn";
  if (status === "succeeded") return "ok";
  return "neutral";
}

function diagnosticTone(
  severity: AgentRuntimeRunDetail["diagnostics"][number]["severity"],
): "danger" | "warn" | "ok" | "neutral" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warn";
  if (severity === "info") return "ok";
  return "neutral";
}

export default function ControlTowerRunDrawer({
  open,
  detail,
  busy,
  statusMessage,
  errorMessage,
  onClose,
  onRefresh,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || !detail) return null;

  const summary = detail.summary;

  return (
    <div className="control-tower-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="control-tower-drawer control-tower-run-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${summary?.title || detail.runId} run details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="control-tower-drawer-header">
          <div>
            <div className="control-tower-kicker">Run inspector</div>
            <h2>{summary?.title || detail.runId}</h2>
            <p>{summary?.goal || detail.whyStuck || "Inspect the live run, evidence, and diagnostics from one drawer."}</p>
          </div>
          <div className="control-tower-drawer-header-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh} disabled={busy}>
              Refresh
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="control-tower-room-meta-grid">
          <div className="control-tower-room-meta-card">
            <span>Status</span>
            <strong>{summary?.status || "unknown"}</strong>
            <p>{summary?.riskLane || "No lane recorded"}</p>
          </div>
          <div className="control-tower-room-meta-card">
            <span>Host</span>
            <strong>{summary?.hostId || "unassigned"}</strong>
            <p>{summary?.environment || "environment unknown"}</p>
          </div>
          <div className="control-tower-room-meta-card">
            <span>Updated</span>
            <strong>{formatTimestamp(summary?.updatedAt || detail.generatedAt)}</strong>
            <p>{detail.whyStuck || "No active blocker recorded."}</p>
          </div>
        </div>

        {statusMessage ? <div className="staff-note staff-note-ok">{statusMessage}</div> : null}
        {errorMessage ? <div className="staff-note staff-note-danger">{errorMessage}</div> : null}

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Why this is stuck</h3>
              <p>Intent, execution, and evidence stay separate here so failure stays legible.</p>
            </div>
          </div>
          <article className="control-tower-next-card">
            <h3>{detail.whyStuck || "Run is moving without a blocker."}</h3>
            <p>
              {summary?.boardRow?.next
                ? `Next recommended move: ${summary.boardRow.next}`
                : "No next move has been projected yet."}
            </p>
            <div className="control-tower-next-footer">
              <span>{summary?.boardRow?.decisionNeeded || "No decision gate waiting."}</span>
              <span>{summary?.lastEventType || "No event type recorded"}</span>
            </div>
          </article>
          <div className="control-tower-timeline">
            {(detail.diagnostics ?? []).map((diagnostic) => (
              <article key={diagnostic.id} className={`control-tower-event-card control-tower-tone-${diagnosticTone(diagnostic.severity)}`}>
                <div className="control-tower-event-meta">
                  <strong>{diagnostic.title}</strong>
                  <span className={`pill control-tower-pill-${diagnosticTone(diagnostic.severity)}`}>{diagnostic.severity}</span>
                </div>
                <p>{diagnostic.summary}</p>
                {diagnostic.recommendedAction ? <div className="control-tower-event-footer"><span>{diagnostic.recommendedAction}</span></div> : null}
              </article>
            ))}
            {!(detail.diagnostics ?? []).length ? (
              <div className="staff-note staff-note-ok">No runtime diagnostics are firing right now.</div>
            ) : null}
          </div>
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Step trace</h3>
              <p>Streaming run steps stay visible without dropping you into raw logs first.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {detail.steps.map((step) => (
              <article key={step.stepId} className={`control-tower-event-card control-tower-tone-${stepTone(step.status)}`}>
                <div className="control-tower-event-meta">
                  <strong>{step.title}</strong>
                  <span className={`pill control-tower-pill-${stepTone(step.status)}`}>{step.status}</span>
                </div>
                <p>{step.summary}</p>
                <div className="control-tower-event-footer">
                  <span>{step.kind}</span>
                  <span>{formatTimestamp(step.finishedAt || step.startedAt)}</span>
                </div>
                {step.evidenceRefs.length ? (
                  <div className="control-tower-memory-list">
                    {step.evidenceRefs.slice(0, 3).map((ref) => (
                      <span key={ref}>{ref}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {!detail.steps.length ? (
              <div className="staff-note staff-note-muted">No projected steps are available for this run yet.</div>
            ) : null}
          </div>
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Artifacts and evidence</h3>
              <p>Structured artifacts stay one click away from the run that produced them.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {detail.artifacts.map((artifact) => (
              <article key={artifact.artifactId} className="control-tower-event-card control-tower-event-info">
                <div className="control-tower-event-meta">
                  <strong>{artifact.label}</strong>
                  <span className="pill control-tower-pill-neutral">{artifact.kind}</span>
                </div>
                <p>{artifact.path}</p>
                <div className="control-tower-event-footer">
                  <span>{artifact.sizeBytes ? `${artifact.sizeBytes} bytes` : "size unknown"}</span>
                  <span>{formatTimestamp(artifact.updatedAt)}</span>
                </div>
                {artifact.preview ? (
                  <details className="control-tower-inline-details">
                    <summary>Preview</summary>
                    <pre>{artifact.preview}</pre>
                  </details>
                ) : null}
              </article>
            ))}
            {!detail.artifacts.length ? (
              <div className="staff-note staff-note-muted">No evidence artifacts were found for this run.</div>
            ) : null}
          </div>
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Tool calls</h3>
              <p>Tool activity appears here when the runtime emits tool-scoped events.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {detail.toolCalls.map((toolCall) => (
              <article key={toolCall.toolCallId} className="control-tower-event-card control-tower-event-info">
                <div className="control-tower-event-meta">
                  <strong>{toolCall.toolName}</strong>
                  <span className="pill control-tower-pill-neutral">{toolCall.status}</span>
                </div>
                <p>{toolCall.summary}</p>
                <div className="control-tower-event-footer">
                  <span>{toolCall.sideEffectClass}</span>
                  <span>{formatTimestamp(toolCall.completedAt || toolCall.requestedAt)}</span>
                </div>
              </article>
            ))}
            {!detail.toolCalls.length ? (
              <div className="staff-note staff-note-muted">No tool-call telemetry has been recorded for this run yet.</div>
            ) : null}
          </div>
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Event ledger</h3>
              <p>Raw event envelopes stay collapsible instead of swallowing the whole screen.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {detail.events.map((event) => (
              <article key={event.eventId} className="control-tower-event-card control-tower-event-info">
                <div className="control-tower-event-meta">
                  <strong>{event.type}</strong>
                  <time>{formatTimestamp(event.occurredAt)}</time>
                </div>
                <details className="control-tower-inline-details">
                  <summary>Event payload</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
              </article>
            ))}
            {!detail.events.length ? (
              <div className="staff-note staff-note-muted">No ledger events have been captured for this run.</div>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );
}
