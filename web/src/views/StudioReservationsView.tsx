import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { User } from "firebase/auth";
import { createPortalApi, PortalApiError } from "../api/portalApi";
import { unwrapPortalData } from "../api/unwrapPortalData";
import { useStudioReservationsData } from "../hooks/useStudioReservationsData";
import { createStudioReservationFeedbackAudio } from "../lib/studioReservationFeedbackAudio";
import { safeReadBoolean, safeStorageGetItem, safeStorageSetItem } from "../lib/safeStorage";
import {
  STUDIO_TIME_ZONE,
  addStudioDays,
  buildStudioSpaceWeekSummaries,
  formatStudioDateLabel,
  formatStudioTimeLabel,
  formatStudioTimeRange,
  studioDateKeyToDate,
  studioPhoenixDateKey,
  type StudioCalendarEntryRecord,
  type StudioReservationRecord,
  type StudioSpaceWeekSummary,
} from "../lib/studioReservations";
import { buildStudioReservationsPath, parseStudioReservationsSearch } from "../utils/reservationsPaths";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./StudioReservationsView.css";

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
  onOpenStaffWorkspace?: (target: string) => void;
  onOpenWareCheckIn?: () => void;
};

type RowSurface = "feature" | "list";

type RecentBooking = {
  reservationId: string | null;
  kind: "booked" | "waitlisted";
  spaceName: string;
  startAtDate: Date | null;
  endAtDate: Date | null;
};

type BookingFeedbackKind = "reserve" | "waitlist" | "cancel";

type BookingFeedbackPhase = "submitting" | "success" | "error";

type BookingFeedbackState = {
  targetId: string;
  kind: BookingFeedbackKind;
  phase: BookingFeedbackPhase;
  message?: string;
  staleAvailability?: boolean;
};

const DEFAULT_STATUS_MESSAGE = "";
const HORIZON_DAYS = 14;
const PRIMARY_OPENING_LIMIT = 4;
const LAST_USED_SPACE_STORAGE_KEY = "mf_studio_reservations_last_space";
const SOUND_ENABLED_STORAGE_KEY = "mf:studioReservationsSoundEnabled";
const SUCCESS_FEEDBACK_MS = 2200;
const CANCEL_FEEDBACK_MS = 1600;
const WHEEL_CONFIRMATION_BEAT_MS = 650;

function makeTodayKey() {
  return studioPhoenixDateKey(new Date());
}

function readStoredSpaceId() {
  return safeStorageGetItem("localStorage", LAST_USED_SPACE_STORAGE_KEY)?.trim() || "";
}

function readSoundPreference() {
  return safeReadBoolean("localStorage", SOUND_ENABLED_STORAGE_KEY, true);
}

function startOfStudioDayIso(dayKey: string): string {
  return studioDateKeyToDate(dayKey).toISOString();
}

function endOfStudioHorizonIso(dayKey: string): string {
  const nextKey = addStudioDays(dayKey, HORIZON_DAYS);
  return studioDateKeyToDate(nextKey).toISOString();
}

function upcomingReservations(rows: StudioReservationRecord[]): StudioReservationRecord[] {
  return rows
    .filter((row) => row.status !== "cancelled")
    .sort((left, right) => {
      const leftMs = left.startAtDate?.getTime() ?? 0;
      const rightMs = right.startAtDate?.getTime() ?? 0;
      return leftMs - rightMs;
    });
}

function formatHorizonLabel(anchorDayKey: string) {
  const start = studioDateKeyToDate(anchorDayKey);
  const end = studioDateKeyToDate(addStudioDays(anchorDayKey, HORIZON_DAYS - 1));
  return `${formatStudioDateLabel(start, { month: "short", day: "numeric" })} - ${formatStudioDateLabel(end, {
    month: "short",
    day: "numeric",
  })}`;
}

