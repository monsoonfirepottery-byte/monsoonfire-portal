// src/components/TimelineViewer.tsx
import type { TimelineEvent } from "../types/domain";
import { TIMELINE_EVENT_LABELS, normalizeTimelineEventType } from "../timelineEventTypes";
import { styles as S } from "../ui/styles";

type Props = {
  selectedBatchId: string;
  selectedBatchTitle?: string | null;
  timeline: TimelineEvent[];
  loading: boolean;
  onClose: () => void;
};

function formatTs(ts: any) {
  if (!ts) return "";
  try {
    return typeof ts.toDate === "function" ? ts.toDate().toLocaleString() : String(ts);
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
    <div style={S.card}>
      <div style={S.rowBetween}>
        <div style={S.h2}>
          Timeline: <span style={S.muted}>{title}</span>
        </div>
        <button style={S.btnSmall} onClick={onClose}>
          Close
        </button>
      </div>

      {loading ? (
        <div style={S.muted}>Loading…</div>
      ) : timeline.length === 0 ? (
        <div style={S.muted}>(no events)</div>
      ) : (
        <div style={S.stack}>
          {timeline.map((ev) => (
            <div key={ev.id} style={S.timelineRow}>
              <div style={S.timelineAt}>{formatTs(ev.at)}</div>
              <div style={S.flex1}>
                <div style={S.timelineType}>{getTimelineLabel(ev.type)}</div>
                <div style={S.timelineMeta}>
                  {ev.actorName ? `by ${ev.actorName}` : ""}
                  {ev.kilnName ? ` • kiln: ${ev.kilnName}` : ""}
                </div>
                {ev.notes ? <div style={S.timelineNotes}>{ev.notes}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
