import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { PortalApiError, createPortalApi } from "../api/portalApi";
import { db } from "../firebase";
import { formatDateTime } from "../utils/format";
import "./ReservationsView.css";

type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED" | string;

type ReservationRecord = {
  id: string;
  status: ReservationStatus;
  firingType: string;
  shelfEquivalent: number;
  preferredWindow?: {
    earliestDate?: { toDate?: () => Date } | null;
    latestDate?: { toDate?: () => Date } | null;
  } | null;
  linkedBatchId?: string | null;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
};

const SHELF_OPTIONS = ["0.25", "0.5", "1.0"];
const FIRING_TYPES = ["bisque", "glaze", "other"] as const;
type FiringType = (typeof FIRING_TYPES)[number];

function formatPreferredWindow(record: ReservationRecord): string {
  const earliest = record.preferredWindow?.earliestDate?.toDate?.();
  const latest = record.preferredWindow?.latestDate?.toDate?.();
  if (!earliest && !latest) return "Flexible";
  if (earliest && latest) {
    return `${formatDateTime(earliest)} — ${formatDateTime(latest)}`;
  }
  if (earliest) return `Earliest: ${formatDateTime(earliest)}`;
  return `Latest: ${formatDateTime(latest)}`;
}

function sanitizeDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeClientRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

export default function ReservationsView({ user }: { user: User }) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [firingType, setFiringType] = useState<FiringType>("bisque");
  const [shelfEquivalent, setShelfEquivalent] = useState("1.0");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");
  const [linkedBatchId, setLinkedBatchId] = useState("");
  const [formError, setFormError] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitRequestId, setSubmitRequestId] = useState<string | null>(null);

  const portalApi = useMemo(() => createPortalApi(), []);

  useEffect(() => {
    if (!user) {
      setReservations([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setListError("");

    const reservationsQuery = query(
      collection(db, "reservations"),
      where("ownerUid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    getDocs(reservationsQuery)
      .then((snap) => {
        const rows: ReservationRecord[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setReservations(rows);
      })
      .catch((err) => {
        setListError(`Check-ins failed: ${err.message}`);
      })
      .finally(() => setLoading(false));

    return undefined;
  }, [user]);

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [reservations]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    setFormStatus("");

    const earliestDate = sanitizeDateInput(earliest);
    const latestDate = sanitizeDateInput(latest);
    if (earliestDate && latestDate && earliestDate > latestDate) {
      setFormError("Earliest date must be before the latest date.");
      return;
    }

    if (!SHELF_OPTIONS.includes(shelfEquivalent)) {
      setFormError("Select a shelf equivalent.");
      return;
    }

    const shelfNum = Number(shelfEquivalent);
    const requestId = submitRequestId ?? makeClientRequestId();
    if (!submitRequestId) {
      setSubmitRequestId(requestId);
    }

    setIsSaving(true);
    try {
      const payload = {
        firingType,
        shelfEquivalent: shelfNum,
        preferredWindow: {
          earliestDate: earliestDate ? earliestDate.toISOString() : null,
          latestDate: latestDate ? latestDate.toISOString() : null,
        },
        linkedBatchId: linkedBatchId.trim() || null,
        clientRequestId: requestId,
      };
      const idToken = await user.getIdToken();
      await portalApi.createReservation({ idToken, payload });
      setFormStatus("Check-in sent.");
      setEarliest("");
      setLatest("");
      setLinkedBatchId("");
      setSubmitRequestId(null);
    } catch (err: any) {
      const msg = err instanceof PortalApiError ? err.message : err?.message ?? "Submission failed.";
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page reservations-page">
      <div className="page-header">
        <div>
          <h1>Ware Check-in</h1>
          <p className="page-subtitle">
            Pre-check in your work so you can drop off at the front pickup area or speed through
            in-studio check-in.
          </p>
        </div>
      </div>

      <section className="card card-3d reservation-form">
        <div className="card-title">Check in work for firing</div>
        <p className="form-helper">
          Use this to pre-check in and note firing type, shelf size, and timing preferences.
        </p>
        <form onSubmit={handleSubmit} className="reservation-form-grid">
          <label>
            Firing type
            <select value={firingType} onChange={(event) => setFiringType(event.target.value as FiringType)}>
              {FIRING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shelf equivalent
            <select value={shelfEquivalent} onChange={(event) => setShelfEquivalent(event.target.value)}>
              {SHELF_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} shelf
                </option>
              ))}
            </select>
          </label>
          <label>
            Earliest preferred date
            <input type="datetime-local" value={earliest} onChange={(event) => setEarliest(event.target.value)} />
          </label>
          <label>
            Latest preferred date
            <input type="datetime-local" value={latest} onChange={(event) => setLatest(event.target.value)} />
          </label>
          <label>
            Linked batch (optional)
            <input
              type="text"
              placeholder="Paste batch ID"
              value={linkedBatchId}
              onChange={(event) => setLinkedBatchId(event.target.value)}
            />
          </label>
          <div className="form-helper">
            Link a batch only if you already created one in My Pieces.
          </div>
          {formError ? <div className="alert card card-3d form-error">{formError}</div> : null}
          {formStatus ? <div className="notice card card-3d form-status">{formStatus}</div> : null}
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Submitting..." : "Submit check-in"}
          </button>
        </form>
      </section>

      <section className="card card-3d reservation-list">
        <div className="card-title">Your check-ins</div>
        {listError ? <div className="alert">{listError}</div> : null}
        {loading ? (
          <div className="empty-state">Loading check-ins...</div>
        ) : sortedReservations.length === 0 ? (
          <div className="empty-state">No check-ins yet.</div>
        ) : (
          <div className="reservation-grid">
            {sortedReservations.map((reservation) => (
              <article className="reservation-card" key={reservation.id}>
                <header className="reservation-card-header">
                  <h3>{reservation.firingType}</h3>
                  <span className={`status-pill status-${reservation.status.toLowerCase()}`}>
                    {reservation.status}
                  </span>
                </header>
                <div className="reservation-row">
                  <span>Shelf: {reservation.shelfEquivalent} eq.</span>
                  <span>Created: {formatDateTime(reservation.createdAt)}</span>
                </div>
                <div className="reservation-row">
                  <span>Window: {formatPreferredWindow(reservation)}</span>
                  <span>
                    Updated: {formatDateTime(reservation.updatedAt)}
                    {reservation.linkedBatchId ? ` · Batch ${reservation.linkedBatchId}` : ""}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
