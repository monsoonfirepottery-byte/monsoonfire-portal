import { useEffect, useMemo, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";
import "./staffCreateFiringTicket.css";

type Person = { uid: string; displayName: string; email: string };
type Firing = { id: string; title: string; startAt: string | null; unloadedAt: string | null; status: string };
type Ticket = { ticketId: string; ownerUid: string; email: string | null; displayName: string; firingId: string; reservationId?: string | null; manualFiring?: { date?: string; kiln?: string }; status: string; billingStatus: string; createdAt: string | null };
type Options = { people: Person[]; firings: Firing[]; limits: { users: number; profiles: number; firings: number } };
type Reservation = { reservationId: string; status: string; intakeMode: string; firingType: string; estimatedHalfShelves: number | null; createdAt: string | null; privateRequested: boolean; rushRequested: boolean; communitySharingAllowed: boolean };
type History = { tickets: Ticket[]; reservations?: Reservation[]; reservationsTruncated?: boolean; truncated: boolean; emailAvailable: boolean };
type CreateRequest = { clientRequestId: string; ownerUid: string; heatId: string; spaceId: string; firingType: string;
  reservationId?: string;
  stage: "new_dropoff" | "already_unloaded"; firingId: string | null;
  manualFiring: { date: string; kiln: string; evidence: string } | null;
  reviewedExistingTicketsAndPayments: boolean; privateRequested: boolean; rushRequested: boolean; communitySharingAllowed: boolean; note: string };

function readPending(key: string): { request: CreateRequest | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { request: null, error: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof (parsed as CreateRequest).clientRequestId !== "string" ||
        typeof (parsed as CreateRequest).ownerUid !== "string") {
      return { request: null, error: "A previous request cannot be read. Check the ticket list before clearing it." };
    }
    return { request: parsed as CreateRequest, error: "" };
  } catch {
    return { request: null, error: "Pending ticket recovery is unavailable. Check the ticket list before continuing." };
  }
}

