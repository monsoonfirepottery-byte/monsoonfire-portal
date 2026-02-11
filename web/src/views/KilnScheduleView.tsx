import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { normalizeFiringDoc, normalizeKilnDoc } from "../lib/normalizers/kiln";
import type { Kiln, KilnFiring, KilnStatus } from "../types/kiln";
import { formatDateTime } from "../utils/format";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import "./KilnScheduleView.css";

type NormalizedFiring = KilnFiring & { startDate: Date; endDate: Date };

type ScheduleState = {
  kilns: Kiln[];
  firings: KilnFiring[];
  loading: boolean;
  error: string;
  errorDetails: { code?: string; message?: string } | null;
  permissionDenied: boolean;
};

const STATUS_LABELS: Record<KilnStatus, string> = {
  idle: "Idle",
  loading: "Loading",
  firing: "Firing",
  cooling: "Cooling",
  unloading: "Unloading",
  maintenance: "Maintenance",
  offline: "Offline",
};

const PRIMARY_KILN_NAME = "L&L eQ2827-3";
const RAKU_KILN_NAME = "Reduction Raku Kiln";

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

function formatTimeRange(startDate: Date, endDate: Date) {
  const startLabel = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endLabel = endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${startLabel} - ${endLabel}`;
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function downloadCalendarInvite(firing: NormalizedFiring, kiln: Kiln | undefined) {
  const summary = `${kiln?.name ?? "Kiln"} — ${firing.title}`;
  const details = [
    `Cycle: ${firing.cycleType}`,
    `Status: ${firing.status}`,
    firing.notes ? `Notes: ${firing.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const start = formatIcsDate(firing.startDate);
  const end = formatIcsDate(firing.endDate);
  const stamp = formatIcsDate(new Date());
  const uid = `monsoonfire-${firing.id}@monsoonfire.com`;

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Monsoon Fire//Kiln Schedule//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(details)}`,
    `LOCATION:${escapeIcsText(kiln?.name ?? "Monsoon Fire Studio")}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Kiln firing reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const blob = new Blob([icsLines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monsoonfire-firing-${firing.id}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useKilnSchedule(): ScheduleState {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [firings, setFirings] = useState<KilnFiring[]>([]);
  const [kilnsLoading, setKilnsLoading] = useState(true);
  const [firingsLoading, setFiringsLoading] = useState(true);
  const [kilnsError, setKilnsError] = useState("");
  const [firingsError, setFiringsError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [errorDetails, setErrorDetails] = useState<{ code?: string; message?: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
        const firingsQuery = query(collection(db, "kilnFirings"), orderBy("startAt", "asc"), limit(200));
        const [kilnSnap, firingSnap] = await Promise.all([getDocs(kilnsQuery), getDocs(firingsQuery)]);
        setKilns(
          kilnSnap.docs.map((docSnap) =>
            normalizeKilnDoc(docSnap.id, docSnap.data() as Partial<Kiln>)
          )
        );
        setFirings(
          firingSnap.docs.map((docSnap) =>
            normalizeFiringDoc(docSnap.id, docSnap.data() as Partial<KilnFiring>)
          )
        );
      } catch (error: unknown) {
        const msg = getErrorMessage(error);
        setKilnsError(`Kilns failed: ${msg}`);
        setFiringsError(`Kiln schedule failed: ${msg}`);
        setErrorDetails({
          code:
            typeof (error as { code?: unknown })?.code === "string"
              ? ((error as { code?: string }).code)
              : undefined,
          message: msg,
        });
        if (isPermissionDenied(error)) setPermissionDenied(true);
      } finally {
        setKilnsLoading(false);
        setFiringsLoading(false);
      }
    };

    void load();
  }, []);

  return {
    kilns,
    firings,
    loading: kilnsLoading || firingsLoading,
    error: [kilnsError, firingsError].filter(Boolean).join(" "),
    errorDetails,
    permissionDenied,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function KilnScheduleView({ user, isStaff }: { user?: User | null; isStaff?: boolean }) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const { kilns, firings, loading, error, errorDetails } = useKilnSchedule();
  const [selectedFiringId, setSelectedFiringId] = useState<string | null>(null);
  const [unloadStatus, setUnloadStatus] = useState("");
  const [unloadBusy, setUnloadBusy] = useState(false);
  const [unloadError, setUnloadError] = useState("");

  const primaryKiln =
    kilns.find((kiln) => kiln.name === PRIMARY_KILN_NAME) ??
    kilns.find((kiln) => /eQ2827|L&L/i.test(kiln.name)) ??
    kilns[0] ??
    null;
  const rakuKiln =
    kilns.find((kiln) => kiln.name === RAKU_KILN_NAME) ??
    kilns.find((kiln) => /raku|reduction/i.test(kiln.name)) ??
    kilns.find((kiln) => kiln.id !== primaryKiln?.id) ??
    null;

  const displayKilns = [primaryKiln, rakuKiln].filter((kiln): kiln is Kiln => Boolean(kiln)).filter(
    (kiln, index, arr) => arr.findIndex((item) => item.id === kiln.id) === index
  );
  const displayKilnIds = new Set(displayKilns.map((kiln) => kiln.id));
  const displayFirings =
    displayKilnIds.size > 0
      ? firings.filter((firing) => displayKilnIds.has(firing.kilnId))
      : firings;

  const normalizedFirings = useMemo(() => {
    return displayFirings
      .map((firing) => {
        const startDate = coerceDate(firing.startAt);
        const endDate = coerceDate(firing.endAt);
        if (!startDate || !endDate) return null;
        return { ...firing, startDate, endDate } as NormalizedFiring;
      })
      .filter((firing): firing is NormalizedFiring => Boolean(firing));
  }, [displayFirings]);

  const kilnById = useMemo(() => {
    const map = new Map<string, Kiln>();
    displayKilns.forEach((kiln) => map.set(kiln.id, kiln));
    return map;
  }, [displayKilns]);

  const upcomingFirings = useMemo(() => {
    const nowDate = new Date();
    return normalizedFirings
      .filter((firing) => firing.status !== "cancelled" && firing.endDate >= nowDate)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, 8);
  }, [normalizedFirings]);

  const nextOverallFiring = upcomingFirings[0] ?? null;

  useEffect(() => {
    if (!selectedFiringId && upcomingFirings.length > 0) {
      setSelectedFiringId(upcomingFirings[0].id);
    }
  }, [selectedFiringId, upcomingFirings]);

  const nextFiringByKiln = useMemo(() => {
    const map = new Map<string, NormalizedFiring>();
    upcomingFirings.forEach((firing) => {
      if (!map.has(firing.kilnId)) {
        map.set(firing.kilnId, firing);
      }
    });
    return map;
  }, [upcomingFirings]);

  const selectedFiring = selectedFiringId
    ? normalizedFirings.find((firing) => firing.id === selectedFiringId) || null
    : null;
  const unloadedAt = selectedFiring ? coerceDate(selectedFiring.unloadedAt) : null;

  return (
    <div className="page kiln-page">
      <div className="page-header">
        <div>
          <h1>Firings</h1>
        </div>
      </div>

      <section className="kiln-intro-grid">
        <RevealCard className="card card-3d" index={0} enabled={motionEnabled}>
          <div className="card-title">Next expected firing</div>
          {nextOverallFiring ? (
            <>
              <div className="next-firing-title">
                {(kilnById.get(nextOverallFiring.kilnId)?.name ?? "Kiln") +
                  " — " +
                  nextOverallFiring.title}
              </div>
              <div className="next-firing-meta">
                {formatDateTime(nextOverallFiring.startDate)} ·{" "}
                {formatTimeRange(nextOverallFiring.startDate, nextOverallFiring.endDate)}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => downloadCalendarInvite(nextOverallFiring, kilnById.get(nextOverallFiring.kilnId))}
              >
                Add to my calendar
              </button>
              <p className="muted">Includes a 1‑day reminder.</p>
            </>
          ) : (
            <div className="empty-state">No upcoming firings scheduled yet.</div>
          )}
        </RevealCard>
        <RevealCard className="card card-3d" index={1} enabled={motionEnabled}>
          <div className="card-title">How to use this page</div>
          <div className="page-subtitle">
            Check the next firing, pick the one that fits your timing, and we will confirm details at
            drop‑off.
          </div>
          <ul className="kiln-steps">
            <li>Scan the next firing for each kiln.</li>
            <li>Use “Add to my calendar” for a reminder.</li>
            <li>Drop off by the posted cutoff time.</li>
          </ul>
        </RevealCard>
      </section>

      {loading ? (
        <div className="loading">
          <span />
          Loading kiln schedule
        </div>
      ) : null}

      {error ? <div className="card card-3d alert">{error}</div> : null}

      {import.meta.env.DEV && errorDetails ? (
        <div className="card card-3d notice">
          <div className="card-title">Firestore debug</div>
          <div className="mono">
            {JSON.stringify(
              {
                code: errorDetails.code ?? "unknown",
                message: errorDetails.message ?? "unknown",
                collections: ["kilns", "kilnFirings"],
              },
              null,
              2
            )}
          </div>
        </div>
      ) : null}

      <section className="kiln-card-grid">
        {displayKilns.map((kiln, idx) => {
          const nextFiring = nextFiringByKiln.get(kiln.id);
          return (
            <RevealCard
              className="card card-3d kiln-card"
              key={kiln.id}
              index={2 + idx}
              enabled={motionEnabled}
            >
              <div className="kiln-card-header">
                <div>
                  <div className="kiln-name">{kiln.name}</div>
                  <div className="kiln-meta">
                    {kiln.type} · {kiln.volume} · Max {kiln.maxTemp}
                  </div>
                </div>
                <div className={`status-pill status-${kiln.status}`}>
                  {STATUS_LABELS[kiln.status]}
                </div>
              </div>
              <div className="kiln-next">
                <div className="label">Next expected firing</div>
                {nextFiring ? (
                  <div className="value">
                    {formatDateTime(nextFiring.startDate)} ({nextFiring.confidence})
                  </div>
                ) : (
                  <div className="value">No firing scheduled.</div>
                )}
              </div>
              <div className="kiln-cycles">
                <div className="label">Typical cycles</div>
                <div className="cycle-list">
                  {kiln.typicalCycles.map((cycle) => (
                    <div className="cycle" key={cycle.id}>
                      <div className="cycle-name">{cycle.name}</div>
                      <div className="cycle-meta">
                        {cycle.typicalDurationHours}h · {cycle.tempRange}
                      </div>
                      {cycle.notes ? <div className="cycle-notes">{cycle.notes}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
              {kiln.notes ? <div className="kiln-notes">{kiln.notes}</div> : null}
            </RevealCard>
          );
        })}
      </section>

      <section className="kiln-lower-grid">
        <RevealCard className="card card-3d kiln-upcoming" index={4} enabled={motionEnabled}>
          <div className="card-title">Upcoming firings</div>
          {upcomingFirings.length === 0 ? (
            <div className="empty-state">No upcoming firings scheduled.</div>
          ) : (
            <div className="upcoming-list">
              {upcomingFirings.map((firing) => {
                const kiln = kilnById.get(firing.kilnId);
                const isSelected = firing.id === selectedFiringId;
                return (
                  <div
                    className={`upcoming-row ${isSelected ? "active" : ""}`}
                    key={firing.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedFiringId(firing.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedFiringId(firing.id);
                      }
                    }}
                  >
                    <div>
                      <div className="upcoming-title">
                        {kiln?.name ?? "Kiln"} · {firing.title}
                      </div>
                      <div className="upcoming-meta">
                        {formatDateTime(firing.startDate)} · {formatTimeRange(firing.startDate, firing.endDate)}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadCalendarInvite(firing, kiln);
                      }}
                    >
                      Add to my calendar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="muted">Calendar invites add a 1‑day reminder.</p>
        </RevealCard>
        <RevealCard className="card card-3d kiln-details" index={5} enabled={motionEnabled}>
          <div className="card-title">Selected firing</div>
          {selectedFiring ? (
            <div className="details-body">
              <div className="details-title">
                {(kilnById.get(selectedFiring.kilnId)?.name ?? "Kiln") + " — " + selectedFiring.title}
              </div>
              <div className="details-meta">
                <div>Cycle: {selectedFiring.cycleType}</div>
                <div>Status: {selectedFiring.status}</div>
                <div>Confidence: {selectedFiring.confidence}</div>
              </div>
              <div className="details-time">
                {formatDateTime(selectedFiring.startDate)} · {formatTimeRange(selectedFiring.startDate, selectedFiring.endDate)}
              </div>
              {selectedFiring.notes ? <div className="details-notes">{selectedFiring.notes}</div> : null}
              {unloadedAt ? (
                <div className="details-notes">
                  Unloaded {formatDateTime(unloadedAt)}.
                </div>
              ) : null}
              <div className="details-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => downloadCalendarInvite(selectedFiring, kilnById.get(selectedFiring.kilnId))}
                >
                  Add to my calendar
                </button>
                {isStaff && user ? (
                  <button
                    className="btn btn-secondary"
                    disabled={unloadBusy || Boolean(unloadedAt)}
                    onClick={() => {
                      void (async () => {
                        if (!selectedFiring || !user || unloadBusy || unloadedAt) return;
                        setUnloadError("");
                        setUnloadStatus("");
                        setUnloadBusy(true);
                        try {
                          const ref = doc(db, "kilnFirings", selectedFiring.id);
                          await updateDoc(ref, {
                            unloadedAt: serverTimestamp(),
                            unloadedByUid: user.uid,
                          });
                          setUnloadStatus("Marked unloaded.");
                        } catch (error: unknown) {
                          setUnloadError(getErrorMessage(error) || "Failed to mark unloaded.");
                        } finally {
                          setUnloadBusy(false);
                        }
                      })();
                    }}
                  >
                    {unloadedAt ? "Unloaded" : unloadBusy ? "Marking..." : "Mark unloaded"}
                  </button>
                ) : null}
              </div>
              <p className="muted">Includes a 1‑day reminder.</p>
              {unloadError ? <div className="alert">{unloadError}</div> : null}
              {unloadStatus ? <div className="notice">{unloadStatus}</div> : null}
            </div>
          ) : (
            <div className="empty-state">Select a firing from the list to see details.</div>
          )}
          {/* TODO: Staff role can kick off new firings and adjust schedules here. */}
        </RevealCard>
      </section>
    </div>
  );
}
