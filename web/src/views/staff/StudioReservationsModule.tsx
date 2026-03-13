import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createPortalApi } from "../../api/portalApi";
import { unwrapPortalData } from "../../api/unwrapPortalData";
import { useStudioReservationsData } from "../../hooks/useStudioReservationsData";
import {
  addStudioDays,
  formatStudioDateLabel,
  formatStudioTimeRange,
  normalizeStudioSpace,
  studioDateKeyToDate,
  studioPhoenixDateKey,
  type StudioReservationRecord,
  type StudioSpaceRecord,
} from "../../lib/studioReservations";
import "../StudioReservationsView.css";
import "./StudioReservationsModule.css";

type Props = {
  user: User;
  adminToken?: string;
  onOpenWareCheckIn?: () => void;
};

type SpaceEditorState = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  memberHelpText: string;
  bookingMode: "capacity" | "resource";
  active: boolean;
  capacity: string;
  colorToken: string;
  sortOrder: string;
  windowStart: string;
  windowEnd: string;
  duration: string;
  increment: string;
  leadTime: string;
  advanceDays: string;
  resourcesCsv: string;
};

type BlockEditorState = {
  type: "closure" | "maintenance" | "private";
  title: string;
  description: string;
  spaceId: string;
  startAtLocal: string;
  endAtLocal: string;
};

const DEFAULT_BLOCK_STATE: BlockEditorState = {
  type: "closure",
  title: "",
  description: "",
  spaceId: "",
  startAtLocal: "",
  endAtLocal: "",
};

function makeWeekEndIso(anchorDayKey: string) {
  return studioDateKeyToDate(addStudioDays(anchorDayKey, 7)).toISOString();
}

function toEditorState(space: StudioSpaceRecord | null): SpaceEditorState {
  const template = space?.templates[0];
  return {
    id: space?.id ?? "",
    slug: space?.slug ?? "",
    name: space?.name ?? "",
    category: space?.category ?? "",
    description: space?.description ?? "",
    memberHelpText: space?.memberHelpText ?? "",
    bookingMode: space?.bookingMode ?? "capacity",
    active: space?.active !== false,
    capacity: space ? String(space.capacity ?? 1) : "1",
    colorToken: space?.colorToken ?? "",
    sortOrder: space?.sortOrder != null ? String(space.sortOrder) : "999",
    windowStart: template?.windowStart ?? "10:00",
    windowEnd: template?.windowEnd ?? "19:00",
    duration: template?.slotDurationMinutes != null ? String(template.slotDurationMinutes) : "240",
    increment: template?.slotIncrementMinutes != null ? String(template.slotIncrementMinutes) : "240",
    leadTime: template?.leadTimeMinutes != null ? String(template.leadTimeMinutes) : "60",
    advanceDays: template?.maxAdvanceDays != null ? String(template.maxAdvanceDays) : "28",
    resourcesCsv: space?.resources.map((resource) => `${resource.id}|${resource.label}`).join("\n") ?? "",
  };
}

