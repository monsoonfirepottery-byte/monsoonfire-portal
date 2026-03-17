import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { createPortalApi } from "../api/portalApi";
import type { EventSummary } from "../api/portalContracts";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import { db } from "../firebase";
import { type PortalThemeName } from "../theme/themes";
import { mockFirings, mockKilns } from "../data/kilnScheduleMock";
import { useBatches } from "../hooks/useBatches";
import { shortId, track } from "../lib/analytics";
import { normalizeFiringDoc as normalizeFiringRow, normalizeKilnDoc as normalizeKilnRow } from "../lib/normalizers/kiln";
import {
  normalizeReservationRecord,
  type ReservationRecord,
} from "../lib/normalizers/reservations";
import type { Kiln, KilnFiring } from "../types/kiln";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { formatDateTime, formatMaybeTimestamp } from "../utils/format";
import { DASHBOARD_MOCK_NON_DEV_ACK, resolveDashboardMockPolicy } from "./dashboardMockPolicy";

const DASHBOARD_PIECES_PREVIEW = 3;
const DASHBOARD_WORKSHOP_PREVIEW = 3;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  loading: "Loading",
  firing: "Firing",
  cooling: "Cooling",
  unloading: "Unloading",
  maintenance: "Maintenance",
};

const PRIMARY_KILN_NAME = "L&L eQ2827-3";
const RAKU_KILN_NAME = "Reduction Raku Kiln";

type KilnRow = {
  id: string;
  name: string;
  timeLabel: string;
  statusLabel: string;
  pill: string;
  etaLabel: string;
  firingTypeLabel: string;
  progress: number | null;
  isOffline: boolean;
};

function isPermissionDenied(err: unknown) {
  const message = (err as { message?: string })?.message ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return code === "permission-denied" || /missing or insufficient permissions/i.test(message);
}

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      return maybe.toDate();
    }
  }
  return null;
}

