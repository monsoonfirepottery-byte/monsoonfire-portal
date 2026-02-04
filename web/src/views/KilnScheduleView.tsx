import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { mockFirings, mockKilns } from "../data/kilnScheduleMock";
import type { Kiln, KilnFiring, KilnStatus } from "../types/kiln";
import { formatDateTime } from "../utils/format";
import "./KilnScheduleView.css";

type NormalizedFiring = KilnFiring & { startDate: Date; endDate: Date };

type ScheduleState = {
  kilns: Kiln[];
  firings: KilnFiring[];
  loading: boolean;
  error: string;
  permissionDenied: boolean;
};

const STATUS_LABELS: Record<KilnStatus, string> = {
  idle: "Idle",
  loading: "Loading",
  firing: "Firing",
  cooling: "Cooling",
  unloading: "Unloading",
  maintenance: "Maintenance",
};

const GOOGLE_CALENDAR_TZ = "America/Phoenix";
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

function resolveGoogleCalendarId() {
  const env =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_GOOGLE_KILN_CALENDAR_ID
      ? String((import.meta as any).env.VITE_GOOGLE_KILN_CALENDAR_ID)
      : "";
  return env;
}

function formatGoogleDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function openGoogleCalendarEvent(firing: NormalizedFiring, kiln: Kiln | undefined) {
  const summary = `${kiln?.name ?? "Kiln"} — ${firing.title}`;
  const details = [
    `Cycle: ${firing.cycleType}`,
    `Status: ${firing.status}`,
    firing.notes ? `Notes: ${firing.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const start = formatGoogleDate(firing.startDate);
  const end = formatGoogleDate(firing.endDate);

  const params = new URLSearchParams({
    text: summary,
    dates: `${start}/${end}`,
    details,
    location: kiln?.name ?? "Monsoon Fire Studio",
    ctz: GOOGLE_CALENDAR_TZ,
  });

  const calendarId = resolveGoogleCalendarId();
  if (calendarId) {
    params.set("src", calendarId);
  }

  const url = `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function toFirestoreKiln(kiln: Kiln) {
  return {
    name: kiln.name,
    type: kiln.type,
    volume: kiln.volume,
    maxTemp: kiln.maxTemp,
    status: kiln.status,
    isAvailable: kiln.isAvailable,
    typicalCycles: kiln.typicalCycles.map((cycle) => ({
      id: cycle.id,
      name: cycle.name,
      typicalDurationHours: cycle.typicalDurationHours,
      tempRange: cycle.tempRange,
      notes: cycle.notes ?? null,
    })),
    notes: kiln.notes ?? null,
  };
}

function toFirestoreFiring(firing: KilnFiring) {
  return {
    kilnId: firing.kilnId,
    title: firing.title,
    cycleType: firing.cycleType,
    startAt: firing.startAt instanceof Date ? firing.startAt : null,
    endAt: firing.endAt instanceof Date ? firing.endAt : null,
    status: firing.status,
    confidence: firing.confidence,
    notes: firing.notes ?? null,
  };
}

function useKilnSchedule(): ScheduleState {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [firings, setFirings] = useState<KilnFiring[]>([]);
  const [kilnsLoading, setKilnsLoading] = useState(true);
  const [firingsLoading, setFiringsLoading] = useState(true);
  const [kilnsError, setKilnsError] = useState("");
  const [firingsError, setFiringsError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
        const firingsQuery = query(collection(db, "kilnFirings"), orderBy("startAt", "asc"), limit(200));
        const [kilnSnap, firingSnap] = await Promise.all([getDocs(kilnsQuery), getDocs(firingsQuery)]);
        setKilns(
          kilnSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
        setFirings(
          firingSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      } catch (err: any) {
        const msg = err?.message || String(err);
        setKilnsError(`Kilns failed: ${msg}`);
        setFiringsError(`Kiln schedule failed: ${msg}`);
        if (isPermissionDenied(err)) setPermissionDenied(true);
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
    permissionDenied,
  };
}

export default function KilnScheduleView() {
  const { kilns, firings, loading, error, permissionDenied } = useKilnSchedule();
  const [selectedFiringId, setSelectedFiringId] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedStatus, setSeedStatus] = useState("");

  const dataReady = !loading;
  const useMock = permissionDenied || (dataReady && kilns.length === 0 && firings.length === 0);
  const rawKilns = useMock ? mockKilns : kilns;
  const rawFirings = useMock ? mockFirings : firings;

  const fallbackPrimary = mockKilns.find((kiln) => kiln.name === PRIMARY_KILN_NAME) ?? mockKilns[0];
  const fallbackRaku = mockKilns.find((kiln) => kiln.name === RAKU_KILN_NAME) ?? mockKilns[1];

  const primaryKiln =
    rawKilns.find((kiln) => kiln.name === PRIMARY_KILN_NAME) ??
    rawKilns.find((kiln) => /eQ2827|L&L/i.test(kiln.name)) ??
    fallbackPrimary;
  const rakuKiln =
    rawKilns.find((kiln) => kiln.name === RAKU_KILN_NAME) ??
    rawKilns.find((kiln) => /raku|reduction/i.test(kiln.name)) ??
    fallbackRaku;

  const displayKilns = [primaryKiln, rakuKiln].filter(
    (kiln, index, arr) => arr.findIndex((item) => item.id === kiln.id) === index
  );
  const displayKilnIds = new Set(displayKilns.map((kiln) => kiln.id));
  const displayFirings = rawFirings.filter((firing) => displayKilnIds.has(firing.kilnId));

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

  const handleSeedMock = async () => {
    if (seedBusy || permissionDenied) return;
    setSeedBusy(true);
    setSeedStatus("");

    try {
      const batch = writeBatch(db);
      mockKilns.forEach((kiln) => {
        batch.set(doc(db, "kilns", kiln.id), toFirestoreKiln(kiln));
      });
      mockFirings.forEach((firing) => {
        batch.set(doc(db, "kilnFirings", firing.id), toFirestoreFiring(firing));
      });
      await batch.commit();
      setSeedStatus("Mock kiln schedule seeded to Firestore.");
    } catch (err: any) {
      setSeedStatus(`Seed failed: ${err?.message || String(err)}`);
    } finally {
      setSeedBusy(false);
    }
  };

  const headerPill = useMock
    ? permissionDenied
      ? "Mock data (no Firestore access)"
      : "Mock data"
    : "Live data";

  return (
    <div className="page kiln-page">
      <div className="page-header">
        <div>
          <h1>Firings</h1>
          <p className="page-subtitle">
            See what is firing next, what is in progress, and what has already fired.
          </p>
        </div>
        <div className="kiln-header-actions">
          <span className="pill subtle">{headerPill}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span />
          Loading kiln schedule
        </div>
      ) : null}

      {permissionDenied ? (
        <div className="card card-3d notice">
          Firestore permissions are missing for `kilns` or `kilnFirings`. Showing mock schedule
          data until read access is granted.
        </div>
      ) : null}

      {!permissionDenied && error ? <div className="card card-3d alert">{error}</div> : null}

      <section className="kiln-card-grid">
        {displayKilns.map((kiln) => {
          const nextFiring = nextFiringByKiln.get(kiln.id);
          return (
            <div className="card card-3d kiln-card" key={kiln.id}>
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
            </div>
          );
        })}
      </section>

      <section className="kiln-lower-grid">
        <div className="card card-3d kiln-upcoming">
          <div className="card-title">Upcoming firings</div>
          {upcomingFirings.length === 0 ? (
            <div className="empty-state">No upcoming firings scheduled.</div>
          ) : (
            <div className="upcoming-list">
              {upcomingFirings.map((firing) => {
                const kiln = kilnById.get(firing.kilnId);
                return (
                  <div className="upcoming-row" key={firing.id}>
                    <div>
                      <div className="upcoming-title">
                        {kiln?.name ?? "Kiln"} · {firing.title}
                      </div>
                      <div className="upcoming-meta">
                        {formatDateTime(firing.startDate)} · {formatTimeRange(firing.startDate, firing.endDate)}
                      </div>
                    </div>
                    <button className="btn btn-ghost" onClick={() => openGoogleCalendarEvent(firing, kiln)}>
                      Add to Monsoon Fire calendar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card card-3d kiln-details">
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
              <div className="details-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => openGoogleCalendarEvent(selectedFiring, kilnById.get(selectedFiring.kilnId))}
                >
                  Add to Monsoon Fire calendar
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a firing from the list to see details.</div>
          )}
          {/* TODO: Staff role can kick off new firings and adjust schedules here. */}
        </div>
      </section>

      {import.meta.env.DEV ? (
        <section className="card card-3d kiln-dev">
          <div className="card-title">Dev tools</div>
          <p className="muted">
            Seed mock kiln schedule data to Firestore when you need a baseline dataset.
          </p>
          {permissionDenied ? (
            <div className="notice">
              Firestore write access is required to seed `kilns` and `kilnFirings`.
            </div>
          ) : null}
          {seedStatus ? <div className="status-line">{seedStatus}</div> : null}
          <button
            className="btn btn-ghost"
            onClick={handleSeedMock}
            disabled={seedBusy || permissionDenied}
          >
            {seedBusy ? "Seeding..." : "Seed mock schedule"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
