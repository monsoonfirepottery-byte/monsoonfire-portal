import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type {
  EventDetail,
  EventSignupRosterEntry,
  EventSignupSummary,
  EventSummary,
  GetEventResponse,
  ListEventSignupsResponse,
  ListEventsResponse,
  SignupForEventResponse,
  CancelEventSignupResponse,
  ClaimEventOfferResponse,
  CheckInEventResponse,
  CreateEventCheckoutSessionResponse,
} from "../api/portalContracts";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import { formatCents, formatDateTime } from "../utils/format";
import "./EventsView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

const STATUS_LABELS: Record<string, string> = {
  ticketed: "Ticketed",
  waitlisted: "Waitlisted",
  offered: "Offer pending",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  expired: "Expired",
};

const ROSTER_FILTERS = [
  { key: "all", label: "All" },
  { key: "ticketed", label: "Ticketed" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "offered", label: "Offered" },
  { key: "checked_in", label: "Checked in" },
] as const;

type Props = {
  user: User;
  adminToken?: string;
};

type RosterFilter = (typeof ROSTER_FILTERS)[number]["key"];

type RosterCounts = {
  total: number;
  ticketed: number;
  waitlisted: number;
  offered: number;
  checked_in: number;
  cancelled: number;
  expired: number;
  unpaid: number;
};

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
      ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function labelForStatus(status?: string | null) {
  if (!status) return "-";
  return STATUS_LABELS[status] || status;
}

function isActiveSignup(status?: string | null) {
  if (!status) return false;
  return status !== "cancelled" && status !== "expired";
}

function buildRosterCounts(rows: EventSignupRosterEntry[]): RosterCounts {
  const counts: RosterCounts = {
    total: 0,
    ticketed: 0,
    waitlisted: 0,
    offered: 0,
    checked_in: 0,
    cancelled: 0,
    expired: 0,
    unpaid: 0,
  };

  rows.forEach((row) => {
    counts.total += 1;
    const status = row.status || "";
    if (status in counts) {
      counts[status as keyof RosterCounts] += 1;
    }
    if (status === "checked_in" && row.paymentStatus !== "paid") {
      counts.unpaid += 1;
    }
  });

  return counts;
}