function formatRelativeEta(target: Date, now: Date) {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function inferFiringTypeLabel(value?: string) {
  if (!value) return "Firing";
  const normalized = value.toLowerCase();
  if (normalized.includes("bisque")) return "Bisque";
  if (normalized.includes("glaze")) return "Glaze";
  if (normalized.includes("raku")) return "Raku";
  return "Firing";
}

function resolveFunctionsBaseUrl() {
  return ENV.VITE_FUNCTIONS_BASE_URL ? String(ENV.VITE_FUNCTIONS_BASE_URL) : DEFAULT_FUNCTIONS_BASE_URL;
}

function isMissingIndexError(err: unknown) {
  const code = (err as { code?: unknown })?.code;
  const message = String((err as { message?: unknown })?.message || "");
  return code === "failed-precondition" || /index/i.test(message);
}

function getTimestampMs(value: unknown) {
  const date = coerceDate(value);
  return date ? date.getTime() : 0;
}

function reservationStatusLabel(reservation: ReservationRecord) {
  const status = String(reservation.status || "").toUpperCase();
  if (status === "CONFIRMED") return "Confirmed";
  if (status === "WAITLISTED") return "Waitlisted";
  if (status === "CANCELLED") return "Cancelled";
  const loadStatus = String(reservation.loadStatus || "").toLowerCase();
  if (loadStatus === "loaded") return "Loaded";
  if (loadStatus === "loading") return "Loading";
  return "Queued";
}

function parseWorkshopStartMs(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function workshopAvailabilityLabel(event: EventSummary) {
  const remainingCapacity =
    typeof event.remainingCapacity === "number" && Number.isFinite(event.remainingCapacity)
      ? Math.max(0, Math.round(event.remainingCapacity))
      : null;
  if (remainingCapacity !== null && remainingCapacity > 0) {
    return `${remainingCapacity} spot${remainingCapacity === 1 ? "" : "s"} left`;
  }
  if (event.waitlistEnabled) {
    const waitlistCount =
      typeof event.waitlistCount === "number" && Number.isFinite(event.waitlistCount)
        ? Math.max(0, Math.round(event.waitlistCount))
        : null;
    if (waitlistCount !== null && waitlistCount > 0) {
      return `${waitlistCount} on waitlist`;
    }
    if (remainingCapacity === 0) {
      return "Waitlist open";
    }
  }
  if (remainingCapacity === 0) return "Sold out";
  return "Open registration";
}

function workshopSignalLabel(event: EventSummary) {
  const totalSignals =
    typeof event.communitySignalCounts?.totalSignals === "number" &&
    Number.isFinite(event.communitySignalCounts.totalSignals)
      ? Math.max(0, Math.round(event.communitySignalCounts.totalSignals))
      : 0;
  if (totalSignals <= 0) return null;
  return `${totalSignals} community signal${totalSignals === 1 ? "" : "s"}`;
}

function workshopMetaLabel(event: EventSummary) {
  const dateLabel = formatDateTime(event.startAt);
  const locationLabel = (event.location || "").trim() || "Studio";
  if (dateLabel === "-") return locationLabel;
  return `${dateLabel} · ${locationLabel}`;
}

function useDashboardWorkshopPreview(user: User) {
  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const portalApi = useMemo(() => createPortalApi({ baseUrl }), [baseUrl]);
  const [workshops, setWorkshops] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const loadWorkshops = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await portalApi.listEvents({
          idToken: await user.getIdToken(),
          payload: {
            includeDrafts: false,
            includeCancelled: false,
            includeCommunitySignals: true,
          },
          signal: abortController.signal,
        });
        if (cancelled) return;

        const nowMs = Date.now();
        const nextWorkshops = (response.data.events ?? [])
          .filter((event) => event.status === "published")
          .filter((event) => parseWorkshopStartMs(event.startAt) >= nowMs)
          .sort((left, right) => parseWorkshopStartMs(left.startAt) - parseWorkshopStartMs(right.startAt))
          .slice(0, DASHBOARD_WORKSHOP_PREVIEW);

        setWorkshops(nextWorkshops);
      } catch (_err) {
        if (cancelled || abortController.signal.aborted) return;
        setWorkshops([]);
        setError("Workshop preview unavailable right now.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadWorkshops();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [portalApi, user]);

  return {
    workshops,
    loading,
    error,
  };
}

function useKilnDashboardRows(actor: { uid?: string | null; email?: string | null }) {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [firings, setFirings] = useState<KilnFiring[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const isMountedRef = useRef(true);
  const mockPolicy = useMemo(() => resolveDashboardMockPolicy(), []);
  const blockedMockTrackedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!isMountedRef.current) return;

    setPermissionDenied(false);
    setLoading(true);

    try {
      const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
      const firingsQuery = query(collection(db, "kilnFirings"), orderBy("startAt", "asc"), limit(200));
      const [kilnSnap, firingSnap] = await Promise.all([getDocs(kilnsQuery), getDocs(firingsQuery)]);
      if (!isMountedRef.current) return;
      setKilns(
        kilnSnap.docs.map((docSnap) => ({
          ...normalizeKilnRow(docSnap.id, docSnap.data() as Partial<Kiln>),
        }))
      );
      setFirings(
        firingSnap.docs.map((docSnap) => ({
          ...normalizeFiringRow(docSnap.id, docSnap.data() as Partial<KilnFiring>),
        }))
      );
    } catch (err) {
      if (!isMountedRef.current) return;
      if (isPermissionDenied(err)) {
        setPermissionDenied(true);
        setKilns([]);
        setFirings([]);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void reload();
    return () => {
      isMountedRef.current = false;
    };
  }, [reload]);

  const noData = !loading && !permissionDenied && kilns.length === 0 && firings.length === 0;
  const useMock = mockPolicy.allowed && !permissionDenied && noData;
  const rawKilns = useMock ? mockKilns : kilns;
  const rawFirings = useMock ? mockFirings : firings;
  const showRetry = permissionDenied || (!loading && noData);
  const mockNotice = useMock
    ? mockPolicy.source === "non_dev_acknowledged"
      ? "Sample kiln data mode is active outside development via explicit acknowledgment. Configure backend kiln data to disable this temporary mode."
      : "Using sample kiln data in explicit development-only dashboard mode. Configure backend data sources when available."
    : "";
  const mockPolicyNotice =
    mockPolicy.requested && !mockPolicy.allowed
      ? `Mock kiln data request was blocked outside development. To override intentionally, set VITE_DASHBOARD_MOCK_KILN_DATA_ACK=${DASHBOARD_MOCK_NON_DEV_ACK}.`
      : "";

  const actorUid = shortId(actor.uid);
  const actorEmailDomain =
    typeof actor.email === "string" && actor.email.includes("@")
      ? actor.email.split("@")[1] || null
      : null;

  useEffect(() => {
    if (!useMock) return;
    track("dashboard_kiln_sample_fallback_used", {
      reason: "no_data",
      permissionDenied,
      backendRecordCount: 0,
      actorUid,
      actorEmailDomain,
      envMode: mockPolicy.environmentMode,
      source: mockPolicy.source,
    });
  }, [useMock, permissionDenied, actorEmailDomain, actorUid, mockPolicy.environmentMode, mockPolicy.source]);

  useEffect(() => {
    if (blockedMockTrackedRef.current) return;
    if (!mockPolicy.requested || mockPolicy.allowed) return;
    blockedMockTrackedRef.current = true;
    track("dashboard_kiln_sample_fallback_blocked", {
      actorUid,
      actorEmailDomain,
      envMode: mockPolicy.environmentMode,
      source: mockPolicy.source,
      requiresAcknowledgement: mockPolicy.requiresNonDevAcknowledgement,
    });
  }, [
    actorEmailDomain,
    actorUid,
    mockPolicy.allowed,
    mockPolicy.environmentMode,
    mockPolicy.requested,
    mockPolicy.requiresNonDevAcknowledgement,
    mockPolicy.source,
  ]);

  const statusNotice = permissionDenied
    ? "Unable to load kiln schedules. Permissions may not be configured yet."
    : noData
      ? "No kiln status available yet."
      : loading
        ? "Loading kiln status..."
        : "";

  const primaryKiln =
    rawKilns.find((kiln) => kiln.name === PRIMARY_KILN_NAME) ??
    rawKilns.find((kiln) => /eQ2827|L&L/i.test(kiln.name)) ??
    rawKilns[0];
  const rakuKiln =
    rawKilns.find((kiln) => kiln.name === RAKU_KILN_NAME) ??
    rawKilns.find((kiln) => /raku|reduction/i.test(kiln.name)) ??
    rawKilns[1];

  const displayKilns = [primaryKiln, rakuKiln].filter(
    (kiln, index, arr) => kiln && arr.findIndex((item) => item?.id === kiln?.id) === index
  );

  const normalizedFirings = useMemo(() => {
    return rawFirings
      .map((firing) => {
        const startDate = coerceDate(firing.startAt);
        const endDate = coerceDate(firing.endAt);
        if (!startDate || !endDate) return null;
        return { ...firing, startDate, endDate };
      })
      .filter(Boolean) as Array<KilnFiring & { startDate: Date; endDate: Date }>;
  }, [rawFirings]);

  const nextFiring = useMemo(() => {
    const now = new Date();
    return normalizedFirings
      .filter((firing) => firing.status !== "cancelled" && firing.startDate > now)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  }, [normalizedFirings]);

  const rows: KilnRow[] = useMemo(() => {
    const now = new Date();
    return displayKilns
      .filter(Boolean)
      .map((kiln) => {
        const isRaku = /raku/i.test(kiln.name);
        const isOffline = kiln.status === "offline";
        const active = normalizedFirings.find(
          (firing) =>
            firing.kilnId === kiln.id &&
            firing.status !== "cancelled" &&
            firing.startDate <= now &&
            firing.endDate >= now
        );
        const next = normalizedFirings
          .filter(
            (firing) =>
              firing.kilnId === kiln.id &&
              firing.status !== "cancelled" &&
              firing.startDate > now
          )
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

        const statusLabel = isOffline
          ? "Offline"
          : active
            ? "Firing now"
            : STATUS_LABELS[kiln.status] || "Idle";
        const pill = isOffline
          ? "Offline"
          : active
            ? active.title || active.cycleType || "Firing"
            : next
              ? next.title || next.cycleType || "Scheduled"
              : STATUS_LABELS[kiln.status] || "Idle";
        const etaLabel = isOffline
          ? "Temporarily offline"
          : active
            ? `Ends ${formatRelativeEta(active.endDate, now)}`
          : next
            ? `Starts ${formatRelativeEta(next.startDate, now)}`
            : "No firing scheduled";
        const firingSource = active ?? next;
        const firingTypeLabel = inferFiringTypeLabel(
          firingSource?.title || firingSource?.cycleType || ""
        );
        const timeLabel = isOffline
          ? "Offline"
          : active
            ? `Ends ${formatRelativeEta(active.endDate, now)}`
            : next
              ? `Starts ${formatRelativeEta(next.startDate, now)}`
              : "No start scheduled";
        const progress =
          active && active.endDate.getTime() > active.startDate.getTime()
            ? Math.min(
                1,
                Math.max(
                  0,
                  (now.getTime() - active.startDate.getTime()) /
                    (active.endDate.getTime() - active.startDate.getTime())
                )
              )
            : null;

        return {
          id: kiln.id,
          name: isRaku ? "Raku" : kiln.name,
          timeLabel,
          statusLabel,
          pill,
          etaLabel,
          firingTypeLabel,
          progress,
          isOffline,
        };
      });
  }, [displayKilns, normalizedFirings]);

  const nextFiringLabel = nextFiring
    ? `${formatShortDate(nextFiring.startDate)} · ${nextFiring.title || nextFiring.cycleType || "Firing"}`
    : permissionDenied
      ? "Firing schedule unavailable."
      : "No firings scheduled yet";

  return {
    rows,
    nextFiringLabel,
    statusNotice,
    mockNotice,
    mockPolicyNotice,
    useMock,
    permissionDenied,
    loading,
    reload,
    showRetry,
  };
}

type Props = {
  user: User;
  isStaff?: boolean;
  name: string;
  themeName: PortalThemeName;
  onThemeChange: (next: PortalThemeName) => void;
  threads: DirectMessageThread[];
  announcements: Announcement[];
  onOpenKilnRentals: () => void;
  onOpenCheckin: () => void;
  onOpenQueues: () => void;
  onOpenFirings: () => void;
  onOpenStudioResources: () => void;
  onOpenGlazeBoard: () => void;
  onOpenCommunity: () => void;
  onOpenWorkshops: () => void;
  onOpenMessages: () => void;
  onOpenPieces: (target?: { batchId: string; pieceId?: string }) => void;
};

export default function DashboardView({
  user,
  isStaff = false,
  name,
  themeName,
  onThemeChange,
  threads,
  announcements,
  onOpenKilnRentals,
  onOpenCheckin,
  onOpenQueues,
  onOpenFirings,
  onOpenStudioResources,
  onOpenGlazeBoard,
  onOpenCommunity,
  onOpenWorkshops,
  onOpenMessages,
  onOpenPieces,
}: Props) {
  const { themeName: resolvedThemeName, portalMotion } = useUiSettings();
  const motionEnabled = resolvedThemeName === "memoria" && portalMotion === "enhanced";
  const isDarkTheme = themeName === "memoria";
  const nextTheme = isDarkTheme ? "portal" : "memoria";
  const nextThemeLabel = isDarkTheme ? "light" : "dark";
  const { active, history } = useBatches(user);
  const [recentReservations, setRecentReservations] = useState<ReservationRecord[]>([]);
  const activePreview = active.slice(0, DASHBOARD_PIECES_PREVIEW);
  const archivedCount = history.length;
  const messagePreview = threads.slice(0, 3);
  const announcementPreview = announcements.slice(0, 3);
  const {
    rows: kilnRows,
    nextFiringLabel,
    statusNotice,
    mockNotice,
    mockPolicyNotice,
    showRetry,
    loading: kilnLoading,
    reload: reloadKilns,
  } = useKilnDashboardRows({ uid: user.uid, email: user.email ?? null });
  const queueFillCount = Math.min(8, Math.max(active.length, 0));
  const queueFillRatio = Math.min(1, queueFillCount / 8);
  const averageTurnaroundDays = useMemo(() => {
    const durations = history
      .map((item) => {
        const created = coerceDate(item.createdAt);
        const closed = coerceDate(item.closedAt);
        if (!created || !closed) return null;
        const diffDays = (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays > 0 ? diffDays : null;
      })
      .filter(Boolean) as number[];
    if (durations.length === 0) return null;
    const sample = durations.slice(0, 8);
    const avg = sample.reduce((total, value) => total + value, 0) / sample.length;
    return Math.round(avg);
  }, [history]);
  const nextPiece = activePreview[0];
  const nextPieceStatus = nextPiece?.status || "In progress";
  const nextPieceEta = nextPiece?.updatedAt
    ? formatMaybeTimestamp(nextPiece.updatedAt)
    : "Check back soon";
  const reservationPreview = useMemo(
    () =>
      recentReservations
        .filter((item) => String(item.status || "").toUpperCase() !== "CANCELLED")
        .slice(0, DASHBOARD_PIECES_PREVIEW),
    [recentReservations]
  );
  const nextReservation = reservationPreview[0] ?? null;
  const nextReservationStatus = nextReservation ? reservationStatusLabel(nextReservation) : "Queued";
  const nextReservationEta = nextReservation
    ? formatMaybeTimestamp(nextReservation.createdAt ?? nextReservation.updatedAt)
    : "Check back soon";
  const nextReservationOwnerUid = nextReservation?.ownerUid ?? null;
  const nextReservationOwnerLabel =
    isStaff && nextReservationOwnerUid && nextReservationOwnerUid !== user.uid
      ? shortId(nextReservationOwnerUid)
      : null;
  const kilnEmptyStateLabel = statusNotice || "No kiln status available yet.";
  const {
    workshops: workshopPreview,
    loading: workshopsLoading,
    error: workshopsError,
  } = useDashboardWorkshopPreview(user);
  const workshopSubtitle = useMemo(() => {
    const workshopSignals = workshopPreview.reduce((count, event) => {
      return count + (workshopSignalLabel(event) ? 1 : 0);
    }, 0);
    if (workshopSignals > 0) {
      return "Live availability + community demand";
    }
    return "Live workshop availability";
  }, [workshopPreview]);

  useEffect(() => {
    let cancelled = false;

    const loadReservationsPreview = async () => {
      try {
        const loadByField = async (field: "ownerUid" | "createdByUid", value: string) => {
          try {
            const byCreatedAt = query(
              collection(db, "reservations"),
              where(field, "==", value),
              orderBy("createdAt", "desc"),
              limit(12)
            );
            return await getDocs(byCreatedAt);
          } catch (error: unknown) {
            if (!isMissingIndexError(error)) throw error;
            const fallback = query(collection(db, "reservations"), where(field, "==", value), limit(200));
            return await getDocs(fallback);
          }
        };

        const snapshots = [await loadByField("ownerUid", user.uid)];
        if (isStaff) {
          snapshots.push(await loadByField("createdByUid", user.uid));
        }
        if (cancelled) return;

        const uniqueRows = new Map<string, ReservationRecord>();
        for (const snap of snapshots) {
          for (const docSnap of snap.docs) {
            const normalized = normalizeReservationRecord(
              docSnap.id,
              docSnap.data() as Partial<ReservationRecord>
            );
            uniqueRows.set(normalized.id, normalized);
          }
        }

        const rows = Array.from(uniqueRows.values()).sort((left, right) => {
          const leftMs = getTimestampMs(left.createdAt ?? left.updatedAt);
          const rightMs = getTimestampMs(right.createdAt ?? right.updatedAt);
          if (leftMs !== rightMs) return rightMs - leftMs;
          return right.id.localeCompare(left.id);
        });
        setRecentReservations(rows);
      } catch {
        if (!cancelled) setRecentReservations([]);
      }
    };

    void loadReservationsPreview();
    return () => {
      cancelled = true;
    };
  }, [isStaff, user.uid]);

  return (
    <div className="dashboard">
      <RevealCard as="section" className="card hero-card" index={0} enabled={motionEnabled}>
        <div className="hero-content">
          <div className="hero-toolbar">
            <div className="hero-title-block">
              <h1>Your studio dashboard</h1>
              <div className="hero-profile">
                <span className="hero-profile-label">Signed in as</span>
                <span className="hero-profile-name">{name}</span>
                {user.email ? <span className="hero-profile-meta">{user.email}</span> : null}
              </div>
            </div>
            <button
              type="button"
              className="theme-toggle-button"
              onClick={() => {
                onThemeChange(nextTheme);
              }}
              aria-label={`Switch to ${nextThemeLabel} theme`}
              title={`Switch to ${nextThemeLabel} theme`}
              aria-pressed={isDarkTheme}
            >
              <span className="theme-toggle-icon" aria-hidden="true">
                {isDarkTheme ? "☀️" : "🌙"}
              </span>
              {`Switch to ${nextThemeLabel} theme`}
            </button>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onOpenKilnRentals}>
              Kiln rentals
            </button>
            <button className="btn btn-ghost" onClick={onOpenStudioResources}>
              Studio &amp; resources
            </button>
            <button className="btn btn-ghost" onClick={onOpenCommunity}>
              Community
            </button>
          </div>
        </div>
        <div className="hero-updates">
          <div className="hero-updates-title">Studio updates</div>
          {announcementPreview.length === 0 ? (
            <div className="hero-updates-empty">No studio announcements yet.</div>
          ) : (
            <div className="hero-updates-list">
              {announcementPreview.map((item) => (
                <div className="hero-update" key={item.id}>
                  <div className="hero-update-title">{item.title || "Studio update"}</div>
                  <p className="hero-update-body">{item.body || "Details coming soon."}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </RevealCard>

      <section className="quick-actions">
        <RevealCard className="card card-3d quick-action-card" index={1} enabled={motionEnabled}>
          <div className="card-title">Quick actions</div>
          <div className="quick-action-row">
            <button className="btn btn-primary" onClick={onOpenCheckin}>
              Start a check-in
            </button>
            <button className="btn btn-ghost" onClick={onOpenQueues}>
              View the queues
            </button>
            <button className="btn btn-ghost" onClick={onOpenFirings}>
              Firings
            </button>
            <button className="btn btn-ghost" onClick={onOpenGlazeBoard}>
              Glaze inspiration
            </button>
            <button className="btn btn-ghost" onClick={onOpenMessages}>
              Message the studio
            </button>
          </div>
          <p className="quick-action-note">Pick a lane and we will take it from there.</p>
        </RevealCard>
      </section>

      <section className="dashboard-grid">
        <RevealCard className="card card-3d" index={2} enabled={motionEnabled}>
          <div className="card-title">Your pieces</div>
          <div className="card-subtitle">Personal queue</div>
          {activePreview.length === 0 ? (
            reservationPreview.length > 0 ? (
              <div className="pieces-preview">
                <div className="pieces-next">
                  <div className="pieces-next-label">Latest check-in</div>
                  <div className="pieces-next-title">{nextReservationStatus}</div>
                  <div className="pieces-next-meta">{nextReservationEta}</div>
                </div>
                <div className="pieces-thumbs">
                  {reservationPreview.map((reservation, index) => (
                    <button
                      type="button"
                      key={reservation.id}
                      className="piece-thumb"
                      aria-label={`Open check-in ${reservation.id}`}
                      title={`Check-in ${reservation.id}`}
                      data-index={index + 1}
                      onClick={onOpenCheckin}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
                <div className="pieces-next-meta">Your recent check-ins are queued in ware intake.</div>
              </div>
            ) : (
              <div className="empty-block">
                <div className="empty-state">Nothing in the kiln line yet.</div>
                <div className="empty-meta">Add work to the next firing.</div>
                <button className="btn btn-primary" onClick={onOpenCheckin}>
                  Start a Check-In
                </button>
              </div>
            )
          ) : (
            <div className="pieces-preview">
              <div className="pieces-next">
                <div className="pieces-next-label">Next status</div>
                <div className="pieces-next-title">{nextPieceStatus}</div>
                <div className="pieces-next-meta">{nextPieceEta}</div>
                {nextReservation ? (
                  <div className="pieces-next-meta">
                    Latest check-in queued{nextReservationOwnerLabel ? ` for ${nextReservationOwnerLabel}` : ""}:{" "}
                    {nextReservationStatus} ({nextReservationEta})
                  </div>
                ) : null}
              </div>
              <div className="pieces-thumbs">
                {activePreview.map((piece, index) => {
                  const title = piece.title || "Piece";
                  const initials = title
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((word) => word[0]?.toUpperCase())
                    .join("");
                  return (
                    <button
                      type="button"
                      key={piece.id}
                      className="piece-thumb"
                      aria-label={`Open ${title} in My Pieces`}
                      title={title}
                      data-index={index + 1}
                      onClick={() => onOpenPieces({ batchId: piece.id })}
                    >
                      {initials || "•"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button className="btn btn-ghost dashboard-link" onClick={() => onOpenPieces()}>
            Open My Pieces
          </button>
        </RevealCard>

        <RevealCard className="card card-3d" index={3} enabled={motionEnabled}>
          <div className="card-title">Studio snapshot</div>
          <div className="card-subtitle">Studio-wide status</div>
          <div className="snapshot-grid">
            <div className="snapshot-block">
              <div className="snapshot-label">Next scheduled firing</div>
              <div className="snapshot-value">{nextFiringLabel}</div>
            </div>
            <div className="snapshot-block">
              <div className="snapshot-label">Queue fullness</div>
              <div className="snapshot-value">
                {queueFillCount} / 8 half shelves
              </div>
              <progress
                className="meter"
                value={Math.round(queueFillRatio * 100)}
                max={100}
                aria-label="Queue fullness"
              />
            </div>
            <div className="snapshot-block">
              <div className="snapshot-label">Average turnaround this month</div>
              <div className="snapshot-value">
                {averageTurnaroundDays ? `${averageTurnaroundDays} days` : "We are still collecting data"}
              </div>
            </div>
          </div>
        </RevealCard>

        <RevealCard className="card card-3d" index={4} enabled={motionEnabled}>
          <div className="card-title">Kilns firing now</div>
          {mockNotice ? <div className="notice">{mockNotice}</div> : null}
          {mockPolicyNotice ? (
            <div className="notice" role="status" aria-live="polite">
              {mockPolicyNotice}
            </div>
          ) : null}
          <div className="list">
            {kilnRows.length === 0 ? (
              <div className="empty-state" role="status" aria-live="polite">
                {kilnEmptyStateLabel}
              </div>
            ) : (
              kilnRows.map((kiln) => (
                <div className={`list-row kiln-row ${kiln.isOffline ? "kiln-offline" : ""}`} key={kiln.id}>
                  <div className="kiln-left">
                    <div className="list-title">{kiln.name}</div>
                    <div className="kiln-time" title={`Firing type: ${kiln.firingTypeLabel}`}>
                      {kiln.timeLabel}
                    </div>
                    <div className="list-meta">{kiln.statusLabel}</div>
                  </div>
                  <div className="list-right">
                    <div className="pill">{kiln.pill}</div>
                    <div className="list-meta">{kiln.etaLabel}</div>
                  </div>
                  <progress
                    className="kiln-progress"
                    value={Math.round((kiln.progress ?? 0) * 100)}
                    max={100}
                    aria-label="Kiln progress"
                    aria-hidden="true"
                  />
                </div>
              ))
            )}
          </div>
          {showRetry && !kilnLoading ? (
            <button className="btn btn-secondary" onClick={() => void reloadKilns()} disabled={kilnLoading}>
              Retry loading kiln status
            </button>
          ) : null}
        </RevealCard>

        <RevealCard className="card card-3d" index={5} enabled={motionEnabled}>
          <div className="card-title">Upcoming workshops</div>
          <div className="card-subtitle">{workshopSubtitle}</div>
          {workshopsError ? (
            <div className="notice" role="status" aria-live="polite">
              {workshopsError}
            </div>
          ) : null}
          {workshopsLoading ? (
            <div className="empty-state" role="status" aria-live="polite">
              Loading workshops...
            </div>
          ) : workshopPreview.length === 0 ? (
            <div className="empty-block">
              <div className="empty-state">No upcoming workshops are available right now.</div>
              <div className="empty-meta">Open workshops to see the next studio drop.</div>
            </div>
          ) : (
            <div className="list">
              {workshopPreview.map((item) => {
                const signal = workshopSignalLabel(item);
                return (
                  <div className="list-row workshop-row" key={item.id}>
                    <div>
                      <div className="list-title">{item.title}</div>
                      <div className="list-meta">{workshopMetaLabel(item)}</div>
                      {item.includesFiring || signal ? (
                        <div className="workshop-tags">
                          {item.includesFiring ? <span className="pill pill-muted">Firing included</span> : null}
                          {signal ? <span className="pill pill-muted">{signal}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="workshop-right">
                      <div className="pill">{workshopAvailabilityLabel(item)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button className="btn btn-ghost dashboard-link" onClick={onOpenWorkshops}>
            Open workshops
          </button>
        </RevealCard>

        <RevealCard className="card card-3d" index={6} enabled={motionEnabled}>
          <div className="card-title">Direct messages</div>
          <div className="messages-preview">
            {messagePreview.length === 0 ? (
              <div className="empty-block">
                <div className="empty-state">Questions about your work? We're here.</div>
                <button className="btn btn-ghost btn-small" onClick={onOpenMessages}>
                  Ask the studio
                </button>
              </div>
            ) : (
              messagePreview.map((thread) => (
                <div className="message" key={thread.id}>
                  <div className="message-top">
                    <span className="message-sender">{thread.lastSenderName || "Studio"}</span>
                    <span className="message-subject">{thread.subject || "New message"}</span>
                  </div>
                  <div className="message-preview">
                    {thread.lastMessagePreview || "Start the conversation with the studio."}
                  </div>
                </div>
              ))
            )}
          </div>
          <button className="btn btn-ghost" onClick={onOpenMessages}>
            Open messages inbox
          </button>
        </RevealCard>

        <RevealCard className="card card-3d span-2 archived-summary" index={7} enabled={motionEnabled}>
          <div>
            <div className="card-title">Archived pieces</div>
            <div className="archived-count">
              {archivedCount === 0
                ? "No archived pieces yet."
                : `${archivedCount} piece${archivedCount === 1 ? "" : "s"} archived.`}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => onOpenPieces()}>
            View archived pieces
          </button>
        </RevealCard>
      </section>
    </div>
  );
}
