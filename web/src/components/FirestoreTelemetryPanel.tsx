import { useEffect, useMemo, useState } from "react";
import {
  getFirestoreTelemetrySnapshot,
  resetFirestoreTelemetry,
} from "../lib/firestoreTelemetry";

type Props = {
  enabled: boolean;
};

type Snapshot = ReturnType<typeof getFirestoreTelemetrySnapshot>;

const COLLAPSED_KEY = "mf_firestore_telemetry_collapsed";

export default function FirestoreTelemetryPanel({ enabled }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [snapshot, setSnapshot] = useState<Snapshot>(() => getFirestoreTelemetrySnapshot());

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      setSnapshot(getFirestoreTelemetrySnapshot());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [collapsed]);

  const heaviestViews = useMemo(
    () =>
      [...snapshot.perView]
        .sort((a, b) => b.reads - a.reads)
        .slice(0, 5),
    [snapshot.perView]
  );

  if (!enabled) return null;

  return (
    <div className={`telemetry-panel ${collapsed ? "collapsed" : "expanded"}`}>
      <button
        type="button"
        className="telemetry-toggle"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        Firestore telemetry
      </button>

      {!collapsed ? (
        <div className="telemetry-body">
          <div className="telemetry-row">
            <span>Current view</span>
            <strong>{snapshot.currentView}</strong>
          </div>
          <div className="telemetry-row">
            <span>Last 60s reads</span>
            <strong>{snapshot.last60.reads}</strong>
          </div>
          <div className="telemetry-row">
            <span>Last 60s writes</span>
            <strong>{snapshot.last60.writes}</strong>
          </div>
          <div className="telemetry-row">
            <span>Last 60s listener reads</span>
            <strong>{snapshot.last60.listenerReads}</strong>
          </div>
          <div className="telemetry-row">
            <span>Session reads</span>
            <strong>{snapshot.sessionTotals.reads}</strong>
          </div>
          <div className="telemetry-row">
            <span>Session writes</span>
            <strong>{snapshot.sessionTotals.writes}</strong>
          </div>
          <div className="telemetry-row">
            <span>Session deletes</span>
            <strong>{snapshot.sessionTotals.deletes}</strong>
          </div>
          <div className="telemetry-row">
            <span>Session listener events</span>
            <strong>{snapshot.sessionTotals.listenerEvents}</strong>
          </div>

          <div className="telemetry-subtitle">Top views by reads</div>
          <div className="telemetry-list">
            {heaviestViews.length === 0 ? (
              <div className="telemetry-empty">No Firestore activity yet.</div>
            ) : (
              heaviestViews.map((entry) => (
                <div key={entry.view} className="telemetry-list-row">
                  <span>{entry.view}</span>
                  <strong>{entry.reads}</strong>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className="telemetry-reset"
            onClick={() => {
              resetFirestoreTelemetry();
              setSnapshot(getFirestoreTelemetrySnapshot());
            }}
          >
            Reset session counters
          </button>
        </div>
      ) : null}
    </div>
  );
}
