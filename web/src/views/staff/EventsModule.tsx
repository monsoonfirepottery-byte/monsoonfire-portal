import type { Dispatch, SetStateAction } from "react";

type RunAction = (key: string, fn: () => Promise<void>) => Promise<void>;

type EventRecord = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  startAtMs: number;
  endAtMs: number;
  remainingCapacity: number;
  capacity: number;
  waitlistCount: number;
  location: string;
  priceCents: number;
  lastStatusReason: string;
  lastStatusChangedAtMs: number;
};

type SignupRecord = {
  id: string;
  eventId: string;
  uid: string;
  displayName: string;
  email: string;
  status: string;
  paymentStatus: string;
  createdAtMs: number;
  checkedInAtMs: number;
};

type WorkshopProgrammingCluster = {
  key: string;
  label: string;
  eventCount: number;
  upcomingCount: number;
  waitlistCount: number;
  openSeats: number;
  reviewRequiredCount: number;
  demandScore: number;
  gapScore: number;
  recommendedAction: string;
  topEventTitle: string;
};

type WorkshopProgrammingKpis = {
  totalClusters: number;
  highPressure: number;
  totalWaitlist: number;
  totalDemandScore: number;
  noUpcomingCoverage: number;
};

type EventKpis = {
  total: number;
  upcoming: number;
  published: number;
  reviewRequired: number;
  openSeats: number;
  waitlisted: number;
};

type EventCreateDraft = {
  title: string;
  location: string;
  startAt: string;
  durationMinutes: string;
  capacity: string;
  priceCents: string;
};

type Props = {
  run: RunAction;
  busy: string;
  hasFunctionsAuthMismatch: boolean;
  fBaseUrl: string;
  loadEvents: () => Promise<void>;
  setStatus: (next: string) => void;
  handleExportWorkshopProgrammingBrief: () => void;
  handleLoadWorkshopProgrammingCluster: (cluster: WorkshopProgrammingCluster) => void;
  activeWorkshopProgrammingClusterLabel: string;
  workshopProgrammingKpis: WorkshopProgrammingKpis;
  workshopProgrammingClusters: WorkshopProgrammingCluster[];
  eventKpis: EventKpis;
  filteredEvents: EventRecord[];
  filteredSignups: SignupRecord[];
  selectedEventId: string;
  selectedSignupId: string;
  selectedEvent: EventRecord | null;
  selectedSignup: SignupRecord | null;
  setSelectedEventId: Dispatch<SetStateAction<string>>;
  setSelectedSignupId: Dispatch<SetStateAction<string>>;
  eventSearch: string;
  setEventSearch: Dispatch<SetStateAction<string>>;
  eventStatusFilter: string;
  setEventStatusFilter: Dispatch<SetStateAction<string>>;
  eventStatusOptions: string[];
  signupSearch: string;
  setSignupSearch: Dispatch<SetStateAction<string>>;
  signupStatusFilter: string;
  setSignupStatusFilter: Dispatch<SetStateAction<string>>;
  signupStatusOptions: string[];
  eventCreateDraft: EventCreateDraft;
  setEventCreateDraft: Dispatch<SetStateAction<EventCreateDraft>>;
  publishOverrideReason: string;
  setPublishOverrideReason: Dispatch<SetStateAction<string>>;
  eventStatusReason: string;
  setEventStatusReason: Dispatch<SetStateAction<string>>;
  createQuickEvent: () => Promise<void>;
  publishSelectedEvent: () => Promise<void>;
  setSelectedEventStatus: (nextStatus: "draft" | "cancelled") => Promise<void>;
  checkInSignupFallback: (signup: SignupRecord) => Promise<void>;
  onCheckinSignup: (signup: SignupRecord) => Promise<void>;
  loadSignups: (eventId: string) => Promise<void>;
};

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function dollars(cents: number): string {
  return `$${(Math.max(cents, 0) / 100).toFixed(2)}`;
}

