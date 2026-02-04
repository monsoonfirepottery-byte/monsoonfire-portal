import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { formatDateTime } from "../utils/format";
import "./ProfileView.css";

type ProfileDoc = {
  displayName?: string | null;
  preferredKilns?: string[];
  membershipTier?: string;
  membershipSince?: { toDate?: () => Date } | null;
  membershipExpiresAt?: { toDate?: () => Date } | null;
  notifyKiln?: boolean;
  notifyClasses?: boolean;
  notifyPieces?: boolean;
  studioNotes?: string | null;
};

const NOTIFICATION_PREFS = [
  { key: "notifyKiln", label: "Kiln status updates" },
  { key: "notifyClasses", label: "Workshop reminders" },
  { key: "notifyPieces", label: "Piece tracking insights" },
] as const;

type PrefKey = (typeof NOTIFICATION_PREFS)[number]["key"];

export default function ProfileView({ user }: { user: User }) {
  const { active, history } = useBatches(user);
  const [profileDoc, setProfileDoc] = useState<ProfileDoc | null>(null);
  const [profileError, setProfileError] = useState("");

  const [displayNameInput, setDisplayNameInput] = useState("");
  const [preferredKilnsInput, setPreferredKilnsInput] = useState("");
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    notifyKiln: true,
    notifyClasses: false,
    notifyPieces: true,
  });
  const [formStatus, setFormStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!user) return;
      setProfileError("");
      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const data = (snap.data() as ProfileDoc | undefined) ?? null;
        setProfileDoc(data);
        setDisplayNameInput(data?.displayName ?? user.displayName ?? "");
        setPreferredKilnsInput((data?.preferredKilns ?? []).join(", "));
        setPrefs((prev) => ({
          notifyKiln: typeof data?.notifyKiln === "boolean" ? data.notifyKiln : prev.notifyKiln,
          notifyClasses: typeof data?.notifyClasses === "boolean" ? data.notifyClasses : prev.notifyClasses,
          notifyPieces: typeof data?.notifyPieces === "boolean" ? data.notifyPieces : prev.notifyPieces,
        }));
      } catch (err: any) {
        if (cancelled) return;
        setProfileError(`Profile failed: ${err?.message ?? "Unable to load profile."}`);
      }
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const totalPieces = active.length + history.length;
  const successCount = history.filter(
    (batch) => typeof batch.status === "string" && batch.status.toUpperCase().includes("PICKED")
  ).length;
  const successRate = history.length > 0 ? Math.round((successCount / history.length) * 100) : null;

  const membershipTier = profileDoc?.membershipTier ?? "Studio Member";
  const membershipSince =
    profileDoc?.membershipSince?.toDate?.() ??
    (user.metadata.creationTime ? new Date(user.metadata.creationTime) : null);
  const membershipExpires = profileDoc?.membershipExpiresAt?.toDate?.() ?? null;

  const preferredKilns = profileDoc?.preferredKilns ?? [];

  const recentHistory = useMemo(() => history.slice(0, 3), [history]);

  const handleTogglePref = (key: PrefKey) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || isSaving) return;
    setFormError("");
    setFormStatus("");

    const sanitizedKilns = preferredKilnsInput
      .split(",")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length);

    setIsSaving(true);
    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          displayName: displayNameInput.trim() || null,
          notifyKiln: prefs.notifyKiln,
          notifyClasses: prefs.notifyClasses,
          notifyPieces: prefs.notifyPieces,
          preferredKilns: sanitizedKilns,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setFormStatus("Profile saved.");
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to save profile.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page profile-page">
      <div className="page-header">
        <div>
          <h1>Your profile</h1>
          <p className="page-subtitle">See what we know about your journey at Monsoon Fire.</p>
        </div>
      </div>

      <section className="profile-grid">
        <div className="card card-3d profile-summary">
          <div className="card-title">Account summary</div>
          <div className="summary-row">
            <div>
              <div className="summary-label">Display name</div>
              <div className="summary-value">{displayNameInput || "Member"}</div>
            </div>
            <div>
              <div className="summary-label">Email</div>
              <div className="summary-value">{user.email}</div>
            </div>
          </div>
          <div className="summary-row">
            <div>
              <div className="summary-label">Member since</div>
              <div className="summary-value">{membershipSince ? formatDateTime(membershipSince) : "—"}</div>
            </div>
            <div>
              <div className="summary-label">Membership tier</div>
              <div className="summary-value">{membershipTier}</div>
            </div>
          </div>
          <div className="summary-row">
            <div>
              <div className="summary-label">Pieces tracked</div>
              <div className="summary-value">{totalPieces}</div>
            </div>
            <div>
              <div className="summary-label">Success rate</div>
              <div className="summary-value">{successRate !== null ? `${successRate}%` : "—"}</div>
            </div>
          </div>
          <div className="membership-meta">
            <span>Membership expires</span>
            <strong>{membershipExpires ? formatDateTime(membershipExpires) : "Auto-renews"}</strong>
          </div>
        </div>

        <div className="card card-3d profile-form-card">
          <div className="card-title">Profile settings</div>
          <form className="profile-form" onSubmit={handleSave}>
            <label>
              Display name
              <input
                type="text"
                value={displayNameInput}
                onChange={(event) => setDisplayNameInput(event.target.value)}
                placeholder="Your name"
              />
            </label>
            <label>
              Preferred kilns (comma separated)
              <input
                type="text"
                value={preferredKilnsInput}
                onChange={(event) => setPreferredKilnsInput(event.target.value)}
                placeholder="Kiln 1, Kiln 2"
              />
            </label>
            <div className="notification-toggles">
              <span className="summary-label">Notification preferences</span>
              {NOTIFICATION_PREFS.map((pref) => (
                <label key={pref.key} className="toggle">
                  <input
                    type="checkbox"
                    checked={prefs[pref.key]}
                    onChange={() => handleTogglePref(pref.key)}
                  />
                  <span>{pref.label}</span>
                </label>
              ))}
            </div>
            {formError ? <div className="alert form-alert">{formError}</div> : null}
            {formStatus ? <div className="notice form-alert">{formStatus}</div> : null}
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save profile"}
            </button>
          </form>
        </div>
      </section>

      <section className="profile-grid">
        <div className="card card-3d profile-history-card">
          <div className="card-title">Membership & history</div>
          {profileError ? <div className="alert">{profileError}</div> : null}
          <div className="history-section">
            <div className="history-meta">
              <div className="summary-label">Kiln preferences</div>
              <div className="chips">
                {preferredKilns.length === 0 ? (
                  <span className="chip subtle">No preferred kilns yet</span>
                ) : (
                  preferredKilns.map((kiln) => (
                    <span key={kiln} className="chip">
                      {kiln}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="history-meta">
              <div className="summary-label">Studio notes</div>
              <p className="studio-notes">{profileDoc?.studioNotes ?? "Studio has no notes yet."}</p>
            </div>
          </div>
        </div>

        <div className="card card-3d profile-history-card">
          <div className="card-title">Recent batches</div>
            {recentHistory.length === 0 ? (
              <div className="empty-state">No completed pieces yet.</div>
            ) : (
              <div className="history-list">
                {recentHistory.map((batch) => (
                  <article key={batch.id} className="history-row">
                    <div>
                      <strong>{batch.title ?? "Untitled batch"}</strong>
                      <div className="summary-label">
                        {typeof batch.kilnId === "string" ? `Kiln ${batch.kilnId}` : "Unassigned"}
                      </div>
                    </div>
                    <div className="history-meta">
                      <span>{batch.status ?? "In progress"}</span>
                      <span>{formatDateTime(batch.updatedAt)}</span>
                    </div>
                  </article>
                ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