export default function EventsView({ user, adminToken }: Props) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [signup, setSignup] = useState<EventSignupSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [status, setStatus] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [roster, setRoster] = useState<EventSignupRosterEntry[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("all");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterIncludeCancelled, setRosterIncludeCancelled] = useState(false);
  const [rosterIncludeExpired, setRosterIncludeExpired] = useState(false);
  const [rosterBusyIds, setRosterBusyIds] = useState<Record<string, boolean>>({});
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const hasAdmin = !!adminToken?.trim();

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
      onLastRequest: setLastReq,
    });
  }, [adminToken, baseUrl, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    if (statusParam === "success") {
      setStatus("Payment received - thanks for supporting the event.");
    } else if (statusParam === "cancel") {
      setStatus("Checkout canceled. You can complete payment after check-in.");
    }
  }, []);

  useEffect(() => {
    if (!detail || signup?.status !== "checked_in") {
      setSelectedAddOns([]);
    }
  }, [detail?.id, signup?.status]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return events;
    return events.filter((event) => {
      return (
        event.title.toLowerCase().includes(term) ||
        event.summary.toLowerCase().includes(term)
      );
    });
  }, [events, search]);

  const selectedSummary = useMemo(
    () => events.find((event) => event.id === selectedId) || null,
    [events, selectedId]
  );

  const activeAddOns = useMemo(() => {
    return (detail?.addOns ?? []).filter((addOn) => addOn.isActive);
  }, [detail]);

  const addOnMap = useMemo(() => {
    const map = new Map<string, { priceCents: number; title: string }>();
    activeAddOns.forEach((addOn) => map.set(addOn.id, { priceCents: addOn.priceCents, title: addOn.title }));
    return map;
  }, [activeAddOns]);

  const addOnTotalCents = useMemo(() => {
    return selectedAddOns.reduce((total, id) => total + (addOnMap.get(id)?.priceCents ?? 0), 0);
  }, [addOnMap, selectedAddOns]);

  const filteredRoster = useMemo(() => {
    const term = rosterSearch.trim().toLowerCase();
    return roster.filter((row) => {
      if (rosterFilter !== "all" && row.status !== rosterFilter) return false;
      if (!term) return true;
      const haystack = `${row.displayName ?? ""} ${row.email ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [roster, rosterFilter, rosterSearch]);

  const rosterCounts = useMemo(() => buildRosterCounts(roster), [roster]);

  const loadEvents = async () => {
    setEventsLoading(true);
    setEventsError("");

    try {
      const resp = await client.postJson<ListEventsResponse>("listEvents", {
        includeDrafts: hasAdmin ? includeDrafts : false,
        includeCancelled: hasAdmin ? includeCancelled : false,
      });

      const nextEvents = resp.events ?? [];
      setEvents(nextEvents);
      setSelectedId((prev) => {
        if (prev && nextEvents.some((event) => event.id === prev)) return prev;
        return nextEvents[0]?.id ?? null;
      });
    } catch (err: any) {
      setEventsError(err?.message || String(err));
    } finally {
      setEventsLoading(false);
    }
  };

  const loadDetail = async (eventId: string) => {
    setDetailLoading(true);
    setDetailError("");

    try {
      const resp = await client.postJson<GetEventResponse>("getEvent", { eventId });
      setDetail(resp.event);
      setSignup(resp.signup ?? null);
    } catch (err: any) {
      setDetailError(err?.message || String(err));
      setDetail(null);
      setSignup(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadRoster = async (eventId: string) => {
    if (!hasAdmin) {
      setRoster([]);
      return;
    }

    setRosterLoading(true);
    setRosterError("");

    try {
      const resp = await client.postJson<ListEventSignupsResponse>("listEventSignups", {
        eventId,
        includeCancelled: rosterIncludeCancelled,
        includeExpired: rosterIncludeExpired,
        limit: 300,
      });
      setRoster(resp.signups ?? []);
    } catch (err: any) {
      setRosterError(err?.message || String(err));
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [client, includeDrafts, includeCancelled, hasAdmin]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSignup(null);
      return;
    }
    loadDetail(selectedId);
  }, [client, selectedId]);

  useEffect(() => {
    if (!selectedId || !hasAdmin) {
      setRoster([]);
      return;
    }
    loadRoster(selectedId);
  }, [client, selectedId, hasAdmin, rosterIncludeCancelled, rosterIncludeExpired]);

  const refreshAll = async () => {
    if (!selectedId) {
      await loadEvents();
      return;
    }

    await Promise.all([
      loadEvents(),
      loadDetail(selectedId),
      hasAdmin ? loadRoster(selectedId) : Promise.resolve(),
    ]);
  };

  const handleSignup = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      const resp = await client.postJson<SignupForEventResponse>("signupForEvent", {
        eventId: detail.id,
      });
      const nextStatus = resp.status === "ticketed"
        ? "You're in!"
        : "You're on the waitlist - we'll notify you if a spot opens.";
      setStatus(nextStatus);
      await refreshAll();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<CancelEventSignupResponse>("cancelEventSignup", {
        signupId: signup.id,
      });
      setStatus("Your spot has been released. Thanks for letting us know.");
      await refreshAll();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleClaimOffer = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<ClaimEventOfferResponse>("claimEventOffer", {
        signupId: signup.id,
      });
      setStatus("Offer claimed! You're confirmed.");
      await refreshAll();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSelfCheckIn = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<CheckInEventResponse>("checkInEvent", {
        signupId: signup.id,
        method: "self",
      });
      setStatus("Checked in! You can add extras and pay after you're settled.");
      await refreshAll();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCheckout = async () => {
    if (!detail || !signup?.id || checkoutBusy) return;
    setCheckoutBusy(true);
    setStatus("");

    try {
      const payload = {
        eventId: detail.id,
        signupId: signup.id,
        ...(selectedAddOns.length ? { addOnIds: selectedAddOns } : {}),
      };

      const resp = await client.postJson<CreateEventCheckoutSessionResponse>(
        "createEventCheckoutSession",
        payload
      );

      if (!resp.checkoutUrl) {
        setStatus("Checkout session created, but no URL was returned.");
        return;
      }

      window.location.assign(resp.checkoutUrl);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleStaffCheckIn = async (signupId: string) => {
    if (!signupId || rosterBusyIds[signupId]) return;

    setRosterBusyIds((prev) => ({ ...prev, [signupId]: true }));
    setStatus("");

    try {
      await client.postJson<CheckInEventResponse>("checkInEvent", {
        signupId,
        method: "staff",
      });
      setStatus("Attendee checked in.");
      if (selectedId) {
        await loadRoster(selectedId);
        await loadDetail(selectedId);
      }
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setRosterBusyIds((prev) => {
        const next = { ...prev };
        delete next[signupId];
        return next;
      });
    }
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const isSoldOut = selectedSummary?.remainingCapacity === 0 && detail?.waitlistEnabled === false;
  const canSignup = !!detail && (!signup || !isActiveSignup(signup.status)) && detail.status === "published";
  const canCancel = !!signup && isActiveSignup(signup.status) && signup.status !== "checked_in";
  const canClaim = signup?.status === "offered";
  const canCheckIn = signup?.status === "ticketed";
  const canCheckout = signup?.status === "checked_in" && signup.paymentStatus !== "paid";

  const joinLabel =
    selectedSummary?.remainingCapacity === 0 && detail?.waitlistEnabled
      ? "Join waitlist"
      : "Reserve ticket";

  const detailRemainingLabel =
    selectedSummary?.remainingCapacity === null || selectedSummary?.remainingCapacity === undefined
      ? ""
      : ` | ${selectedSummary.remainingCapacity} left`;

  return (
    <div className="page events-page">
      <div className="page-header">
        <div>
          <h1>Events & workshops</h1>
          <p className="page-subtitle">
            One-night experiences, studio collaborations, and firing-focused gatherings.
          </p>
        </div>
      </div>

      <section className="card card-3d events-hero">
        <div>
          <div className="card-title">Low-stress, attendance-only billing</div>
          <p className="events-copy">
            You won&apos;t be charged unless you attend. If plans change, no worries - cancel anytime up to
            3 hours before the event.
          </p>
        </div>
        <div className="events-hero-meta">
          <div>
            <span className="summary-label">Check-in</span>
            <span className="summary-value">Required to pay</span>
          </div>
          <div>
            <span className="summary-label">Waitlist</span>
            <span className="summary-value">Auto-promote, 12-hour claim</span>
          </div>
          <div>
            <span className="summary-label">Status</span>
            <span className="summary-value">{status || "Ready for the next event"}</span>
          </div>
        </div>
      </section>

      <section className="events-toolbar">
        <div className="events-search">
          <label htmlFor="events-search">Search events</label>
          <input
            id="events-search"
            type="text"
            placeholder="Raku night, firing fees, glaze dinner..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="events-actions">
          <button className="btn btn-ghost" onClick={refreshAll}>
            Refresh
          </button>
        </div>
        {hasAdmin ? (
          <div className="events-admin-toggle">
            <label>
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(event) => setIncludeDrafts(event.target.checked)}
              />
              Include drafts
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(event) => setIncludeCancelled(event.target.checked)}
              />
              Include cancelled
            </label>
          </div>
        ) : null}
      </section>

      <div className="events-layout">
        <section className="card card-3d events-list">
          <div className="card-title">Upcoming events</div>
          {eventsLoading ? <div className="events-loading">Loading events...</div> : null}
          {eventsError ? <div className="alert inline-alert">{eventsError}</div> : null}

          {!eventsLoading && filteredEvents.length === 0 ? (
            <div className="events-empty">
              No events found yet. Check back soon for the next studio drop.
            </div>
          ) : null}

          <div className="events-cards">
            {filteredEvents.map((event) => {
              const isActive = event.id === selectedId;
              const remaining = event.remainingCapacity ?? null;
              const remainingLabel = remaining === null ? "-" : `${remaining} left`;
              return (
                <button
                  key={event.id}
                  className={`event-card ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <div className="event-card-header">
                    <div>
                      <div className="event-title">{event.title}</div>
                      <div className="event-summary">{event.summary}</div>
                    </div>
                    <div className="event-price">{formatCents(event.priceCents)}</div>
                  </div>
                  <div className="event-meta">
                    <span>{formatDateTime(event.startAt)}</span>
                    <span>{event.location || "Studio"}</span>
                  </div>
                  <div className="event-tags">
                    <span className={`event-tag ${event.includesFiring ? "accent" : ""}`}>
                      {event.includesFiring ? "Firing included" : "Studio event"}
                    </span>
                    {event.waitlistEnabled ? <span className="event-tag">Waitlist</span> : null}
                    <span className="event-tag">{remainingLabel}</span>
                    <span className={`event-tag status-${event.status}`}>{event.status}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card card-3d events-detail">
          <div className="card-title">Event details</div>
          {detailLoading ? <div className="events-loading">Loading details...</div> : null}
          {detailError ? <div className="alert inline-alert">{detailError}</div> : null}

          {!detailLoading && detail ? (
            <div className="events-detail-body">
              <div className="detail-header">
                <div>
                  <h2>{detail.title}</h2>
                  <div className="detail-summary">{detail.summary}</div>
                </div>
                <div className="detail-price">{formatCents(detail.priceCents)}</div>
              </div>

              <div className="detail-grid">
                <div>
                  <span className="summary-label">When</span>
                  <span className="summary-value">{formatDateTime(detail.startAt)}</span>
                </div>
                <div>
                  <span className="summary-label">Ends</span>
                  <span className="summary-value">{formatDateTime(detail.endAt)}</span>
                </div>
                <div>
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{detail.location || "Studio"}</span>
                </div>
                <div>
                  <span className="summary-label">Time zone</span>
                  <span className="summary-value">{detail.timezone || "Local"}</span>
                </div>
                <div>
                  <span className="summary-label">Capacity</span>
                  <span className="summary-value">
                    {detail.capacity} total{detailRemainingLabel}
                  </span>
                </div>
                <div>
                  <span className="summary-label">Firing</span>
                  <span className="summary-value">
                    {detail.includesFiring ? detail.firingDetails || "Included" : "Not included"}
                  </span>
                </div>
              </div>

              <p className="events-copy">{detail.description}</p>

              <div className="detail-policy">
                <div className="policy-title">Low-stress policy</div>
                <p className="events-copy">{detail.policyCopy}</p>
              </div>

              <div className="ticket-card">
                <div className="ticket-top">
                  <div>
                    <div className="ticket-label">Your ticket</div>
                    <div className="ticket-status">{signup ? labelForStatus(signup.status) : "Not signed up"}</div>
                  </div>
                  {signup?.status === "checked_in" && signup.paymentStatus ? (
                    <span className={`event-tag ${signup.paymentStatus === "paid" ? "accent" : ""}`}>
                      {signup.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                    </span>
                  ) : null}
                </div>
                {signup?.status === "offered" && signup ? (
                  <div className="ticket-note">
                    Offer expires in {detail.offerClaimWindowHours ?? 12} hours - claim to keep your spot.
                  </div>
                ) : null}
                <div className="ticket-actions">
                  {canSignup ? (
                    <button
                      className="btn btn-primary"
                      onClick={handleSignup}
                      disabled={actionBusy || isSoldOut}
                    >
                      {actionBusy ? "Working..." : isSoldOut ? "Sold out" : joinLabel}
                    </button>
                  ) : null}
                  {canClaim ? (
                    <button className="btn btn-primary" onClick={handleClaimOffer} disabled={actionBusy}>
                      {actionBusy ? "Claiming..." : "Claim offer"}
                    </button>
                  ) : null}
                  {canCheckIn ? (
                    <button className="btn btn-primary" onClick={handleSelfCheckIn} disabled={actionBusy}>
                      {actionBusy ? "Checking in..." : "Check in now"}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button className="btn btn-ghost" onClick={handleCancel} disabled={actionBusy}>
                      {actionBusy ? "Canceling..." : "Cancel"}
                    </button>
                  ) : null}
                </div>
              </div>

              {signup?.status === "checked_in" ? (
                <div className="add-ons">
                  <div className="add-ons-title">Add-ons (select at check-in)</div>
                  {activeAddOns.length === 0 ? (
                    <div className="events-empty">No add-ons offered for this event.</div>
                  ) : (
                    <div className="add-ons-list">
                      {activeAddOns.map((addOn) => (
                        <label key={addOn.id} className="add-on-row">
                          <input
                            type="checkbox"
                            checked={selectedAddOns.includes(addOn.id)}
                            onChange={() => toggleAddOn(addOn.id)}
                          />
                          <span>{addOn.title}</span>
                          <span className="add-on-price">{formatCents(addOn.priceCents)}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="add-ons-footer">
                    <div>
                      <span className="summary-label">Add-on total</span>
                      <span className="summary-value">{formatCents(addOnTotalCents)}</span>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleCheckout}
                      disabled={!canCheckout || checkoutBusy}
                    >
                      {checkoutBusy ? "Starting checkout..." : "Pay for ticket"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!detailLoading && !detail ? (
            <div className="events-empty">Select an event to see details.</div>
          ) : null}
        </section>

        <aside className="card card-3d events-staff">
          <div className="card-title">Staff check-in</div>
          {!hasAdmin ? (
            <div className="events-empty">
              Paste the admin token to unlock the roster and staff check-in.
            </div>
          ) : null}

          {hasAdmin ? (
            <>
              <div className="staff-summary">
                <div>
                  <span className="summary-label">Roster</span>
                  <span className="summary-value">{rosterCounts.total} total</span>
                </div>
                <div>
                  <span className="summary-label">Unpaid</span>
                  <span className="summary-value">{rosterCounts.unpaid}</span>
                </div>
              </div>

              <div className="staff-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={rosterIncludeCancelled}
                    onChange={(event) => setRosterIncludeCancelled(event.target.checked)}
                  />
                  Include cancelled
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={rosterIncludeExpired}
                    onChange={(event) => setRosterIncludeExpired(event.target.checked)}
                  />
                  Include expired
                </label>
              </div>

              <div className="staff-filters">
                {ROSTER_FILTERS.map((item) => (
                  <button
                    key={item.key}
                    className={`events-chip ${rosterFilter === item.key ? "active" : ""}`}
                    onClick={() => setRosterFilter(item.key)}
                  >
                    {item.label}
                    <span className="events-chip-count">
                      {item.key === "all" ? rosterCounts.total : rosterCounts[item.key] ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              <div className="events-search">
                <label htmlFor="roster-search">Search roster</label>
                <input
                  id="roster-search"
                  type="text"
                  placeholder="Name or email"
                  value={rosterSearch}
                  onChange={(event) => setRosterSearch(event.target.value)}
                />
              </div>

              {rosterLoading ? <div className="events-loading">Loading roster...</div> : null}
              {rosterError ? <div className="alert inline-alert">{rosterError}</div> : null}

              <div className="roster-list">
                {filteredRoster.map((row) => {
                  const unpaid = row.status === "checked_in" && row.paymentStatus !== "paid";
                  return (
                    <div key={row.id} className={`roster-row ${unpaid ? "unpaid" : ""}`}>
                      <div>
                        <div className="roster-name">{row.displayName || "Attendee"}</div>
                        <div className="roster-meta">
                          {row.email || row.uid || ""}
                        </div>
                        <div className="roster-status">{labelForStatus(row.status)}</div>
                      </div>
                      <div className="roster-actions">
                        {unpaid ? <span className="event-tag">UNPAID</span> : null}
                        {row.status === "ticketed" ? (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleStaffCheckIn(row.id)}
                            disabled={!!rosterBusyIds[row.id]}
                          >
                            {rosterBusyIds[row.id] ? "Checking..." : "Check in"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {!rosterLoading && filteredRoster.length === 0 ? (
                  <div className="events-empty">No roster entries for this filter.</div>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>
      </div>

      <TroubleshootingPanel
        lastReq={lastReq}
        curl={client.getLastCurl()}
        onStatus={(msg) => setStatus(msg)}
      />
    </div>
  );
}