function formatBrowseDayLabel(dayKey: string) {
  const date = studioDateKeyToDate(dayKey);
  return formatStudioDateLabel(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatActionMoment(entry: StudioCalendarEntryRecord) {
  const dayLabel = formatStudioDateLabel(entry.startAtDate, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dayLabel} · ${formatStudioTimeLabel(entry.startAtDate)}`;
}

function isProbablyCssColor(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^(#|rgb|hsl|oklch|oklab|lab|lch|color\(|var\()/i.test(value.trim());
}

function accentStyle(value: string | null | undefined): CSSProperties | undefined {
  if (!isProbablyCssColor(value)) return undefined;
  return {
    "--studio-space-accent": value,
  } as CSSProperties;
}

function reservationSummary(reservation: StudioReservationRecord) {
  if ((reservation.assignedResourceIds ?? []).length > 0) {
    return `Resources: ${(reservation.assignedResourceIds ?? []).join(", ")}`;
  }
  return `${reservation.quantity} ${reservation.quantity === 1 ? "spot" : "spots"} reserved`;
}

function entryAvailabilityCopy(entry: StudioCalendarEntryRecord) {
  if (entry.kind !== "availability") {
    return entry.description ?? "Read-only calendar item.";
  }

  if (entry.status === "full") {
    return "Currently full. Waitlist available.";
  }

  if (entry.bookingMode === "resource") {
    const availableCount = entry.availableResourceIds.length || entry.availableCount || 0;
    return `${availableCount} ${availableCount === 1 ? "wheel" : "wheels"} open`;
  }

  const availableCount = entry.availableCount ?? 0;
  if (availableCount <= 2) {
    return `${availableCount} ${availableCount === 1 ? "spot" : "spots"} left`;
  }

  return `${availableCount} spots open`;
}

function primaryActionLabel(entry: StudioCalendarEntryRecord, surface: RowSurface) {
  if (entry.myReservationId) return "Booked";
  if (entry.myWaitlistId) return "On waitlist";
  if (entry.status === "full") return "Join waitlist";
  if (entry.bookingMode === "resource") return "Choose wheel";
  if (surface === "feature") return `Book ${formatActionMoment(entry)}`;
  return "Book";
}

function formatSpaceHint(summary: StudioSpaceWeekSummary) {
  if (summary.nextOpenEntry) {
    return `Next ${formatActionMoment(summary.nextOpenEntry)}`;
  }
  if (summary.fullEntryCount > 0) {
    return "Waitlist only in the next 14 days";
  }
  return "No openings in the next 14 days";
}

function formatRecentBookingMessage(booking: RecentBooking) {
  const label = `${booking.spaceName} · ${formatStudioDateLabel(booking.startAtDate, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} · ${formatStudioTimeRange(booking.startAtDate, booking.endAtDate)}`;
  return booking.kind === "waitlisted" ? `Added to the waitlist for ${label}.` : `Booked ${label}.`;
}

function readPortalMotionMode(): "enhanced" | "reduced" {
  if (typeof document !== "undefined") {
    const configured = document.documentElement.dataset.portalMotion;
    if (configured === "enhanced" || configured === "reduced") {
      return configured;
    }
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "enhanced";
  }
  return "enhanced";
}

function isStaleAvailabilityMessage(message: string, code?: string | undefined) {
  const normalizedCode = code?.toUpperCase();
  if (normalizedCode === "CONFLICT" || normalizedCode === "FAILED_PRECONDITION") return true;
  const lower = message.toLowerCase();
  return (
    lower.includes("no longer available") ||
    lower.includes("just booked") ||
    lower.includes("just taken") ||
    lower.includes("already booked") ||
    lower.includes("slot is full") ||
    lower.includes("opening is full") ||
    lower.includes("is full")
  );
}

function describeBookingFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Request failed");
  const code =
    error instanceof PortalApiError
      ? error.meta.code ?? error.appError?.code
      : error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code?: string }).code ?? undefined)
        : undefined;
  const staleAvailability = isStaleAvailabilityMessage(message, code);
  return {
    message: staleAvailability ? "That opening just changed. Pick another time and try again." : message,
    staleAvailability,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function SoundToggleIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3.75 9.75h4.1l4.35-3.7a.75.75 0 0 1 1.24.57v10.76a.75.75 0 0 1-1.24.57l-4.35-3.7h-4.1A1.75 1.75 0 0 1 2 12a1.75 1.75 0 0 1 1.75-2.25Z"
        fill="currentColor"
      />
      {muted ? (
        <path
          d="M16.2 8.2 21 13m0-4.8L16.2 13"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ) : (
        <>
          <path
            d="M16.6 9.1a4.4 4.4 0 0 1 0 5.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <path
            d="M19.4 6.4a8 8 0 0 1 0 11.2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </>
      )}
    </svg>
  );
}

export default function StudioReservationsView({
  user,
  adminToken,
  isStaff,
  onOpenStaffWorkspace,
  onOpenWareCheckIn,
}: Props) {
  const initialSearch =
    typeof window === "undefined" ? { dateKey: null, spaceId: null } : parseStudioReservationsSearch(window.location.search);
  const [anchorDayKey, setAnchorDayKey] = useState<string>(initialSearch.dateKey ?? makeTodayKey());
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(initialSearch.spaceId ?? readStoredSpaceId());
  const [selectedBrowseDayKey, setSelectedBrowseDayKey] = useState<string>(initialSearch.dateKey ?? "");
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [status, setStatus] = useState(DEFAULT_STATUS_MESSAGE);
  const [error, setError] = useState("");
  const [showBrowse, setShowBrowse] = useState(Boolean(initialSearch.dateKey));
  const [showAlternateTimes, setShowAlternateTimes] = useState(false);
  const [showManageReservations, setShowManageReservations] = useState(false);
  const [recentBooking, setRecentBooking] = useState<RecentBooking | null>(null);
  const [entryFeedback, setEntryFeedback] = useState<BookingFeedbackState | null>(null);
  const [reservationFeedback, setReservationFeedback] = useState<BookingFeedbackState | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => readSoundPreference());
  const [statusKey, setStatusKey] = useState(0);
  const [errorKey, setErrorKey] = useState(0);
  const [recentBookingKey, setRecentBookingKey] = useState(0);

  const api = useMemo(() => createPortalApi(), []);
  const rangeStartIso = useMemo(() => startOfStudioDayIso(anchorDayKey), [anchorDayKey]);
  const rangeFinishIso = useMemo(() => endOfStudioHorizonIso(anchorDayKey), [anchorDayKey]);
  const { spaces, entries, myReservations, timezone, generatedDefaults, loading, error: loadError, reload } =
    useStudioReservationsData({
      user,
      adminToken,
      rangeStartIso,
      rangeEndIso: rangeFinishIso,
      spaceIds: [],
    });

  const browseRef = useRef<HTMLElement | null>(null);
  const reservationsRef = useRef<HTMLDetailsElement | null>(null);
  const feedbackTimeoutIdsRef = useRef<number[]>([]);
  const feedbackAudioRef = useRef<ReturnType<typeof createStudioReservationFeedbackAudio> | null>(null);

  if (!feedbackAudioRef.current) {
    feedbackAudioRef.current = createStudioReservationFeedbackAudio();
  }

  const upcoming = useMemo(() => upcomingReservations(myReservations), [myReservations]);
  const nextUpcoming = upcoming[0] ?? null;
  const horizonDayKeys = useMemo(
    () => Array.from({ length: HORIZON_DAYS }, (_, index) => addStudioDays(anchorDayKey, index)),
    [anchorDayKey]
  );
  const spaceSummaries = useMemo(
    () => buildStudioSpaceWeekSummaries(spaces, entries, horizonDayKeys, PRIMARY_OPENING_LIMIT),
    [entries, horizonDayKeys, spaces]
  );
  const selectedSummary = useMemo(
    () => spaceSummaries.find((summary) => summary.space.id === selectedSpaceId) ?? spaceSummaries[0] ?? null,
    [selectedSpaceId, spaceSummaries]
  );
  const selectedSpace = selectedSummary?.space ?? null;
  const featuredEntry = selectedSummary?.featuredEntry ?? null;
  const alternateEntries = selectedSummary?.alternateEntries ?? [];
  const browseDays = selectedSummary?.browseDays ?? [];
  const waitlistOnlyDays = selectedSummary?.waitlistOnlyDays ?? [];
  const hasSelectableEntries = selectedSummary?.hasSelectableEntries ?? false;
  const activeBrowseDays = browseDays.length > 0 ? browseDays : waitlistOnlyDays;
  const featuredDayKey = featuredEntry?.startAtDate ? studioPhoenixDateKey(featuredEntry.startAtDate) : "";
  const selectedBrowseDay = useMemo(() => {
    if (selectedBrowseDayKey) {
      const exact = activeBrowseDays.find((day) => day.dayKey === selectedBrowseDayKey);
      if (exact) return exact;
    }
    if (featuredDayKey) {
      const featuredDay = activeBrowseDays.find((day) => day.dayKey === featuredDayKey);
      if (featuredDay) return featuredDay;
    }
    return activeBrowseDays[0] ?? null;
  }, [activeBrowseDays, featuredDayKey, selectedBrowseDayKey]);
  const selectedBrowseEntries = useMemo(() => {
    if (!selectedBrowseDay) return [];
    return selectedBrowseDay.openEntries.length > 0 ? selectedBrowseDay.openEntries : selectedBrowseDay.entries;
  }, [selectedBrowseDay]);
  const expandedEntry = useMemo(
    () => entries.find((entry) => entry.id === expandedEntryId && entry.kind === "availability" && entry.status !== "blocked") ?? null,
    [entries, expandedEntryId]
  );
  const expandedEntrySpace = expandedEntry ? spaces.find((space) => space.id === expandedEntry.spaceId) ?? selectedSpace : selectedSpace;
  const activeDateKey = selectedBrowseDayKey || featuredDayKey || anchorDayKey;

  useEffect(() => {
    if (spaceSummaries.length === 0) return;
    if (selectedSpaceId && spaceSummaries.some((summary) => summary.space.id === selectedSpaceId)) return;
    setSelectedSpaceId(spaceSummaries[0].space.id);
  }, [selectedSpaceId, spaceSummaries]);

  useEffect(() => {
    if (!selectedSummary?.space.id) return;
    safeStorageSetItem("localStorage", LAST_USED_SPACE_STORAGE_KEY, selectedSummary.space.id);
  }, [selectedSummary]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextPath = buildStudioReservationsPath({
      dateKey: activeDateKey,
      spaceId: selectedSummary?.space.id ?? null,
    });
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== nextPath) {
      window.history.replaceState({}, "", nextPath);
    }
  }, [activeDateKey, selectedSummary]);

  useEffect(() => {
    const availableDayKeys = activeBrowseDays.map((day) => day.dayKey);
    if (availableDayKeys.length === 0) {
      if (selectedBrowseDayKey) {
        setSelectedBrowseDayKey("");
      }
      return;
    }

    const nextDayKey =
      (selectedBrowseDayKey && availableDayKeys.includes(selectedBrowseDayKey) && selectedBrowseDayKey) ||
      (featuredDayKey && availableDayKeys.includes(featuredDayKey) && featuredDayKey) ||
      availableDayKeys[0] ||
      "";

    if (nextDayKey !== selectedBrowseDayKey) {
      setSelectedBrowseDayKey(nextDayKey);
    }
  }, [activeBrowseDays, featuredDayKey, selectedBrowseDayKey]);

  useEffect(() => {
    if (!expandedEntry) return;
    if (selectedSummary && expandedEntry.spaceId !== selectedSummary.space.id) {
      setExpandedEntryId(null);
      setSelectedResourceIds([]);
    }
  }, [expandedEntry, selectedSummary]);

  useEffect(() => {
    setShowAlternateTimes(false);
  }, [anchorDayKey, selectedSummary?.space.id]);

  useEffect(() => {
    if (!showManageReservations) return;
    reservationsRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [showManageReservations]);

  useEffect(() => {
    if (!showBrowse) return;
    browseRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [showBrowse]);

  useEffect(() => {
    safeStorageSetItem("localStorage", SOUND_ENABLED_STORAGE_KEY, soundEnabled ? "1" : "0");
  }, [soundEnabled]);

  useEffect(
    () => () => {
      feedbackTimeoutIdsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      feedbackTimeoutIdsRef.current = [];
      feedbackAudioRef.current?.dispose();
    },
    []
  );

  const resetExpandedEntry = () => {
    setExpandedEntryId(null);
    setSelectedResourceIds([]);
  };

  const clearFeedbackTimeouts = () => {
    feedbackTimeoutIdsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    feedbackTimeoutIdsRef.current = [];
  };

  const clearActionFeedback = () => {
    clearFeedbackTimeouts();
    setEntryFeedback(null);
    setReservationFeedback(null);
  };

  const scheduleFeedbackReset = (
    target: "entry" | "reservation",
    targetId: string,
    durationMs: number
  ) => {
    const timeoutId = window.setTimeout(() => {
      if (target === "entry") {
        setEntryFeedback((current) => (current?.targetId === targetId && current.phase === "success" ? null : current));
        return;
      }
      setReservationFeedback((current) =>
        current?.targetId === targetId && current.phase === "success" ? null : current
      );
    }, durationMs);
    feedbackTimeoutIdsRef.current.push(timeoutId);
  };

  const primeFeedbackAudio = () => {
    if (!soundEnabled) return;
    feedbackAudioRef.current?.prime();
  };

  const playFeedbackAudio = (tone: "success" | "error" | "cancel") => {
    if (!soundEnabled) return;
    feedbackAudioRef.current?.play(tone);
  };

  const handleSetAnchorDayKey = (nextDayKey: string) => {
    setAnchorDayKey(nextDayKey);
    setSelectedBrowseDayKey(nextDayKey);
    setError("");
    setStatus("");
    clearActionFeedback();
    resetExpandedEntry();
  };

  const handleShowLaterOpenings = () => {
    const nextAnchor = addStudioDays(anchorDayKey, HORIZON_DAYS);
    setShowBrowse(true);
    handleSetAnchorDayKey(nextAnchor);
  };

  const handleSelectSpace = (nextSpaceId: string) => {
    setSelectedSpaceId(nextSpaceId);
    setSelectedBrowseDayKey("");
    setError("");
    setStatus("");
    clearActionFeedback();
    setShowBrowse(false);
    resetExpandedEntry();
  };

  const handleSelectBrowseDay = (dayKey: string) => {
    setSelectedBrowseDayKey(dayKey);
    clearActionFeedback();
    setShowBrowse(true);
    resetExpandedEntry();
  };

  const openEntryPanel = (entry: StudioCalendarEntryRecord) => {
    if (expandedEntryId === entry.id) {
      resetExpandedEntry();
      return;
    }
    setExpandedEntryId(entry.id);
    if (entry.bookingMode === "resource") {
      setSelectedResourceIds(entry.availableResourceIds.slice(0, 1));
    } else {
      setSelectedResourceIds([]);
    }
  };

  const createBooking = async ({
    entry,
    quantity,
    resourceIds,
    bookingNote,
  }: {
    entry: StudioCalendarEntryRecord;
    quantity?: number;
    resourceIds?: string[];
    bookingNote?: string | null;
  }) => {
    if (!entry.spaceId) return;
    if (busyAction) return;
    primeFeedbackAudio();
    clearActionFeedback();
    setBusyAction(`reserve:${entry.id}`);
    setError("");
    setStatus("");
    setEntryFeedback({
      targetId: entry.id,
      kind: "reserve",
      phase: "submitting",
      message: "Submitting reservation...",
    });
    try {
      const idToken = await user.getIdToken();
      const response = await api.createStudioReservation({
        idToken,
        adminToken,
        payload: {
          spaceId: entry.spaceId,
          startAt: entry.startAt,
          endAt: entry.endAt,
          quantity,
          resourceIds,
          note: bookingNote ?? null,
          clientRequestId: `${entry.id}:${Date.now()}`,
        },
      });
      const payload = unwrapPortalData(response.data);
      setRecentBooking({
        reservationId: payload?.reservationId ?? null,
        kind: "booked",
        spaceName: entry.spaceName ?? selectedSpace?.name ?? "Studio reservation",
        startAtDate: entry.startAtDate,
        endAtDate: entry.endAtDate,
      });
      setRecentBookingKey((current) => current + 1);
      setEntryFeedback({
        targetId: entry.id,
        kind: "reserve",
        phase: "success",
        message: "Reservation confirmed.",
      });
      playFeedbackAudio("success");
      setNote("");
      scheduleFeedbackReset("entry", entry.id, SUCCESS_FEEDBACK_MS);
      if (entry.bookingMode === "resource" && readPortalMotionMode() === "enhanced") {
        await delay(WHEEL_CONFIRMATION_BEAT_MS);
      }
      resetExpandedEntry();
      await reload();
    } catch (err: unknown) {
      const failure = describeBookingFailure(err);
      setEntryFeedback({
        targetId: entry.id,
        kind: "reserve",
        phase: "error",
        message: failure.message,
        staleAvailability: failure.staleAvailability,
      });
      playFeedbackAudio("error");
    } finally {
      setBusyAction("");
    }
  };

  const joinWaitlist = async (entry: StudioCalendarEntryRecord) => {
    if (!entry.spaceId) return;
    if (busyAction) return;
    primeFeedbackAudio();
    clearActionFeedback();
    setBusyAction(`waitlist:${entry.id}`);
    setError("");
    setStatus("");
    setEntryFeedback({
      targetId: entry.id,
      kind: "waitlist",
      phase: "submitting",
      message: "Joining the waitlist...",
    });
    try {
      const idToken = await user.getIdToken();
      const response = await api.joinStudioReservationWaitlist({
        idToken,
        adminToken,
        payload: {
          spaceId: entry.spaceId,
          startAt: entry.startAt,
          endAt: entry.endAt,
          quantity: 1,
          note: note.trim() || null,
          clientRequestId: `${entry.id}:waitlist:${Date.now()}`,
        },
      });
      const payload = unwrapPortalData(response.data);
      setRecentBooking({
        reservationId: payload?.reservationId ?? null,
        kind: "waitlisted",
        spaceName: entry.spaceName ?? selectedSpace?.name ?? "Studio reservation",
        startAtDate: entry.startAtDate,
        endAtDate: entry.endAtDate,
      });
      setRecentBookingKey((current) => current + 1);
      setEntryFeedback({
        targetId: entry.id,
        kind: "waitlist",
        phase: "success",
        message: "Waitlist joined.",
      });
      playFeedbackAudio("success");
      setNote("");
      resetExpandedEntry();
      scheduleFeedbackReset("entry", entry.id, SUCCESS_FEEDBACK_MS);
      await reload();
    } catch (err: unknown) {
      const failure = describeBookingFailure(err);
      setEntryFeedback({
        targetId: entry.id,
        kind: "waitlist",
        phase: "error",
        message: failure.message,
        staleAvailability: failure.staleAvailability,
      });
      playFeedbackAudio("error");
    } finally {
      setBusyAction("");
    }
  };

  const handleReserveExpandedEntry = async () => {
    if (!expandedEntry) return;
    if (expandedEntry.bookingMode !== "resource") return;
    if (selectedResourceIds.length === 0) {
      setError("Choose at least one wheel before reserving.");
      return;
    }
    await createBooking({
      entry: expandedEntry,
      resourceIds: selectedResourceIds,
      bookingNote: note.trim() || null,
    });
  };

  const handleQuickReserve = async (entry: StudioCalendarEntryRecord) => {
    await createBooking({
      entry,
      quantity: 1,
      bookingNote: note.trim() || null,
    });
  };

  const handleCancelReservation = async (reservationId: string) => {
    if (busyAction) return;
    clearActionFeedback();
    primeFeedbackAudio();
    setBusyAction(`cancel:${reservationId}`);
    setError("");
    setReservationFeedback({
      targetId: reservationId,
      kind: "cancel",
      phase: "submitting",
      message: "Canceling reservation...",
    });
    try {
      const idToken = await user.getIdToken();
      await api.cancelStudioReservation({
        idToken,
        adminToken,
        payload: { reservationId },
      });
      if (recentBooking?.reservationId === reservationId) {
        const recentBookingClearTimeout = window.setTimeout(() => {
          setRecentBooking((current) => (current?.reservationId === reservationId ? null : current));
        }, readPortalMotionMode() === "enhanced" ? 900 : 0);
        feedbackTimeoutIdsRef.current.push(recentBookingClearTimeout);
      }
      setReservationFeedback({
        targetId: reservationId,
        kind: "cancel",
        phase: "success",
        message: "Reservation canceled.",
      });
      playFeedbackAudio("cancel");
      scheduleFeedbackReset("reservation", reservationId, CANCEL_FEEDBACK_MS);
      setStatus("Reservation canceled.");
      setStatusKey((current) => current + 1);
      await reload();
    } catch (err: unknown) {
      const failure = describeBookingFailure(err);
      setReservationFeedback({
        targetId: reservationId,
        kind: "cancel",
        phase: "error",
        message: failure.message,
        staleAvailability: failure.staleAvailability,
      });
      setError(failure.message);
      setErrorKey((current) => current + 1);
      playFeedbackAudio("error");
    } finally {
      setBusyAction("");
    }
  };

  const handleToggleResource = (resourceId: string) => {
    setSelectedResourceIds((current) => (current[0] === resourceId ? [] : [resourceId]));
  };

  const renderExpandedEntry = (entry: StudioCalendarEntryRecord) => {
    if (expandedEntryId !== entry.id || entry.bookingMode !== "resource" || !expandedEntrySpace) return null;

    const primaryBusy = busyAction === `reserve:${entry.id}` || busyAction === `waitlist:${entry.id}`;
    const feedback = entryFeedback?.targetId === entry.id ? entryFeedback : null;

    return (
      <div
        className="studio-inline-panel"
        style={accentStyle(expandedEntrySpace.colorToken)}
        data-feedback-phase={feedback?.phase ?? "idle"}
        data-feedback-kind={feedback?.kind ?? ""}
      >
        <div className="studio-inline-panel-head">
          <div>
            <div className="studio-inline-panel-title">Choose your wheel</div>
            <div className="studio-inline-panel-copy">{entryAvailabilityCopy(entry)}</div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={resetExpandedEntry}>
            Close
          </button>
        </div>
        {expandedEntrySpace.memberHelpText ? (
          <div className="studio-inline-panel-note">{expandedEntrySpace.memberHelpText}</div>
        ) : null}
        <div className="studio-inline-field">
          <span>Available wheels</span>
          <div className="studio-resource-chip-list">
            {expandedEntrySpace.resources.map((resource) => {
              const available = entry.availableResourceIds.includes(resource.id);
              const active = selectedResourceIds.includes(resource.id);
              return (
                <button
                  key={resource.id}
                  type="button"
                  className={`studio-resource-chip ${active ? "active" : ""}`}
                  disabled={!available}
                  onClick={() => handleToggleResource(resource.id)}
                >
                  <span>{resource.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="studio-inline-actions">
          <button
            className="btn btn-primary studio-action-button"
            type="button"
            onClick={toVoidHandler(handleReserveExpandedEntry)}
            disabled={primaryBusy || selectedResourceIds.length === 0}
            data-feedback-phase={feedback?.phase ?? "idle"}
          >
            {feedback?.phase === "success"
              ? "Wheel booked"
              : primaryBusy
                ? "Booking..."
                : "Reserve selected wheel"}
          </button>
        </div>
        {feedback?.phase !== "submitting" && feedback?.message ? (
          <div
            className={`studio-action-feedback ${feedback.phase === "error" ? "status-error" : "status-success"}`}
            role={feedback.phase === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        ) : null}
      </div>
    );
  };

  const renderTimeRow = (entry: StudioCalendarEntryRecord, surface: RowSurface) => {
    const isFull = entry.status === "full";
    const isResourceBooking = entry.bookingMode === "resource";
    const isBooked = Boolean(entry.myReservationId);
    const isWaitlisted = Boolean(entry.myWaitlistId);
    const reserveBusy = busyAction === `reserve:${entry.id}`;
    const waitlistBusy = busyAction === `waitlist:${entry.id}`;
    const feedback = entryFeedback?.targetId === entry.id ? entryFeedback : null;
    const actionLabel =
      feedback?.phase === "success"
        ? feedback.kind === "waitlist"
          ? "Waitlisted"
          : isResourceBooking
            ? "Wheel booked"
            : "Booked"
        : primaryActionLabel(entry, surface);

    return (
      <article
        key={`${surface}:${entry.id}`}
        className={`studio-time-row ${surface === "feature" ? "studio-time-row-feature" : ""} ${isFull ? "status-full" : ""}`}
        style={surface === "feature" ? accentStyle(selectedSpace?.colorToken) : undefined}
        data-feedback-phase={feedback?.phase ?? "idle"}
        data-feedback-kind={feedback?.kind ?? ""}
        data-feedback-stale={feedback?.staleAvailability ? "true" : undefined}
      >
        <div className="studio-time-row-meta">
          <div className="studio-time-row-day">
            {formatStudioDateLabel(entry.startAtDate, {
              weekday: surface === "feature" ? "long" : "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className="studio-time-row-time">{formatStudioTimeRange(entry.startAtDate, entry.endAtDate)}</div>
          <div className="studio-time-row-copy">{entryAvailabilityCopy(entry)}</div>
        </div>
        <div className="studio-time-row-actions">
          {isFull ? (
            <button
              className="btn btn-secondary studio-action-button"
              type="button"
              onClick={toVoidHandler(() => joinWaitlist(entry))}
              disabled={waitlistBusy || isWaitlisted}
              data-feedback-phase={feedback?.phase ?? "idle"}
            >
              {isWaitlisted ? "On waitlist" : waitlistBusy ? "Joining..." : actionLabel}
            </button>
          ) : isResourceBooking ? (
            <button
              className="btn btn-primary studio-action-button"
              type="button"
              onClick={() => openEntryPanel(entry)}
              disabled={isBooked}
              data-feedback-phase={feedback?.phase ?? "idle"}
            >
              {actionLabel}
            </button>
          ) : (
            <button
              className="btn btn-primary studio-action-button"
              type="button"
              onClick={toVoidHandler(() => handleQuickReserve(entry))}
              disabled={reserveBusy || isBooked}
              data-feedback-phase={feedback?.phase ?? "idle"}
            >
              {isBooked ? "Booked" : reserveBusy ? "Booking..." : actionLabel}
            </button>
          )}
        </div>
        {renderExpandedEntry(entry)}
        {feedback?.phase !== "submitting" && feedback?.message ? (
          <div
            className={`studio-action-feedback ${feedback.phase === "error" ? "status-error" : "status-success"}`}
            role={feedback.phase === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        ) : null}
      </article>
    );
  };

  const renderEmptyState = () => {
    if (!selectedSpace) {
      return (
        <div className="studio-booker-empty">
          <div className="studio-booker-empty-title">Loading openings...</div>
        </div>
      );
    }

    if (waitlistOnlyDays.length > 0) {
      return (
        <div className="studio-booker-empty">
          <div className="studio-booker-empty-title">The next 14 days are full for {selectedSpace.name}</div>
          <div className="studio-day-empty">
            You can still browse waitlist days below or skip ahead to later openings.
          </div>
          <div className="studio-inline-actions">
            <button className="btn btn-primary" type="button" onClick={() => setShowBrowse(true)}>
              Join a waitlist
            </button>
            <button className="btn btn-ghost" type="button" onClick={handleShowLaterOpenings}>
              Show later openings
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="studio-booker-empty">
        <div className="studio-booker-empty-title">No open time for {selectedSpace.name} in the next 14 days</div>
        <div className="studio-day-empty">
          Skip ahead to later openings or switch spaces if you need something sooner.
        </div>
        <div className="studio-inline-actions">
          <button className="btn btn-primary" type="button" onClick={handleShowLaterOpenings}>
            Show later openings
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page studio-reservations-page">
      <section className="card card-3d studio-reservations-header">
        <div className="studio-reservations-header-copy">
          <div className="studio-reservations-eyebrow">Reservations</div>
          <h1>Reserve studio time</h1>
          <p className="page-subtitle">
            Choose a space, then book an exact opening without working through a calendar first.
          </p>
        </div>
        <div className="studio-reservations-header-side">
          <div className="studio-reservations-next-card">
            <div className="studio-reservations-eyebrow">{nextUpcoming ? "Next booking" : "Ready when you are"}</div>
            {nextUpcoming ? (
              <>
                <div className="studio-reservations-next-title">{nextUpcoming.spaceName}</div>
                <div className="studio-reservations-next-copy">
                  {formatStudioDateLabel(nextUpcoming.startAtDate, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  · {formatStudioTimeRange(nextUpcoming.startAtDate, nextUpcoming.endAtDate)}
                </div>
              </>
            ) : (
              <div className="studio-reservations-next-copy">Pick a space below to see the next available openings.</div>
            )}
          </div>
          <div className="studio-reservations-header-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setShowManageReservations(true)}>
              Manage reservations
            </button>
            {onOpenWareCheckIn ? (
              <button className="btn btn-ghost" type="button" onClick={onOpenWareCheckIn}>
                Ware Check-in
              </button>
            ) : null}
            {isStaff && onOpenStaffWorkspace ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => onOpenStaffWorkspace("/staff/cockpit/studio-reservations")}
              >
                Manage in Staff
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {generatedDefaults ? (
        <div className="card card-3d notice" role="status">
          Using the starter reservation inventory until staff customizes the reservation inventory.
        </div>
      ) : null}
      {loadError ? (
        <div className="card card-3d alert" role="alert">
          {loadError}
        </div>
      ) : null}
      {error ? (
        <div key={`error:${errorKey}`} className="card card-3d alert studio-feedback-banner" role="alert">
          {error}
        </div>
      ) : null}
      {status ? (
        <div key={`status:${statusKey}`} className="card card-3d notice studio-feedback-banner" role="status">
          {status}
        </div>
      ) : null}
      {recentBooking ? (
        <div
          key={`recent:${recentBookingKey}`}
          className="card card-3d notice studio-recent-booking studio-feedback-banner"
          role="status"
          data-feedback-phase="success"
          data-feedback-kind={recentBooking.kind}
        >
          <span>{formatRecentBookingMessage(recentBooking)}</span>
          {recentBooking.kind === "booked" && recentBooking.reservationId ? (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={toVoidHandler(() => handleCancelReservation(recentBooking.reservationId!))}
              disabled={busyAction === `cancel:${recentBooking.reservationId}`}
            >
              {busyAction === `cancel:${recentBooking.reservationId}` ? "Canceling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="card card-3d studio-space-rail-card">
        <div className="studio-space-rail-head">
          <div className="card-title">Choose a space</div>
          <span className="studio-space-rail-copy">{timezone || STUDIO_TIME_ZONE}</span>
        </div>
        <div className="studio-space-switcher-list">
          {spaceSummaries.map((summary) => (
            <button
              key={summary.space.id}
              type="button"
              className={`studio-space-option ${selectedSummary?.space.id === summary.space.id ? "active" : ""}`}
              style={accentStyle(summary.space.colorToken)}
              onClick={() => handleSelectSpace(summary.space.id)}
            >
              <span className="studio-space-option-name">{summary.space.name}</span>
              <span className="studio-space-option-hint">{formatSpaceHint(summary)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card card-3d studio-quick-book-card">
        <div className="studio-quick-book-head">
          <div>
            <div className="studio-reservations-eyebrow">Best next opening</div>
            <div className="studio-quick-book-title">{selectedSpace?.name ?? "Loading spaces..."}</div>
            <div className="studio-quick-book-copy">
              {featuredEntry ? `Next available openings in ${formatHorizonLabel(anchorDayKey)}.` : `Looking at ${formatHorizonLabel(anchorDayKey)}.`}
            </div>
          </div>
          {selectedSpace?.memberHelpText ? <div className="studio-space-help">{selectedSpace.memberHelpText}</div> : null}
        </div>

        {loading && !selectedSummary ? (
          <div className="studio-booker-empty">
            <div className="studio-booker-empty-title">Loading openings...</div>
          </div>
        ) : featuredEntry ? (
          <div className="studio-feature-layout">
            {renderTimeRow(featuredEntry, "feature")}

            {alternateEntries.length > 0 ? (
              <div className="studio-more-times-disclosure">
                {showAlternateTimes ? (
                  <section className="studio-more-times-card">
                    <div className="studio-more-times-head">
                      <div className="card-title">More good times</div>
                      <span className="studio-space-rail-copy">Shared spaces book in one step.</span>
                    </div>
                    <div className="studio-time-list">
                      {alternateEntries.map((entry) => renderTimeRow(entry, "list"))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          renderEmptyState()
        )}

        <div className="studio-quick-book-footer">
          <div className="studio-quick-book-actions">
            {alternateEntries.length > 0 ? (
              <button
                className="btn btn-ghost studio-more-times-toggle"
                type="button"
                aria-expanded={showAlternateTimes}
                onClick={() => setShowAlternateTimes((current) => !current)}
              >
                {showAlternateTimes
                  ? `Hide ${alternateEntries.length} more good times`
                  : `Show ${alternateEntries.length} more good times`}
              </button>
            ) : null}
            {hasSelectableEntries ? (
              <button className="btn btn-ghost" type="button" onClick={() => setShowBrowse(true)}>
                {browseDays.length > 0 ? "Choose another day" : "See waitlist days"}
              </button>
            ) : null}
            <button className="btn btn-ghost" type="button" onClick={handleShowLaterOpenings}>
              Show later openings
            </button>
          </div>
          <label className="studio-shared-note">
            <span>Note for staff</span>
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional details for your next booking or waitlist"
            />
            <small className="studio-shared-note-copy">
              Applies to your next booking or waitlist only, then clears automatically.
            </small>
          </label>
          <span className="studio-space-rail-copy studio-quick-book-horizon">
            Next 14 days · {formatHorizonLabel(anchorDayKey)}
          </span>
          <div className="studio-feedback-controls">
            <button
              className={`btn btn-ghost studio-sound-toggle ${soundEnabled ? "active" : ""}`}
              type="button"
              aria-label={soundEnabled ? "Mute booking chime" : "Unmute booking chime"}
              title={soundEnabled ? "Mute booking chime" : "Unmute booking chime"}
              aria-pressed={soundEnabled}
              onClick={() => setSoundEnabled((current) => !current)}
            >
              <SoundToggleIcon muted={!soundEnabled} />
            </button>
          </div>
        </div>
      </section>

      {showBrowse ? (
        <section ref={browseRef} className="card card-3d studio-browse-card">
          <div className="studio-browse-head">
            <div>
              <div className="card-title">{browseDays.length > 0 ? "Choose another day" : "Waitlist days"}</div>
              <div className="studio-day-subtitle">
                {browseDays.length > 0
                  ? "Only dates with openings are shown here."
                  : "The next 14 days are full, but you can still join the waitlist on these dates."}
              </div>
            </div>
            <div className="studio-browse-head-actions">
              <button className="btn btn-ghost" type="button" onClick={handleShowLaterOpenings}>
                Show later openings
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setShowBrowse(false)}>
                Hide
              </button>
            </div>
          </div>

          {activeBrowseDays.length === 0 ? (
            <div className="studio-day-empty">No selectable dates in this window yet.</div>
          ) : (
            <>
              <div className="studio-date-chip-list">
                {activeBrowseDays.map((day) => (
                  <button
                    key={day.dayKey}
                    type="button"
                    className={`studio-date-chip ${selectedBrowseDay?.dayKey === day.dayKey ? "active" : ""}`}
                    onClick={() => handleSelectBrowseDay(day.dayKey)}
                  >
                    <span>{formatBrowseDayLabel(day.dayKey)}</span>
                    <small>{day.openEntries.length > 0 ? `${day.openEntries.length} open` : `${day.fullEntries.length} waitlist only`}</small>
                  </button>
                ))}
              </div>

              {selectedBrowseDay ? (
                <div className="studio-browse-day">
                  <div className="studio-browse-day-head">
                    <div className="studio-browse-day-title">
                      {formatStudioDateLabel(studioDateKeyToDate(selectedBrowseDay.dayKey), {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="studio-space-rail-copy">
                      {selectedBrowseDay.openEntries.length > 0
                        ? `${selectedBrowseDay.openEntries.length} opening${selectedBrowseDay.openEntries.length === 1 ? "" : "s"}`
                        : `${selectedBrowseDay.fullEntries.length} waitlist option${selectedBrowseDay.fullEntries.length === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="studio-time-list">
                    {selectedBrowseEntries.map((entry) => renderTimeRow(entry, "list"))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <details
        ref={reservationsRef}
        className="card card-3d studio-my-reservations"
        open={showManageReservations}
        onToggle={(event) => setShowManageReservations((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="studio-my-reservations-summary">
          <span className="studio-my-reservations-title-group">
            <span className="card-title">My reservations</span>
            <span className="studio-day-subtitle">
              {nextUpcoming
                ? `${nextUpcoming.spaceName} next · ${formatStudioDateLabel(nextUpcoming.startAtDate, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}`
                : "No studio reservations yet."}
            </span>
          </span>
          <span className="pill subtle">{upcoming.length}</span>
        </summary>
        <div className="studio-my-reservations-body">
          {upcoming.length === 0 ? (
            <div className="studio-day-empty">No studio reservations yet. Book a space above to get started.</div>
          ) : (
            <div className="studio-mine-list">
              {upcoming.map((reservation) => (
                <article
                  className="studio-mine-card"
                  key={reservation.id}
                  data-feedback-phase={
                    reservationFeedback?.targetId === reservation.id ? reservationFeedback.phase : "idle"
                  }
                  data-feedback-kind={
                    reservationFeedback?.targetId === reservation.id ? reservationFeedback.kind : ""
                  }
                >
                  <div className="studio-calendar-card-head">
                    <span className="studio-calendar-card-title">{reservation.spaceName}</span>
                    <span className="pill subtle">{reservation.status}</span>
                  </div>
                  <div className="studio-calendar-card-time">
                    {formatStudioDateLabel(reservation.startAtDate, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {formatStudioTimeRange(reservation.startAtDate, reservation.endAtDate)}
                  </div>
                  <div className="studio-calendar-card-copy">{reservationSummary(reservation)}</div>
                  <div className="studio-detail-button-row">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        if (!reservation.startAtDate) return;
                        handleSelectSpace(reservation.spaceId);
                        handleSetAnchorDayKey(studioPhoenixDateKey(reservation.startAtDate));
                        setShowBrowse(true);
                      }}
                    >
                      Browse this day
                    </button>
                    {reservation.canCancel ? (
                      <button
                        className="btn btn-secondary studio-action-button"
                        type="button"
                        onClick={toVoidHandler(() => handleCancelReservation(reservation.id))}
                        disabled={busyAction === `cancel:${reservation.id}`}
                        data-feedback-phase={
                          reservationFeedback?.targetId === reservation.id ? reservationFeedback.phase : "idle"
                        }
                      >
                        {busyAction === `cancel:${reservation.id}` ? "Canceling..." : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                  {reservationFeedback?.targetId === reservation.id && reservationFeedback.message ? (
                    <div
                      className={`studio-action-feedback ${
                        reservationFeedback.phase === "error" ? "status-error" : "status-success"
                      }`}
                      role={reservationFeedback.phase === "error" ? "alert" : "status"}
                    >
                      {reservationFeedback.message}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
