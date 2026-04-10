import { useEffect, useState } from "react";
import type { ControlTowerRoomDetail } from "../../../utils/studioBrainControlTower";

type Props = {
  open: boolean;
  room: ControlTowerRoomDetail | null;
  busy: boolean;
  statusMessage: string;
  errorMessage: string;
  onClose: () => void;
  onRefresh: () => void;
  onSendInstruction: (text: string) => Promise<void> | void;
  onTogglePinned: (nextPinned: boolean) => Promise<void> | void;
  onCopyAttach: (command: string) => Promise<void> | void;
};

function formatMinutes(ageMinutes: number | null): string {
  if (ageMinutes === null) return "No heartbeat yet";
  if (ageMinutes < 1) return "Updated moments ago";
  if (ageMinutes === 1) return "Updated 1 minute ago";
  if (ageMinutes < 60) return `Updated ${ageMinutes} minutes ago`;
  const hours = Math.floor(ageMinutes / 60);
  return hours === 1 ? "Updated 1 hour ago" : `Updated ${hours} hours ago`;
}

export default function ControlTowerRoomDrawer({
  open,
  room,
  busy,
  statusMessage,
  errorMessage,
  onClose,
  onRefresh,
  onSendInstruction,
  onTogglePinned,
  onCopyAttach,
}: Props) {
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    setInstruction("");
  }, [room?.id]);

  if (!open || !room) return null;

  return (
    <div className="control-tower-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="control-tower-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${room.name} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="control-tower-drawer-header">
          <div>
            <div className="control-tower-kicker">Room detail</div>
            <h2>{room.name}</h2>
            <p>{room.objective}</p>
          </div>
          <div className="control-tower-drawer-header-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh}>
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
            <strong>{room.status}</strong>
            <p>{room.summary}</p>
          </div>
          <div className="control-tower-room-meta-card">
            <span>Project</span>
            <strong>{room.project || "General"}</strong>
            <p>{formatMinutes(room.ageMinutes)}</p>
          </div>
          <div className="control-tower-room-meta-card">
            <span>Tool</span>
            <strong>{room.tool}</strong>
            <p>{room.cwd || "No working directory recorded"}</p>
          </div>
        </div>

        {statusMessage ? <div className="staff-note staff-note-ok">{statusMessage}</div> : null}
        {errorMessage ? <div className="staff-note staff-note-danger">{errorMessage}</div> : null}

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Operator actions</h3>
              <p>Use explicit actions here first. Attach only when you need shell-level recovery.</p>
            </div>
          </div>
          <div className="control-tower-room-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => onTogglePinned(!room.isEscalated)}
              disabled={busy}
            >
              {room.isEscalated ? "Clear escalation" : "Escalate room"}
            </button>
            {room.attach ? (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => onCopyAttach(room.attach!.sshCommand)}
              >
                Copy attach command
              </button>
            ) : null}
          </div>

          {room.attach ? (
            <div className="control-tower-attach-card">
              <div>
                <strong>{room.attach.sessionName}</strong>
                <p>Use this only when you need the live tmux lane.</p>
              </div>
              <code>{room.attach.sshCommand}</code>
            </div>
          ) : null}

          <div className="control-tower-send-card">
            <label>
              <span>Send instruction</span>
              <textarea
                rows={4}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Ask the lane for a status update, next move, or specific investigation."
              />
            </label>
            <div className="control-tower-room-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={!instruction.trim() || busy}
                onClick={() => onSendInstruction(instruction)}
              >
                Send to room
              </button>
            </div>
          </div>
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Recent events</h3>
              <p>The short story of what just happened here.</p>
            </div>
          </div>
          {room.recentEvents.length ? (
            <div className="control-tower-timeline">
              {room.recentEvents.map((event) => (
                <article key={event.id} className={`control-tower-event-card control-tower-event-${event.severity}`}>
                  <div className="control-tower-event-meta">
                    <span>{event.title}</span>
                    <time>{new Date(event.at).toLocaleString()}</time>
                  </div>
                  <p>{event.summary}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="staff-note staff-note-muted">No room-scoped events are recorded yet.</div>
          )}
        </section>

        <section className="control-tower-section">
          <div className="control-tower-section-header">
            <div>
              <h3>Live lanes</h3>
              <p>tmux remains backstage here for recovery and long-running work.</p>
            </div>
          </div>
          <div className="control-tower-session-list">
            {room.sessions.map((session) => (
              <article key={session.sessionName} className="control-tower-session-card">
                <div className="control-tower-session-title-row">
                  <strong>{session.sessionName}</strong>
                  <span className="pill">{session.statusLabel}</span>
                </div>
                <p>{session.summary}</p>
                <div className="control-tower-session-meta">
                  <span>{session.tool}</span>
                  <span>{session.cwd}</span>
                  <span>{session.paneCount} pane{session.paneCount === 1 ? "" : "s"}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
