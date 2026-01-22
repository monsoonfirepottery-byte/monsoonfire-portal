import React, { useEffect, useMemo, useState } from "react";
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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeRange(startDate: Date, endDate: Date) {
  const startLabel = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endLabel = endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${startLabel} - ${endLabel}`;
}

function getMonthGrid(target: Date) {
  const year = target.getFullYear();
  const month = target.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const dayOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<Date | null> = [];
  for (let i = 0; i < dayOffset; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function downloadIcs(firing: NormalizedFiring, kiln: Kiln | undefined) {
  const summary = `${kiln?.name ?? "Kiln"} — ${firing.title}`;
  const description = [
    `Cycle: ${firing.cycleType}`,
    `Status: ${firing.status}`,
    firing.notes ? `Notes: ${firing.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Monsoon Fire//Kiln Schedule//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${firing.id}@monsoonfire.com`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(firing.startDate)}`,
    `DTEND:${formatIcsDate(firing.endDate)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(kiln?.name ?? "Monsoon Fire Studio")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${firing.id}.ics`;
  link.click();
  URL.revokeObjectURL(url);
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
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedStatus, setSeedStatus] = useState("");

  const dataReady = !loading;
  const useMock = permissionDenied || (dataReady && kilns.length === 0 && firings.length === 0);
  const displayKilns = useMock ? mockKilns : kilns;
  const displayFirings = useMock ? mockFirings : firings;

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

  const monthLabel = monthCursor.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthCells = useMemo(() => getMonthGrid(monthCursor), [monthCursor]);
  const monthKeyPrefix = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`;

  const eventsByDay = useMemo(() => {
    const map = new Map<string, NormalizedFiring[]>();
    normalizedFirings.forEach((firing) => {
      const dayKey = formatDayKey(firing.startDate);
      if (!dayKey.startsWith(monthKeyPrefix)) return;
      const bucket = map.get(dayKey) ?? [];
      bucket.push(firing);
      map.set(dayKey, bucket);
    });
    return map;
  }, [normalizedFirings, monthKeyPrefix]);

  const todayKey = formatDayKey(new Date());

  const handlePrevMonth = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

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
          <h1>Kiln Schedule</h1>
          <p className="page-subtitle">
            See what kilns are available, their current status, and upcoming firing windows.
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

      <section className="card card-3d kiln-calendar">
        <div className="calendar-header">
          <div>
            <div className="card-title">Monthly kiln calendar</div>
            <p className="calendar-subtitle">Tap a firing to see details and download reminders.</p>
          </div>
          <div className="calendar-actions">
            <button className="btn btn-ghost" onClick={handlePrevMonth}>
              Prev
            </button>
            <div className="calendar-month">{monthLabel}</div>
            <button className="btn btn-ghost" onClick={handleNextMonth}>
              Next
            </button>
          </div>
        </div>
        <div className="calendar-grid">
          {WEEKDAY_LABELS.map((label) => (
            <div className="calendar-weekday" key={label}>
              {label}
            </div>
          ))}
          {monthCells.map((cell, index) => {
            if (!cell) {
              return <div className="calendar-cell empty" key={`empty-${index}`} />;
            }
            const dayKey = formatDayKey(cell);
            const dayEvents = eventsByDay.get(dayKey) ?? [];
            const isToday = dayKey === todayKey;

            return (
              <div className={`calendar-cell ${isToday ? "today" : ""}`} key={dayKey}>
                <div className="calendar-date">{cell.getDate()}</div>
                <div className="calendar-events">
                  {dayEvents.length === 0 ? (
                    <div className="calendar-empty">—</div>
                  ) : (
                    dayEvents.map((event) => {
                      const kiln = kilnById.get(event.kilnId);
                      const timeLabel = event.startDate.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      return (
                        <button
                          className={`calendar-event status-${event.status}`}
                          key={event.id}
                          onClick={() => setSelectedFiringId(event.id)}
                        >
                          <span className="event-time">{timeLabel}</span>
                          <span className="event-title">
                            {kiln?.name ?? "Kiln"}: {event.title}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {/* TODO: add filters for kiln availability, calendar lane view/tab for day/week, and allow staffing controls (firing kickoff, maintenance overrides). */}
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
                    <button className="btn btn-ghost" onClick={() => downloadIcs(firing, kiln)}>
                      Add to calendar
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
                  onClick={() => downloadIcs(selectedFiring, kilnById.get(selectedFiring.kilnId))}
                >
                  Download reminder (.ics)
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a firing from the calendar to see details.</div>
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