export default function EventsModule(props: Props) {
  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Events</div>
        <button
          className="btn btn-secondary"
          disabled={Boolean(props.busy)}
          onClick={() =>
            void props.run("refreshEvents", async () => {
              await props.loadEvents();
              props.setStatus("Event list refreshed");
            })
          }
        >
          {props.busy === "refreshEvents" ? "Refreshing..." : "Refresh events"}
        </button>
        <button
          className="btn btn-ghost"
          disabled={Boolean(props.busy) || !props.selectedEventId}
          onClick={() =>
            void props.run("refreshEventSignups", async () => {
              if (!props.selectedEventId) return;
              await props.loadSignups(props.selectedEventId);
              props.setStatus("Event signups refreshed");
            })
          }
        >
          {props.busy === "refreshEventSignups" ? "Refreshing..." : "Refresh signups"}
        </button>
      </div>
      {props.hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Events are running in Firestore fallback mode. Function actions like check-in are disabled until auth emulator is enabled.
        </div>
      ) : null}
      <div className="staff-subtitle">Workshop programming intelligence</div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Technique clusters</span><strong>{props.workshopProgrammingKpis.totalClusters}</strong></div>
        <div className="staff-kpi"><span>High pressure</span><strong>{props.workshopProgrammingKpis.highPressure}</strong></div>
        <div className="staff-kpi"><span>Waitlist pressure</span><strong>{props.workshopProgrammingKpis.totalWaitlist}</strong></div>
        <div className="staff-kpi"><span>Demand score</span><strong>{props.workshopProgrammingKpis.totalDemandScore}</strong></div>
        <div className="staff-kpi"><span>No upcoming coverage</span><strong>{props.workshopProgrammingKpis.noUpcomingCoverage}</strong></div>
      </div>
      <div className="staff-actions-row">
        <button className="btn btn-ghost" onClick={props.handleExportWorkshopProgrammingBrief}>
          Export programming brief
        </button>
      </div>
      {props.activeWorkshopProgrammingClusterLabel ? (
        <div className="staff-note staff-note-ok">
          Quick planning is loaded from the {props.activeWorkshopProgrammingClusterLabel} cluster. Add
          the date/time, then create the next session from this console.
        </div>
      ) : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Technique</th>
              <th>Gap</th>
              <th>Demand</th>
              <th>Waitlist</th>
              <th>Upcoming</th>
              <th>Suggested action</th>
              <th>Workflow</th>
            </tr>
          </thead>
          <tbody>
            {props.workshopProgrammingClusters.length === 0 ? (
              <tr><td colSpan={7}>No workshop clusters yet. Publish events to start demand modeling.</td></tr>
            ) : (
              props.workshopProgrammingClusters.map((cluster) => (
                <tr key={cluster.key}>
                  <td>
                    <strong>{cluster.label}</strong>
                    <div className="staff-mini">{cluster.topEventTitle || "-"}</div>
                  </td>
                  <td>{cluster.gapScore}</td>
                  <td>{cluster.demandScore}</td>
                  <td>{cluster.waitlistCount}</td>
                  <td>{cluster.upcomingCount}</td>
                  <td>{cluster.recommendedAction}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => props.handleLoadWorkshopProgrammingCluster(cluster)}
                    >
                      Load into planning
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Total events</span><strong>{props.eventKpis.total}</strong></div>
        <div className="staff-kpi"><span>Upcoming</span><strong>{props.eventKpis.upcoming}</strong></div>
        <div className="staff-kpi"><span>Published</span><strong>{props.eventKpis.published}</strong></div>
        <div className="staff-kpi"><span>Needs review</span><strong>{props.eventKpis.reviewRequired}</strong></div>
        <div className="staff-kpi"><span>Open seats</span><strong>{props.eventKpis.openSeats}</strong></div>
        <div className="staff-kpi"><span>Waitlisted</span><strong>{props.eventKpis.waitlisted}</strong></div>
        <div className="staff-kpi"><span>Signups loaded</span><strong>{props.filteredSignups.length}</strong></div>
        <div className="staff-kpi"><span>Checked in</span><strong>{props.filteredSignups.filter((signup) => signup.status === "checked_in").length}</strong></div>
        <div className="staff-kpi"><span>Paid</span><strong>{props.filteredSignups.filter((signup) => signup.paymentStatus === "paid").length}</strong></div>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field staff-field-flex-2">
          Quick title
          <input
            value={props.eventCreateDraft.title}
            onChange={(event) => props.setEventCreateDraft((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Wheel Lab: Production Sprint"
          />
        </label>
        <label className="staff-field">
          Starts
          <input
            type="datetime-local"
            value={props.eventCreateDraft.startAt}
            onChange={(event) => props.setEventCreateDraft((prev) => ({ ...prev, startAt: event.target.value }))}
          />
        </label>
        <label className="staff-field">
          Duration (min)
          <input
            value={props.eventCreateDraft.durationMinutes}
            onChange={(event) => props.setEventCreateDraft((prev) => ({ ...prev, durationMinutes: event.target.value }))}
          />
        </label>
        <label className="staff-field">
          Capacity
          <input
            value={props.eventCreateDraft.capacity}
            onChange={(event) => props.setEventCreateDraft((prev) => ({ ...prev, capacity: event.target.value }))}
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(props.busy)}
          onClick={() => void props.run("createQuickEvent", props.createQuickEvent)}
        >
          Create quick event
        </button>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field staff-field-flex-1">
          Publish override reason (optional)
          <input
            value={props.publishOverrideReason}
            onChange={(event) => props.setPublishOverrideReason(event.target.value)}
            placeholder="Required only for review-gated events"
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(props.busy) || !props.selectedEvent || props.selectedEvent.status === "published"}
          onClick={() => void props.run("publishSelectedEvent", props.publishSelectedEvent)}
        >
          Publish selected
        </button>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field staff-field-flex-1">
          Status change reason {props.selectedEvent?.status !== "cancelled" ? "(required for cancel)" : "(optional)"}
          <input
            value={props.eventStatusReason}
            onChange={(event) => props.setEventStatusReason(event.target.value)}
            placeholder="Staff reason for lifecycle move"
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(props.busy) || !props.selectedEvent || props.selectedEvent.status === "draft"}
          onClick={() => void props.run("setEventDraft", async () => props.setSelectedEventStatus("draft"))}
        >
          Move to draft
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(props.busy) || !props.selectedEvent || props.selectedEvent.status === "cancelled"}
          onClick={() => void props.run("setEventCancelled", async () => props.setSelectedEventStatus("cancelled"))}
        >
          Cancel event
        </button>
      </div>
      <div className="staff-note">
        Use quick create for same-day ops. Full event copy and add-ons still live in the main Events view.
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-actions-row">
            <input
              className="staff-member-search"
              placeholder="Search events by title, status, or location"
              value={props.eventSearch}
              onChange={(event) => props.setEventSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={props.eventStatusFilter}
              onChange={(event) => props.setEventStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {props.eventStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>{statusName}</option>
              ))}
            </select>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Select</th><th>Event</th><th>Status</th><th>Starts</th><th>Seats</th><th>Waitlist</th></tr></thead>
              <tbody>
                {props.filteredEvents.length === 0 ? (
                  <tr><td colSpan={6}>No events match current filters.</td></tr>
                ) : (
                  props.filteredEvents.map((eventRow) => (
                    <tr
                      key={eventRow.id}
                      className={props.selectedEventId === eventRow.id ? "staff-selected-row" : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          aria-pressed={props.selectedEventId === eventRow.id}
                          onClick={() => props.setSelectedEventId(eventRow.id)}
                        >
                          {props.selectedEventId === eventRow.id ? "Selected" : "View"}
                        </button>
                      </td>
                      <td>
                        <div>{eventRow.title}</div>
                        <div className="staff-mini"><code>{eventRow.id}</code></div>
                      </td>
                      <td><span className="pill">{eventRow.status}</span></td>
                      <td>{eventRow.startAt || when(eventRow.startAtMs)}</td>
                      <td>{eventRow.remainingCapacity}/{eventRow.capacity}</td>
                      <td>{eventRow.waitlistCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-note">
            {props.selectedEvent ? (
              <>
                <strong>{props.selectedEvent.title}</strong><br />
                <span>{props.selectedEvent.status} · {props.selectedEvent.location}</span><br />
                <span>Starts: {props.selectedEvent.startAt || when(props.selectedEvent.startAtMs)}</span><br />
                <span>Ends: {when(props.selectedEvent.endAtMs)}</span><br />
                <span>Seats: {props.selectedEvent.remainingCapacity}/{props.selectedEvent.capacity} · Waitlist: {props.selectedEvent.waitlistCount}</span><br />
                <span>Price: {props.selectedEvent.priceCents > 0 ? dollars(props.selectedEvent.priceCents) : "Free / n/a"}</span><br />
                <span>Last status note: {props.selectedEvent.lastStatusReason || "-"}</span><br />
                <span>Status changed: {when(props.selectedEvent.lastStatusChangedAtMs)}</span>
              </>
            ) : (
              "Select an event to inspect signups."
            )}
          </div>
        </div>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-actions-row">
            <input
              className="staff-member-search"
              placeholder="Search signups by name, email, or UID"
              value={props.signupSearch}
              onChange={(event) => props.setSignupSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={props.signupStatusFilter}
              onChange={(event) => props.setSignupStatusFilter(event.target.value)}
            >
              <option value="all">All signup statuses</option>
              {props.signupStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>{statusName}</option>
              ))}
            </select>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Select</th><th>Name</th><th>Email</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead>
              <tbody>
                {props.filteredSignups.length === 0 ? (
                  <tr><td colSpan={6}>No signups match current filters.</td></tr>
                ) : (
                  props.filteredSignups.map((signup) => (
                    <tr
                      key={signup.id}
                      className={props.selectedSignupId === signup.id ? "staff-selected-row" : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          aria-pressed={props.selectedSignupId === signup.id}
                          onClick={() => props.setSelectedSignupId(signup.id)}
                        >
                          {props.selectedSignupId === signup.id ? "Selected" : "View"}
                        </button>
                      </td>
                      <td>{signup.displayName}</td>
                      <td>{signup.email}</td>
                      <td><span className="pill">{signup.status}</span></td>
                      <td>{signup.paymentStatus}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-small"
                          disabled={Boolean(props.busy) || signup.status === "checked_in" || !props.selectedEventId}
                            onClick={() =>
                              void props.run(`checkin-${signup.id}`, async () => {
                                if (props.hasFunctionsAuthMismatch) {
                                  await props.checkInSignupFallback(signup);
                                } else {
                                  await props.onCheckinSignup(signup);
                                }
                                await props.loadSignups(props.selectedEventId);
                                await props.loadEvents();
                                props.setStatus("Signup checked in");
                              })
                          }
                        >
                          {signup.status === "checked_in" ? "Checked in" : "Check in"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-note">
            {props.selectedSignup ? (
              <>
                <strong>{props.selectedSignup.displayName}</strong><br />
                <span>{props.selectedSignup.email}</span><br />
                <span>Status: {props.selectedSignup.status} · Payment: {props.selectedSignup.paymentStatus}</span><br />
                <span>Created: {when(props.selectedSignup.createdAtMs)}</span><br />
                <span>Checked in: {when(props.selectedSignup.checkedInAtMs)}</span><br />
                <code>{props.selectedSignup.uid || props.selectedSignup.id}</code>
              </>
            ) : (
              "Select a signup to inspect details."
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