export default function StaffCreateFiringTicket({ client, staffUid, onClose }: { client: FunctionsClient; staffUid: string; onClose: () => void }) {
  const [storageKey] = useState(() => `mf:staff-ticket-pending:${staffUid}`);
  const [initialRecovery] = useState(() => readPending(storageKey));
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [uid, setUid] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [stage, setStage] = useState<"new_dropoff" | "already_unloaded">("new_dropoff");
  const [firingId, setFiringId] = useState("");
  const [firingSource, setFiringSource] = useState<"portal" | "studio_record">("portal");
  const [firingDate, setFiringDate] = useState("");
  const [kiln, setKiln] = useState("");
  const [evidence, setEvidence] = useState("");
  const [heatId, setHeatId] = useState("mid");
  const [spaceId, setSpaceId] = useState("large");
  const [firingType, setFiringType] = useState("glaze");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [privateRequested, setPrivateRequested] = useState(false);
  const [rushRequested, setRushRequested] = useState(false);
  const [communitySharingAllowed, setCommunitySharingAllowed] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [pendingRequest, setPendingRequest] = useState<CreateRequest | null>(initialRecovery.request);
  const [storageError, setStorageError] = useState(initialRecovery.error);
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    client.postJson<{ ok: boolean; data: Options }>("staffGetFiringTicketCreationOptions", {})
      .then((response) => { if (active) setOptions(response.data); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [client]);
  useEffect(() => {
    let active = true;
    setHistory(null);
    setHistoryError("");
    setReservationId("");
    setPrivateRequested(false);
    setRushRequested(false);
    setCommunitySharingAllowed(false);
    if (uid) {
      client.postJson<{ ok: boolean; data: History }>("staffGetFiringTicketClientHistory", { ownerUid: uid })
        .then((response) => { if (active) setHistory(response.data); })
        .catch((reason: unknown) => { if (active) setHistoryError(reason instanceof Error ? reason.message : String(reason)); });
    }
    return () => { active = false; };
  }, [client, uid]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q && options ? options.people.filter((p) => [p.displayName, p.email, p.uid].some((s) => s.toLowerCase().includes(q))).slice(0, 30) : [];
  }, [options, search]);
  const person = options?.people.find((p) => p.uid === uid);
  const related = history?.tickets ?? [];
  const unloaded = options?.firings.filter((f) => f.unloadedAt) ?? [];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || result) return;
    setBusy(true); setError("");
    const request: CreateRequest = pendingRequest ?? {
      clientRequestId: requestId, ownerUid: uid, heatId, spaceId, firingType, stage,
      ...(reservationId ? { reservationId } : {}),
      firingId: stage === "already_unloaded" && firingSource === "portal" ? firingId : null,
      manualFiring: stage === "already_unloaded" && firingSource === "studio_record" ? { date: firingDate, kiln, evidence } : null,
      reviewedExistingTicketsAndPayments: reviewed, privateRequested, rushRequested, communitySharingAllowed, note,
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setStorageError("Unable to save recovery information. No request was sent.");
      setBusy(false);
      return;
    }
    setPendingRequest(request);
    try {
      const response = await client.postJson<{ ok: boolean; data: { ticketId: string; duplicate: boolean } }>("staffCreateFiringTicket", request);
      try { sessionStorage.removeItem(storageKey); } catch { /* A replay remains safe if cleanup fails. */ }
      setResult(response.data.ticketId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="card staff-console-card staff-ticket-create" aria-labelledby="staff-create-ticket-title">
    <h2 id="staff-create-ticket-title">New firing ticket</h2>
    {result ? <div role="status"><p>Ticket {result} saved. No invoice or firing was created.</p><button type="button" onClick={onClose}>Close and refresh tickets</button></div> :
      <form onSubmit={(event) => void submit(event)}>
        <p>Choose the client and review their tickets before creating a new record.</p>
        {error ? <p role="alert">{error}</p> : null}
        {storageError ? <p role="alert">{storageError}</p> : null}
        {!options && !error ? <p role="status">Loading clients, firings, and tickets…</p> : null}
        {options ? <fieldset disabled={Boolean(pendingRequest) || Boolean(storageError) || busy}>
          <label>Find client <input value={search} onChange={(e) => { setSearch(e.target.value); setUid(""); setReviewed(false); }} /></label>
          {options.limits.users >= 500 || options.limits.profiles >= 500 ? <p role="alert">The client list reached its limit. A missing client may exist outside this list.</p> : null}
          <label>Client <select required value={uid} onChange={(e) => { setUid(e.target.value); setReviewed(false); }}>
            <option value="">Choose a client</option>{matches.map((p) => <option key={p.uid} value={p.uid}>{p.displayName} · {p.email || p.uid}</option>)}
          </select></label>
          {matches.length === 30 ? <p>Showing the first 30 matches. Refine the search to see other clients.</p> : null}
          {person ? <div><strong>Existing tickets for {person.displayName}</strong>
            {historyError ? <p role="alert">{historyError}</p> : !history ? <p role="status">Loading this client's ticket history…</p> :
              related.length ? <ul>{related.map((t) => <li key={t.ticketId}>{t.ticketId} · {t.status} · {t.billingStatus} · {t.createdAt || "date unavailable"}{t.reservationId ? ` · check-in ${t.reservationId}` : ""}{t.firingId ? ` · firing ${t.firingId}` : ""}{t.manualFiring?.date ? ` · ${t.manualFiring.date} · ${t.manualFiring.kiln}` : ""}</li>)}</ul> : <p>No matching tickets found.</p>}
            {history?.truncated ? <p role="alert">Ticket history is incomplete. Resolve this before creating a ticket.</p> : null}
            {history && !history.emailAvailable ? <p>No email is saved for this client, so email-only tickets may be missing.</p> : null}
            <p>Check other payment records too; payments outside these tickets are not shown here.</p>
          </div> : null}
          {history?.reservations?.length ? <label>Link an existing portal check-in (optional)
            <select value={reservationId} onChange={(e) => {
              const next = e.target.value; setReservationId(next); setReviewed(false);
              const reservation = history.reservations?.find((entry) => entry.reservationId === next);
              if (!reservation) { setPrivateRequested(false); setRushRequested(false); setCommunitySharingAllowed(false); return; }
              const kind = ["bisque", "glaze"].includes(reservation.firingType) ? reservation.firingType : "other";
              setFiringType(kind); setHeatId(kind === "bisque" ? "low" : kind === "glaze" ? "mid" : "custom");
              const count = reservation.estimatedHalfShelves ?? 1;
              setSpaceId(reservation.intakeMode === "WHOLE_KILN" || count >= 4 ? "large" : count >= 3 ? "triple" : count >= 2 ? "double" : "half");
              setPrivateRequested(reservation.privateRequested); setRushRequested(reservation.rushRequested); setCommunitySharingAllowed(reservation.communitySharingAllowed);
            }}>
              <option value="">No linked check-in</option>
              {history.reservations.map((entry) => { const linked = related.some((ticket) => ticket.reservationId === entry.reservationId); return <option key={entry.reservationId} value={entry.reservationId} disabled={linked}>{entry.createdAt || "Date unavailable"} · {entry.firingType || "firing unspecified"} · {entry.reservationId}{linked ? " · already linked" : ""}</option>; })}
            </select>
            <span>Requests and pricing version come from the saved check-in. Review other tickets and payments before linking.</span>
          </label> : null}
          {history?.reservationsTruncated ? <p role="alert">The check-in list is incomplete; search other records before creating a ticket.</p> : null}
          <label>Work stage <select value={stage} onChange={(e) => { setStage(e.target.value as typeof stage); setFiringId(""); setReviewed(false); }}>
            <option value="new_dropoff">New drop-off</option><option value="already_unloaded">Already fired and unloaded</option>
          </select></label>
          {stage === "already_unloaded" ? <div>
            <label>Firing record <select value={firingSource} onChange={(e) => { setFiringSource(e.target.value as typeof firingSource); setReviewed(false); }}>
              <option value="portal">Existing portal firing</option><option value="studio_record">Document a studio record</option>
            </select></label>
            {firingSource === "portal" ? <><label>Completed firing <select required aria-describedby="staff-firing-list-help" value={firingId} onChange={(e) => { setFiringId(e.target.value); setReviewed(false); }}>
            <option value="">Choose an unloaded firing</option>{unloaded.map((f) => <option key={f.id} value={f.id}>{f.title || f.id} · {f.startAt || "date unavailable"} · {f.id}</option>)}
          </select></label><p id="staff-firing-list-help">Showing up to 200 firings with recorded start dates. {unloaded.length === 0 ? "No unloaded firings found in the loaded list." : ""}</p></> : <>
            <p>Use an existing studio record or confirmed firing details. This records a reference on the ticket and does not create a kiln firing.</p>
            <label>Firing date <input type="date" required value={firingDate} onChange={(e) => { setFiringDate(e.target.value); setReviewed(false); }} /></label>
            <label>Kiln <input required maxLength={120} value={kiln} onChange={(e) => { setKiln(e.target.value); setReviewed(false); }} /></label>
            <label>How was the firing verified? <input required minLength={4} maxLength={500} value={evidence} onChange={(e) => { setEvidence(e.target.value); setReviewed(false); }} /></label>
          </>}</div> : null}
          <label>Firing type <select value={firingType} onChange={(e) => setFiringType(e.target.value)}><option value="glaze">Glaze</option><option value="bisque">Bisque</option><option value="other">Other</option></select></label>
          <label>Heat <select value={heatId} onChange={(e) => setHeatId(e.target.value)}><option value="low">Low</option><option value="mid">Mid</option><option value="high">High</option><option value="custom">Custom</option></select></label>
          <label>Space <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}><option value="half">Half shelf</option><option value="double">Two half shelves</option><option value="triple">Three half shelves</option><option value="large">Whole kiln</option></select></label>
          {stage === "new_dropoff" ? <fieldset disabled={Boolean(reservationId)}><legend>Optional requests</legend>
            <label><input type="checkbox" checked={privateRequested} onChange={(e) => setPrivateRequested(e.target.checked)} /> Private firing · +$20</label>
            <label><input type="checkbox" checked={rushRequested} onChange={(e) => setRushRequested(e.target.checked)} /> Fire tonight · +$20 if fulfilled</label>
            <label><input type="checkbox" checked={communitySharingAllowed} onChange={(e) => setCommunitySharingAllowed(e.target.checked)} /> Allow unused space to be donated to community work</label>
          </fieldset> : null}
          <label>Staff note <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></label>
          <label><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} required /> I reviewed this client’s existing tickets and payments for this work.</label>
          <p>Saving creates a ticket only. Previously fired work stays on billing review; no invoice is created.</p>
          <button className="btn btn-primary" type="submit" disabled={busy || !uid || !history || history.truncated || history.reservationsTruncated || !reviewed || (stage === "already_unloaded" && (firingSource === "portal" ? !firingId : !firingDate || !kiln.trim() || evidence.trim().length < 4))}>{busy ? "Saving…" : "Save firing ticket"}</button>
        </fieldset> : null}
        {pendingRequest && !busy ? <div>
          <p>The save result could not be confirmed. Retry the same request; it is retained in this browser tab if you close or reload the form.</p>
          <button className="btn btn-primary" type="submit">Retry same request</button>
        </div> : null}
        {(pendingRequest || storageError) && !busy ? <button type="button" onClick={() => {
          try {
            sessionStorage.removeItem(storageKey);
            setPendingRequest(null);
            setStorageError("");
            setError("");
            onClose();
          } catch { setStorageError("Unable to clear the pending request. Check the ticket list before continuing."); }
        }}>I checked the ticket list; clear pending request</button> : null}
        <button type="button" disabled={busy} onClick={onClose}>{pendingRequest ? "Close and review tickets" : "Cancel"}</button>
      </form>}
  </section>;
}
