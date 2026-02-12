import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { isPortalThemeName, type PortalThemeName } from "../theme/themes";
import { writeStoredEnhancedMotion } from "../theme/motionStorage";
import { writeStoredPortalTheme } from "../theme/themeStorage";
import { formatDateTime } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
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
  uiTheme?: PortalThemeName | null;
  uiEnhancedMotion?: boolean | null;
};

type NotificationPrefsDoc = {
  enabled: boolean;
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  events: {
    kilnUnloaded: boolean;
    kilnUnloadedBisque: boolean;
    kilnUnloadedGlaze: boolean;
  };
  quietHours: {
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    timezone: string;
  };
  frequency: {
    mode: "immediate" | "digest";
    digestHours?: number;
  };
};

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsDoc = {
  enabled: true,
  channels: {
    inApp: true,
    email: false,
    push: false,
    sms: false,
  },
  events: {
    kilnUnloaded: true,
    kilnUnloadedBisque: true,
    kilnUnloadedGlaze: true,
  },
  quietHours: {
    enabled: false,
    startLocal: "21:00",
    endLocal: "08:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix",
  },
  frequency: {
    mode: "immediate",
    digestHours: 6,
  },
};

function mergeNotificationPrefs(data?: Partial<NotificationPrefsDoc> | null): NotificationPrefsDoc {
  const prefs = data ?? {};
  return {
    enabled: prefs.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
    channels: {
      inApp: prefs.channels?.inApp ?? DEFAULT_NOTIFICATION_PREFS.channels.inApp,
      email: prefs.channels?.email ?? DEFAULT_NOTIFICATION_PREFS.channels.email,
      push: prefs.channels?.push ?? DEFAULT_NOTIFICATION_PREFS.channels.push,
      sms: prefs.channels?.sms ?? DEFAULT_NOTIFICATION_PREFS.channels.sms,
    },
    events: {
      kilnUnloaded: prefs.events?.kilnUnloaded ?? DEFAULT_NOTIFICATION_PREFS.events.kilnUnloaded,
      kilnUnloadedBisque:
        prefs.events?.kilnUnloadedBisque ?? DEFAULT_NOTIFICATION_PREFS.events.kilnUnloadedBisque,
      kilnUnloadedGlaze:
        prefs.events?.kilnUnloadedGlaze ?? DEFAULT_NOTIFICATION_PREFS.events.kilnUnloadedGlaze,
    },
    quietHours: {
      enabled: prefs.quietHours?.enabled ?? DEFAULT_NOTIFICATION_PREFS.quietHours.enabled,
      startLocal: prefs.quietHours?.startLocal ?? DEFAULT_NOTIFICATION_PREFS.quietHours.startLocal,
      endLocal: prefs.quietHours?.endLocal ?? DEFAULT_NOTIFICATION_PREFS.quietHours.endLocal,
      timezone: prefs.quietHours?.timezone ?? DEFAULT_NOTIFICATION_PREFS.quietHours.timezone,
    },
    frequency: {
      mode: prefs.frequency?.mode ?? DEFAULT_NOTIFICATION_PREFS.frequency.mode,
      digestHours: prefs.frequency?.digestHours ?? DEFAULT_NOTIFICATION_PREFS.frequency.digestHours,
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const NOTIFICATION_PREFS = [
  { key: "notifyKiln", label: "Kiln status updates" },
  { key: "notifyClasses", label: "Workshop reminders" },
  { key: "notifyPieces", label: "Piece tracking insights" },
] as const;

type PrefKey = (typeof NOTIFICATION_PREFS)[number]["key"];

export default function ProfileView({
  user,
  themeName,
  onThemeChange,
  enhancedMotion,
  onEnhancedMotionChange,
  onOpenIntegrations,
}: {
  user: User;
  themeName: PortalThemeName;
  onThemeChange: (next: PortalThemeName) => void;
  enhancedMotion: boolean;
  onEnhancedMotionChange: (next: boolean) => void;
  onOpenIntegrations: () => void;
}) {
  const { active, history } = useBatches(user);
  const [profileDoc, setProfileDoc] = useState<ProfileDoc | null>(null);
  const [profileError, setProfileError] = useState("");
  const prefersReducedMotion = usePrefersReducedMotion();

  const [displayNameInput, setDisplayNameInput] = useState("");
  const [preferredKilnsInput, setPreferredKilnsInput] = useState("");
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    notifyKiln: true,
    notifyClasses: false,
    notifyPieces: true,
  });
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefsDoc>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [formStatus, setFormStatus] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [themeStatus, setThemeStatus] = useState("");
  const [themeError, setThemeError] = useState("");
  const [themeSaving, setThemeSaving] = useState(false);
  const [motionStatus, setMotionStatus] = useState("");
  const [motionError, setMotionError] = useState("");
  const [motionSaving, setMotionSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!user) return;
      setProfileError("");
      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);
        const prefsRef = doc(db, "users", user.uid, "prefs", "notifications");
        const prefsSnap = await getDoc(prefsRef);
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
        setNotificationPrefs(
          mergeNotificationPrefs(
            prefsSnap.exists() ? (prefsSnap.data() as Partial<NotificationPrefsDoc>) : null
          )
        );
      } catch (error: unknown) {
        if (cancelled) return;
        setProfileError(`Profile failed: ${getErrorMessage(error) || "Unable to load profile."}`);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleThemeSelect = async (nextRaw: string) => {
    if (!user || themeSaving) return;
    if (!isPortalThemeName(nextRaw)) return;
    const next = nextRaw as PortalThemeName;
    setThemeError("");
    setThemeStatus("");

    onThemeChange(next);
    writeStoredPortalTheme(next);

    setThemeSaving(true);
    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          uiTheme: next,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setProfileDoc((prev) => (prev ? { ...prev, uiTheme: next } : { uiTheme: next }));
      setThemeStatus("Theme saved.");
    } catch (error: unknown) {
      setThemeError(getErrorMessage(error) || "Failed to save theme.");
    } finally {
      setThemeSaving(false);
    }
  };

  const handleEnhancedMotionToggle = async (next: boolean) => {
    if (!user || motionSaving) return;
    setMotionError("");
    setMotionStatus("");

    onEnhancedMotionChange(next);
    writeStoredEnhancedMotion(next);

    setMotionSaving(true);
    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          uiEnhancedMotion: next,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setProfileDoc((prev) =>
        prev ? { ...prev, uiEnhancedMotion: next } : { uiEnhancedMotion: next }
      );
      setMotionStatus("Motion setting saved.");
    } catch (error: unknown) {
      setMotionError(getErrorMessage(error) || "Failed to save motion setting.");
    } finally {
      setMotionSaving(false);
    }
  };

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
          // If the user hasn't visited Profile recently, theme may still be unset in their profile doc.
          uiTheme: themeName,
          uiEnhancedMotion: enhancedMotion,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setFormStatus("Profile saved.");
    } catch (error: unknown) {
      setFormError(getErrorMessage(error) || "Failed to save profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!user || notificationSaving) return;
    setNotificationError("");
    setNotificationStatus("");
    setNotificationSaving(true);
    try {
      const ref = doc(db, "users", user.uid, "prefs", "notifications");
      await setDoc(
        ref,
        {
          enabled: notificationPrefs.enabled,
          channels: notificationPrefs.channels,
          events: notificationPrefs.events,
          quietHours: notificationPrefs.quietHours,
          frequency: {
            mode: notificationPrefs.frequency.mode,
            digestHours:
              notificationPrefs.frequency.mode === "digest"
                ? notificationPrefs.frequency.digestHours ?? 6
                : null,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setNotificationStatus("Notification settings saved.");
    } catch (error: unknown) {
      setNotificationError(getErrorMessage(error) || "Failed to save notifications.");
    } finally {
      setNotificationSaving(false);
    }
  };

  return (
    <div className="page profile-page">
      <div className="page-header">
        <div>
          <h1>Your profile</h1>
          <p className="page-subtitle">See what we know about your journey at Monsoon Fire.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={onOpenIntegrations}>
            Integrations
          </button>
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
          <form className="profile-form" onSubmit={toVoidHandler(handleSave)}>
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
            <label>
              Theme
              <select
                value={themeName}
                onChange={(event) => void handleThemeSelect(event.target.value)}
                disabled={themeSaving}
              >
                <option value="portal">Monsoon Fire (default)</option>
                <option value="memoria">Memoria design system</option>
              </select>
              <span className="profile-help">
                Changes apply instantly and sync to your account.
                {prefersReducedMotion ? " Reduced motion is enabled, so animations are minimized." : ""}
              </span>
            </label>
            <div className="inline-toggle">
              <label className="inline-toggle-row">
                <span>Enhanced motion</span>
                <input
                  type="checkbox"
                  checked={enhancedMotion}
                  onChange={(event) => void handleEnhancedMotionToggle(Boolean(event.target.checked))}
                  disabled={motionSaving}
                />
              </label>
              <span className="profile-help">
                Turn this off if the portal feels heavy on your device.
              </span>
            </div>
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
            {themeError ? <div className="alert form-alert">{themeError}</div> : null}
            {themeStatus ? <div className="notice form-alert">{themeStatus}</div> : null}
            {motionError ? <div className="alert form-alert">{motionError}</div> : null}
            {motionStatus ? <div className="notice form-alert">{motionStatus}</div> : null}
            {formError ? <div className="alert form-alert">{formError}</div> : null}
            {formStatus ? <div className="notice form-alert">{formStatus}</div> : null}
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save profile"}
            </button>
          </form>
        </div>

        <div className="card card-3d profile-form-card">
          <div className="card-title">Notification settings</div>
          <div className="notification-settings">
            <label className="toggle">
              <input
                type="checkbox"
                checked={notificationPrefs.enabled}
                onChange={() =>
                  setNotificationPrefs((prev) => ({
                    ...prev,
                    enabled: !prev.enabled,
                  }))
                }
              />
              <span>Enable notifications</span>
            </label>

            <div className="notification-group">
              <div className="summary-label">Channels</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.channels.inApp}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      channels: { ...prev.channels, inApp: !prev.channels.inApp },
                    }))
                  }
                />
                <span>In-app updates</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.channels.email}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      channels: { ...prev.channels, email: !prev.channels.email },
                    }))
                  }
                />
                <span>Email me when my items are ready</span>
              </label>
              <label className="toggle disabled">
                <input type="checkbox" checked={notificationPrefs.channels.push} disabled />
                <span>Push notifications (coming soon)</span>
              </label>
              <label className="toggle disabled">
                <input type="checkbox" checked={notificationPrefs.channels.sms} disabled />
                <span>SMS alerts (coming soon)</span>
              </label>
            </div>

            <div className="notification-group">
              <div className="summary-label">Studio updates</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.events.kilnUnloaded}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      events: { ...prev.events, kilnUnloaded: !prev.events.kilnUnloaded },
                    }))
                  }
                />
                <span>Notify me when my items are unloaded</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.events.kilnUnloadedBisque}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      events: {
                        ...prev.events,
                        kilnUnloadedBisque: !prev.events.kilnUnloadedBisque,
                      },
                    }))
                  }
                />
                <span>Bisque firings</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.events.kilnUnloadedGlaze}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      events: {
                        ...prev.events,
                        kilnUnloadedGlaze: !prev.events.kilnUnloadedGlaze,
                      },
                    }))
                  }
                />
                <span>Glaze firings</span>
              </label>
            </div>

            <div className="notification-group">
              <div className="summary-label">Quiet hours</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={notificationPrefs.quietHours.enabled}
                  onChange={() =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      quietHours: { ...prev.quietHours, enabled: !prev.quietHours.enabled },
                    }))
                  }
                />
                <span>Pause alerts during quiet hours</span>
              </label>
              <div className="notification-row">
                <label>
                  Start
                  <input
                    type="time"
                    value={notificationPrefs.quietHours.startLocal}
                    onChange={(event) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        quietHours: { ...prev.quietHours, startLocal: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    value={notificationPrefs.quietHours.endLocal}
                    onChange={(event) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        quietHours: { ...prev.quietHours, endLocal: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                Timezone
                <input
                  type="text"
                  value={notificationPrefs.quietHours.timezone}
                  onChange={(event) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      quietHours: { ...prev.quietHours, timezone: event.target.value },
                    }))
                  }
                />
              </label>
            </div>

            <div className="notification-group">
              <div className="summary-label">Delivery timing</div>
              <label>
                Frequency
                <select
                  value={notificationPrefs.frequency.mode}
                  onChange={(event) =>
                    setNotificationPrefs((prev) => ({
                      ...prev,
                      frequency: {
                        ...prev.frequency,
                        mode: event.target.value as "immediate" | "digest",
                      },
                    }))
                  }
                >
                  <option value="immediate">Send immediately</option>
                  <option value="digest">Digest</option>
                </select>
              </label>
              {notificationPrefs.frequency.mode === "digest" ? (
                <label>
                  Digest every (hours)
                  <input
                    type="number"
                    min={1}
                    max={48}
                    value={notificationPrefs.frequency.digestHours ?? 6}
                    onChange={(event) =>
                      setNotificationPrefs((prev) => {
                        const next = Number(event.target.value);
                        return {
                          ...prev,
                          frequency: {
                            ...prev.frequency,
                            digestHours: Number.isFinite(next) ? next : 6,
                          },
                        };
                      })
                    }
                  />
                </label>
              ) : null}
            </div>

            {notificationError ? <div className="alert form-alert">{notificationError}</div> : null}
            {notificationStatus ? <div className="notice form-alert">{notificationStatus}</div> : null}
            <button
              type="button"
              className="btn btn-primary"
              disabled={notificationSaving}
              onClick={toVoidHandler(handleSaveNotifications)}
            >
              {notificationSaving ? "Saving..." : "Save notifications"}
            </button>
          </div>
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