export default function StudioReservationsModule({ user, adminToken, onOpenWareCheckIn }: Props) {
  const api = useMemo(() => createPortalApi(), []);
  const [anchorDayKey, setAnchorDayKey] = useState(() => studioPhoenixDateKey(new Date()));
  const [selectedSpaceId, setSelectedSpaceId] = useState("all");
  const [inventory, setInventory] = useState<StudioSpaceRecord[]>([]);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [spaceEditor, setSpaceEditor] = useState<SpaceEditorState>(() => toEditorState(null));
  const [blockEditor, setBlockEditor] = useState<BlockEditorState>(DEFAULT_BLOCK_STATE);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const rangeStartIso = useMemo(() => studioDateKeyToDate(anchorDayKey).toISOString(), [anchorDayKey]);
  const rangeEndIso = useMemo(() => makeWeekEndIso(anchorDayKey), [anchorDayKey]);
  const requestedSpaceIds = useMemo(
    () => (selectedSpaceId !== "all" ? [selectedSpaceId] : []),
    [selectedSpaceId]
  );
  const { spaces, entries, reservations, loading, error: loadError, reload } = useStudioReservationsData({
    user,
    adminToken,
    rangeStartIso,
    rangeEndIso,
    spaceIds: requestedSpaceIds,
  });

  const visibleReservations = useMemo(
    () =>
      reservations
        .slice()
        .sort((left, right) => {
          const leftMs = left.startAtDate?.getTime() ?? 0;
          const rightMs = right.startAtDate?.getTime() ?? 0;
          return leftMs - rightMs;
        }),
    [reservations]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadInventory() {
      setInventoryBusy(true);
      try {
        const idToken = await user.getIdToken();
        const response = await api.listStudioReservationSpaces({
          idToken,
          adminToken,
          payload: {
            includeInactive: true,
          },
        });
        if (cancelled) return;
        const payload = unwrapPortalData(response.data);
        const rows = Array.isArray(payload?.spaces)
          ? payload.spaces.map((space) => normalizeStudioSpace(space))
          : [];
        setInventory(rows);
        if (rows.length > 0) {
          setSpaceEditor((current) => (current.id ? current : toEditorState(rows[0])));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setInventoryBusy(false);
      }
    }
    void loadInventory();
    return () => {
      cancelled = true;
    };
  }, [adminToken, api, user]);

  const handleSaveSpace = async () => {
    setBusy("space");
    setError("");
    try {
      const idToken = await user.getIdToken();
      const resources = spaceEditor.bookingMode === "resource"
        ? spaceEditor.resourcesCsv
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => {
              const [idPart, labelPart] = line.split("|");
              const id = (idPart || `resource-${index + 1}`).trim();
              const label = (labelPart || idPart || `Resource ${index + 1}`).trim();
              return { id, label, active: true };
            })
        : [];
      await api.staffUpsertStudioReservationSpace({
        idToken,
        adminToken,
        payload: {
          id: spaceEditor.id.trim(),
          slug: spaceEditor.slug.trim(),
          name: spaceEditor.name.trim(),
          category: spaceEditor.category.trim(),
          description: spaceEditor.description.trim() || null,
          memberHelpText: spaceEditor.memberHelpText.trim() || null,
          bookingMode: spaceEditor.bookingMode,
          active: spaceEditor.active,
          capacity: spaceEditor.bookingMode === "capacity" ? Number(spaceEditor.capacity || "1") : null,
          colorToken: spaceEditor.colorToken.trim() || null,
          sortOrder: Number(spaceEditor.sortOrder || "999"),
          resources,
          templates: [
            {
              id: `${spaceEditor.id.trim()}-default`,
              label: "Standard reservation window",
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              windowStart: spaceEditor.windowStart,
              windowEnd: spaceEditor.windowEnd,
              slotDurationMinutes: Number(spaceEditor.duration || "120"),
              slotIncrementMinutes: Number(spaceEditor.increment || spaceEditor.duration || "120"),
              cleanupBufferMinutes: 15,
              leadTimeMinutes: Number(spaceEditor.leadTime || "60"),
              maxAdvanceDays: Number(spaceEditor.advanceDays || "28"),
            },
          ],
        },
      });
      setStatus("Studio space saved.");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const handleSaveBlock = async () => {
    setBusy("block");
    setError("");
    try {
      const idToken = await user.getIdToken();
      await api.staffUpsertStudioCalendarBlock({
        idToken,
        adminToken,
        payload: {
          type: blockEditor.type,
          title: blockEditor.title.trim(),
          description: blockEditor.description.trim() || null,
          spaceId: blockEditor.spaceId.trim() || null,
          startAt: new Date(blockEditor.startAtLocal).toISOString(),
          endAt: new Date(blockEditor.endAtLocal).toISOString(),
        },
      });
      setBlockEditor(DEFAULT_BLOCK_STATE);
      setStatus("Calendar block saved.");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const handleReservationAction = async (
    reservation: StudioReservationRecord,
    action: "cancel" | "promote" | "complete"
  ) => {
    setBusy(`${action}:${reservation.id}`);
    setError("");
    try {
      const idToken = await user.getIdToken();
      await api.staffManageStudioReservation({
        idToken,
        adminToken,
        payload: {
          reservationId: reservation.id,
          action,
        },
      });
      setStatus(`Reservation ${action}d.`);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="staff-module-grid studio-reservations-module">
      <div className="staff-column studio-reservations-module-column">
        <div className="card-title-row">
          <div className="card-title">Studio reservations</div>
        </div>
        <div className="staff-note">
          Calendar-first booking for shared studio spaces. Members see occupancy. Staff sees names, waitlists, and holds.
        </div>
        {loadError ? <div className="staff-note staff-note-error">{loadError}</div> : null}
        {error ? <div className="staff-note staff-note-error">{error}</div> : null}
        {status ? <div className="staff-note">{status}</div> : null}
        <div className="studio-reservations-module-toolbar">
          <div className="studio-reservations-nav">
            <button className="btn btn-ghost" type="button" onClick={() => setAnchorDayKey(addStudioDays(anchorDayKey, -7))}>
              Previous week
            </button>
            <strong>
              {formatStudioDateLabel(studioDateKeyToDate(anchorDayKey))} -{" "}
              {formatStudioDateLabel(studioDateKeyToDate(addStudioDays(anchorDayKey, 6)))}
            </strong>
            <button className="btn btn-ghost" type="button" onClick={() => setAnchorDayKey(addStudioDays(anchorDayKey, 7))}>
              Next week
            </button>
          </div>
          <div className="studio-reservations-filters">
            <button className={`studio-space-chip ${selectedSpaceId === "all" ? "active" : ""}`} type="button" onClick={() => setSelectedSpaceId("all")}>
              All spaces
            </button>
            {spaces.map((space) => (
              <button
                key={space.id}
                className={`studio-space-chip ${selectedSpaceId === space.id ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedSpaceId(space.id)}
              >
                {space.name}
              </button>
            ))}
          </div>
          <div className="studio-detail-button-row">
            {onOpenWareCheckIn ? (
              <button className="btn btn-ghost" type="button" onClick={onOpenWareCheckIn}>
                Open ware check-in
              </button>
            ) : null}
            <button className="btn btn-secondary" type="button" onClick={() => void reload()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="studio-reservations-admin-grid">
          <div className="card card-3d studio-reservations-admin-card">
            <div className="card-title">Reservations in view</div>
            <div className="studio-mine-list">
              {visibleReservations.length === 0 ? (
                <div className="studio-day-empty">No bookings or waitlist entries in this range.</div>
              ) : (
                visibleReservations.map((reservation) => (
                  (() => {
                    const assignedResourceIds = reservation.assignedResourceIds ?? [];
                    return (
                      <article key={reservation.id} className="studio-mine-card">
                        <div className="studio-calendar-card-head">
                          <span className="studio-calendar-card-title">{reservation.spaceName}</span>
                          <span className="pill subtle">{reservation.status}</span>
                        </div>
                        <div className="studio-calendar-card-time">
                          {reservation.ownerDisplayName ?? reservation.ownerUid ?? "Member"} ·{" "}
                          {formatStudioDateLabel(reservation.startAtDate, { weekday: "short" })} ·{" "}
                          {formatStudioTimeRange(reservation.startAtDate, reservation.endAtDate)}
                        </div>
                        <div className="studio-calendar-card-copy">
                          {assignedResourceIds.length > 0
                            ? `Assigned: ${assignedResourceIds.join(", ")}`
                            : `${reservation.quantity} ${reservation.quantity === 1 ? "spot" : "spots"}`}
                        </div>
                        <div className="studio-detail-button-row">
                          {reservation.status === "waitlisted" ? (
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={() => void handleReservationAction(reservation, "promote")}
                              disabled={busy === `promote:${reservation.id}`}
                            >
                              {busy === `promote:${reservation.id}` ? "Promoting..." : "Promote"}
                            </button>
                          ) : null}
                          {reservation.status === "booked" ? (
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => void handleReservationAction(reservation, "complete")}
                              disabled={busy === `complete:${reservation.id}`}
                            >
                              {busy === `complete:${reservation.id}` ? "Completing..." : "Mark complete"}
                            </button>
                          ) : null}
                          {reservation.status !== "cancelled" ? (
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={() => void handleReservationAction(reservation, "cancel")}
                              disabled={busy === `cancel:${reservation.id}`}
                            >
                              {busy === `cancel:${reservation.id}` ? "Canceling..." : "Cancel"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })()
                ))
              )}
            </div>
          </div>

          <div className="card card-3d studio-reservations-admin-card">
            <div className="card-title">Space settings</div>
            {inventoryBusy ? <div className="studio-day-empty">Loading space inventory...</div> : null}
            <label className="studio-detail-field">
              <span>Load existing space</span>
              <select
                value={spaceEditor.id}
                onChange={(event) => {
                  const next = inventory.find((space) => space.id === event.target.value) ?? null;
                  setSpaceEditor(toEditorState(next));
                }}
              >
                {inventory.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-detail-field">
              <span>Space id</span>
              <input value={spaceEditor.id} onChange={(event) => setSpaceEditor((current) => ({ ...current, id: event.target.value }))} />
            </label>
            <label className="studio-detail-field">
              <span>Name</span>
              <input value={spaceEditor.name} onChange={(event) => setSpaceEditor((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Slug</span>
                <input value={spaceEditor.slug} onChange={(event) => setSpaceEditor((current) => ({ ...current, slug: event.target.value }))} />
              </label>
              <label className="studio-detail-field">
                <span>Category</span>
                <input value={spaceEditor.category} onChange={(event) => setSpaceEditor((current) => ({ ...current, category: event.target.value }))} />
              </label>
            </div>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Booking mode</span>
                <select
                  value={spaceEditor.bookingMode}
                  onChange={(event) =>
                    setSpaceEditor((current) => ({
                      ...current,
                      bookingMode: event.target.value === "resource" ? "resource" : "capacity",
                    }))
                  }
                >
                  <option value="capacity">Capacity</option>
                  <option value="resource">Named resources</option>
                </select>
              </label>
              <label className="studio-detail-field">
                <span>Capacity</span>
                <input
                  value={spaceEditor.capacity}
                  onChange={(event) => setSpaceEditor((current) => ({ ...current, capacity: event.target.value }))}
                  disabled={spaceEditor.bookingMode === "resource"}
                />
              </label>
            </div>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Window start</span>
                <input value={spaceEditor.windowStart} onChange={(event) => setSpaceEditor((current) => ({ ...current, windowStart: event.target.value }))} />
              </label>
              <label className="studio-detail-field">
                <span>Window end</span>
                <input value={spaceEditor.windowEnd} onChange={(event) => setSpaceEditor((current) => ({ ...current, windowEnd: event.target.value }))} />
              </label>
            </div>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Slot minutes</span>
                <input value={spaceEditor.duration} onChange={(event) => setSpaceEditor((current) => ({ ...current, duration: event.target.value }))} />
              </label>
              <label className="studio-detail-field">
                <span>Increment minutes</span>
                <input value={spaceEditor.increment} onChange={(event) => setSpaceEditor((current) => ({ ...current, increment: event.target.value }))} />
              </label>
            </div>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Lead time</span>
                <input value={spaceEditor.leadTime} onChange={(event) => setSpaceEditor((current) => ({ ...current, leadTime: event.target.value }))} />
              </label>
              <label className="studio-detail-field">
                <span>Advance days</span>
                <input value={spaceEditor.advanceDays} onChange={(event) => setSpaceEditor((current) => ({ ...current, advanceDays: event.target.value }))} />
              </label>
            </div>
            {spaceEditor.bookingMode === "resource" ? (
              <label className="studio-detail-field">
                <span>Resources</span>
                <textarea
                  rows={5}
                  value={spaceEditor.resourcesCsv}
                  onChange={(event) => setSpaceEditor((current) => ({ ...current, resourcesCsv: event.target.value }))}
                  placeholder={"skutt-wheel|Skutt wheel\nvevor-wheel-trimming-only|Vevor wheel (trimming only)"}
                />
              </label>
            ) : null}
            <label className="studio-detail-field">
              <span>Description</span>
              <textarea rows={3} value={spaceEditor.description} onChange={(event) => setSpaceEditor((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="studio-detail-field">
              <span>Member help text</span>
              <textarea rows={2} value={spaceEditor.memberHelpText} onChange={(event) => setSpaceEditor((current) => ({ ...current, memberHelpText: event.target.value }))} />
            </label>
            <div className="studio-detail-button-row">
              <button className="btn btn-primary" type="button" onClick={() => void handleSaveSpace()} disabled={busy === "space"}>
                {busy === "space" ? "Saving..." : "Save space"}
              </button>
              <label className="studio-resource-option">
                <input
                  type="checkbox"
                  checked={spaceEditor.active}
                  onChange={(event) => setSpaceEditor((current) => ({ ...current, active: event.target.checked }))}
                />
                <span>Active</span>
              </label>
            </div>
          </div>

          <div className="card card-3d studio-reservations-admin-card">
            <div className="card-title">Calendar blocks</div>
            <label className="studio-detail-field">
              <span>Type</span>
              <select
                value={blockEditor.type}
                onChange={(event) =>
                  setBlockEditor((current) => ({
                    ...current,
                    type: event.target.value as BlockEditorState["type"],
                  }))
                }
              >
                <option value="closure">Closure</option>
                <option value="maintenance">Maintenance</option>
                <option value="private">Private hold</option>
              </select>
            </label>
            <label className="studio-detail-field">
              <span>Title</span>
              <input value={blockEditor.title} onChange={(event) => setBlockEditor((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="studio-detail-field">
              <span>Space</span>
              <select
                value={blockEditor.spaceId}
                onChange={(event) => setBlockEditor((current) => ({ ...current, spaceId: event.target.value }))}
              >
                <option value="">All spaces</option>
                {inventory.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="studio-reservations-admin-inline">
              <label className="studio-detail-field">
                <span>Start</span>
                <input
                  type="datetime-local"
                  value={blockEditor.startAtLocal}
                  onChange={(event) => setBlockEditor((current) => ({ ...current, startAtLocal: event.target.value }))}
                />
              </label>
              <label className="studio-detail-field">
                <span>End</span>
                <input
                  type="datetime-local"
                  value={blockEditor.endAtLocal}
                  onChange={(event) => setBlockEditor((current) => ({ ...current, endAtLocal: event.target.value }))}
                />
              </label>
            </div>
            <label className="studio-detail-field">
              <span>Description</span>
              <textarea rows={3} value={blockEditor.description} onChange={(event) => setBlockEditor((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <button className="btn btn-primary" type="button" onClick={() => void handleSaveBlock()} disabled={busy === "block"}>
              {busy === "block" ? "Saving..." : "Save block"}
            </button>
          </div>

          <div className="card card-3d studio-reservations-admin-card">
            <div className="card-title">Calendar feed snapshot</div>
            <div className="studio-mine-list">
              {entries.slice(0, 12).map((entry) => (
                <div key={entry.id} className="studio-mine-card">
                  <div className="studio-calendar-card-head">
                    <span className="studio-calendar-card-title">{entry.spaceName ?? entry.title}</span>
                    <span className="pill subtle">{entry.status}</span>
                  </div>
                  <div className="studio-calendar-card-time">
                    {formatStudioDateLabel(entry.startAtDate, { weekday: "short" })} · {formatStudioTimeRange(entry.startAtDate, entry.endAtDate)}
                  </div>
                  {entry.staffReservations.length > 0 ? (
                    <div className="studio-calendar-card-copy">
                      {entry.staffReservations.map((row) => row.ownerDisplayName ?? row.ownerUid ?? row.id).join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
