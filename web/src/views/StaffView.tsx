import { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { clearHandlerErrorLog, getHandlerErrorLog } from "../utils/handlerLog";

type Props = {
  user: User;
  isStaff: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  devAdminEnabled: boolean;
  showEmulatorTools: boolean;
};

export default function StaffView({
  user,
  isStaff,
  devAdminToken,
  onDevAdminTokenChange,
  devAdminEnabled,
  showEmulatorTools,
}: Props) {
  const [handlerLog, setHandlerLog] = useState<Array<{ atIso: string; label: string; message: string }>>(
    () => getHandlerErrorLog()
  );

  const refreshHandlerLog = () => {
    setHandlerLog(getHandlerErrorLog());
  };

  const latestEntries = useMemo(() => {
    return [...handlerLog].reverse().slice(0, 25);
  }, [handlerLog]);

  const handleClearHandlerLog = () => {
    clearHandlerErrorLog();
    refreshHandlerLog();
  };

  return (
    <div className="staff-view">
      <div className="staff-hero card card-3d">
        <div className="card-title">Staff tools</div>
        <p className="card-subtitle">
          Manage studio-side settings and development utilities from one place.
        </p>
        <div className="staff-meta">
          <div>
            <span className="label">Signed in as</span>
            <strong>{user.displayName ?? "Staff"}</strong>
          </div>
          <div>
            <span className="label">Role</span>
            <strong>{isStaff ? "Staff" : "Dev Admin"}</strong>
          </div>
          <div>
            <span className="label">Email</span>
            <strong>{user.email ?? ""}</strong>
          </div>
        </div>
      </div>

      <div className="staff-grid">
        <section className="card">
          <div className="card-title">Dev tools</div>
          <p className="card-subtitle">
            These tools are available only in local development.
          </p>
          {devAdminEnabled ? (
            <label className="staff-field">
              Dev admin token (emulator only)
              <input
                type="password"
                value={devAdminToken}
                placeholder="Paste token"
                onChange={(event) => onDevAdminTokenChange(event.target.value)}
              />
              <span className="helper">Stored for this browser session only.</span>
            </label>
          ) : (
            <div className="staff-note">
              Dev admin token is disabled outside emulator mode.
            </div>
          )}
          {showEmulatorTools ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.open("http://127.0.0.1:4000/", "_blank")}
            >
              Open Emulator UI
            </button>
          ) : null}
        </section>

        <section className="card">
          <div className="card-title">Staff claims</div>
          <p className="card-subtitle">
            Staff access is granted via custom claims. If you need access, ask an
            admin to set your role.
          </p>
          <div className="staff-note">
            Use the Admin SDK or Firebase CLI to apply the staff claim.
          </div>
        </section>

        <section className="card">
          <div className="card-title">Provider setup checklist</div>
          <p className="card-subtitle">
            These providers must be enabled in Firebase Auth for sign-in to work.
          </p>
          <ol className="staff-list">
            <li>Enable Apple, Facebook, and Microsoft providers in the Firebase Console.</li>
            <li>Confirm OAuth redirect URIs for each provider.</li>
            <li>Allow the email link domain for magic-link sign-in.</li>
          </ol>
          <div className="staff-note">
            Once enabled, the buttons on the signed-out page will work immediately.
          </div>
        </section>

        <section className="card">
          <div className="card-title-row">
            <div className="card-title">Handler error log</div>
            <div className="staff-log-actions">
              <button type="button" className="btn btn-ghost" onClick={refreshHandlerLog}>
                Refresh
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleClearHandlerLog}>
                Clear
              </button>
            </div>
          </div>
          <p className="card-subtitle">
            Recent async handler failures from this browser (`mf_handler_error_log_v1`).
          </p>
          {latestEntries.length === 0 ? (
            <div className="staff-note">No handler errors logged yet.</div>
          ) : (
            <div className="staff-log-list">
              {latestEntries.map((entry, index) => (
                <div key={`${entry.atIso}-${entry.label}-${index}`} className="staff-log-entry">
                  <div className="staff-log-meta">
                    <span className="staff-log-label">{entry.label || "ui-handler"}</span>
                    <span>{new Date(entry.atIso).toLocaleString()}</span>
                  </div>
                  <div className="staff-log-message">{entry.message}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
