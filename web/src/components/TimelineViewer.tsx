// src/components/TimelineViewer.tsx
import type { TimelineEvent } from "../types/domain";
import { TIMELINE_EVENT_LABELS, normalizeTimelineEventType } from "../timelineEventTypes";
import "./TimelineViewer.css";

type Props = {
  selectedBatchId: string;
  selectedBatchTitle?: string | null;
  timeline: TimelineEvent[];
  loading: boolean;
  onClose: () => void;
};

type TimestampLike = { toDate?: () => Date };

function formatTs(ts: unknown) {
  if (!ts) return "";
  try {
    const value = ts as TimestampLike;
    return typeof value.toDate === "function" ? value.toDate().toLocaleString() : String(ts);
  } catch {
    return "";
  }
}

function getTimelineLabel(type: unknown): string {
  const normalized = normalizeTimelineEventType(type);
  if (normalized) return TIMELINE_EVENT_LABELS[normalized];
  if (typeof type === "string" && type.trim()) return type;
  return "Event";
}

export default function TimelineViewer({
  selectedBatchId,
  selectedBatchTitle,
  timeline,
  loading,
  onClose,
}: Props) {
  const title = selectedBatchTitle || selectedBatchId;

  return (
    <div className="timeline-viewer card">
      <div className="timeline-viewer__header">
        <div className="timeline-viewer__title">
          Timeline: <span className="muted-text">{title}</span>
        </div>
        <button type="button" className="timeline-viewer__close btn-small" onClick={onClose}>
          Close
        </button>
      </div>

      {loading ? (
        <div className="muted-text">Loading…</div>
      ) : timeline.length === 0 ? (
        <div className="muted-text">(no events)</div>
      ) : (
        <div className="timeline-viewer__stack">
          {timeline.map((ev) => (
            <div key={ev.id} className="timeline-viewer__row">
              <div className="timeline-viewer__at">{formatTs(ev.at)}</div>
              <div className="timeline-viewer__body">
                <div className="timeline-viewer__type">{getTimelineLabel(ev.type)}</div>
                <div className="timeline-viewer__meta">
                  {ev.actorName ? `by ${ev.actorName}` : ""}
                  {ev.kilnName ? ` • kiln: ${ev.kilnName}` : ""}
                </div>
                {ev.notes ? <div className="timeline-viewer__notes">{ev.notes}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
