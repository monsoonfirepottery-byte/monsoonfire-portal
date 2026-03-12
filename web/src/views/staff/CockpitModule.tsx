import { type ChangeEvent, type ReactNode } from "react";

type TodayReservationRow = {
  id: string;
  displayName: string;
  timeMs: number;
  status: string;
  itemCount: number;
  visitType: string;
  notes: string;
};

type TodayMessageRow = {
  id: string;
  sender: string;
  snippet: string;
  kind: string;
  atMs: number;
  unread: boolean;
};

type TodayPaymentAlert = {
  id: string;
  severity: "P0" | "P1";
  title: string;
  detail: string;
};

type ActiveFiringSummary = {
  label: string;
  startedLabel: string;
  updatedLabel: string;
};

type CockpitModuleProps = {
  busy: string;
  cockpitOpsContent: ReactNode;
  shortText: (value: string, max: number) => string;
  toShortTimeLabel: (valueMs: number) => string;

  openReservationsToday: () => void;
  openMessagesInbox: () => void;
  startFiringFlow: () => void;
  onOpenMessage: (threadId: string) => void;

  refreshTodayReservations: () => Promise<void>;
  refreshTodayFirings: () => Promise<void>;
  retryTodayReservations: () => Promise<void>;
  retryTodayFirings: () => Promise<void>;
  refreshTodayPayments: () => Promise<void>;

  openReservationDetail: (reservationId: string) => void;
  handleFiringPhotoFile: (file: File | null) => Promise<void>;

  todayReservations: ReadonlyArray<TodayReservationRow>;
  todayReservationsLoading: boolean;
  todayReservationsError: string;

  unreadMessageCount: number;
  announcementsCount: number;
  unreadAnnouncements: number;
  messageThreadsLoading: boolean;
  announcementsLoading: boolean;
  messagesDegraded: boolean;
  messageThreadsError: string;
  announcementsError: string;
  todayMessageRows: ReadonlyArray<TodayMessageRow>;

  firingsLoading: boolean;
  firingsError: string;
  activeFiring: ActiveFiringSummary | null;
  firingPhotoBusy: boolean;
  firingPhotoStatus: string;
  firingPhotoError: string;

  commerceLoading: boolean;
  paymentDegraded: boolean;
  commerceError: string;
  paymentAlerts: ReadonlyArray<TodayPaymentAlert>;
};

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

export default function CockpitModule({
  busy,
  cockpitOpsContent,
  shortText,
  toShortTimeLabel,
  openReservationsToday,
  openMessagesInbox,
  startFiringFlow,
  onOpenMessage,
  refreshTodayReservations,
  refreshTodayFirings,
  retryTodayReservations,
  retryTodayFirings,
  refreshTodayPayments,
  openReservationDetail,
  handleFiringPhotoFile,
  todayReservations,
  todayReservationsLoading,
  todayReservationsError,
  unreadMessageCount,
  announcementsCount,
  unreadAnnouncements,
  messageThreadsLoading,
  announcementsLoading,
  messagesDegraded,
  messageThreadsError,
  announcementsError,
  todayMessageRows,
  firingsLoading,
  firingsError,
  activeFiring,
  firingPhotoBusy,
  firingPhotoStatus,
  firingPhotoError,
  commerceLoading,
  paymentDegraded,
  commerceError,
  paymentAlerts,
}: CockpitModuleProps) {
  const onPhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void handleFiringPhotoFile(file);
    event.currentTarget.value = "";
  };

  return (
    <section className="staff-today-console">
      <section className="card staff-console-card">
        <div className="card-title">Quick actions</div>
        <p className="card-subtitle">Action queue style quick actions for the most common daily staff priorities.</p>
        <div className="staff-quick-actions">
          <button className="btn btn-primary staff-quick-action-btn" onClick={() => void openReservationsToday()}>
            View reservations (today)
          </button>
          <button className="btn btn-primary staff-quick-action-btn" onClick={() => void openMessagesInbox()}>
            Open messages
          </button>
          <button className="btn btn-primary staff-quick-action-btn" onClick={() => void startFiringFlow()}>
            Start firing
          </button>
        </div>
      </section>

      <section className="staff-module-grid staff-today-overview-grid">
        <section className="card staff-console-card staff-today-card">
          <div className="card-title-row">
            <div className="card-title">Reservations today</div>
            <button
              className="btn btn-secondary btn-small"
              disabled={Boolean(busy) || todayReservationsLoading}
              onClick={() => void refreshTodayReservations()}
            >
              {todayReservationsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="card-subtitle">
            Fast scan for who is due today, when they are expected, and what needs prep.
          </p>
          {todayReservationsLoading ? (
            <div className="staff-skeleton-list" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`today-reservation-skeleton-${index}`} className="staff-skeleton-row" />
              ))}
            </div>
          ) : todayReservationsError ? (
            <>
              <div className="staff-note staff-note-error">Reservations are temporarily unavailable: {todayReservationsError}</div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary btn-small" onClick={() => void retryTodayReservations()}>
                  Retry
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => void openReservationsToday()}>
                  Open reservations
                </button>
              </div>
            </>
          ) : todayReservations.length === 0 ? (
            <>
              <div className="staff-note">No reservations due today.</div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary btn-small" onClick={() => void openReservationsToday()}>
                  Open full calendar
                </button>
              </div>
            </>
          ) : (
            <>
              <ul className="staff-today-list" aria-label="Reservations today">
                {todayReservations.map((reservation) => (
                  <li key={reservation.id}>
                    <button type="button" className="staff-today-row" onClick={() => openReservationDetail(reservation.id)}>
                      <div className="staff-today-row-top">
                        <strong>{reservation.displayName}</strong>
                        <span>{toShortTimeLabel(reservation.timeMs)}</span>
                      </div>
                      <div className="staff-today-row-meta">
                        <span>{reservation.itemCount} item{reservation.itemCount === 1 ? "" : "s"}</span>
                        <span className="pill">{reservation.status}</span>
                        <span>{reservation.visitType}</span>
                      </div>
                      {reservation.notes ? <div className="staff-today-row-note">{shortText(reservation.notes, 120)}</div> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="staff-actions-row">
                <button className="btn btn-ghost btn-small" onClick={() => void openReservationsToday()}>
                  View all reservations
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card staff-console-card staff-today-card">
          <div className="card-title-row">
            <div className="card-title">Messages</div>
            <button className="btn btn-secondary btn-small" onClick={() => void openMessagesInbox()}>
              Open inbox
            </button>
          </div>
          <p className="card-subtitle">
            Unread conversations, support requests, and operational communication in one quick list.
          </p>
          <div className="staff-meta-inline">
            <span className="pill">Unread {unreadMessageCount}</span>
            <span className="pill">Unread announcements {unreadAnnouncements}</span>
            <span className="pill">Announcements {announcementsCount}</span>
          </div>
          {messageThreadsLoading || announcementsLoading ? (
            <div className="staff-skeleton-list" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`today-message-skeleton-${index}`} className="staff-skeleton-row" />
              ))}
            </div>
          ) : messageThreadsError || announcementsError || messagesDegraded ? (
            <>
              <div className="staff-note staff-note-warn">
                Degraded mode: message feeds may be delayed.
                {messageThreadsError ? ` Threads: ${messageThreadsError}.` : ""}
                {announcementsError ? ` Announcements: ${announcementsError}.` : ""}
              </div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary btn-small" onClick={() => void openMessagesInbox()}>
                  View all messages
                </button>
              </div>
            </>
          ) : todayMessageRows.length === 0 ? (
            <>
              <div className="staff-note">No active conversations right now.</div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary btn-small" onClick={() => void openMessagesInbox()}>
                  Send message
                </button>
              </div>
            </>
          ) : (
            <>
              <ul className="staff-today-list" aria-label="Recent messages">
                {todayMessageRows.map((thread) => (
                  <li key={thread.id}>
                    <button type="button" className="staff-today-row" onClick={() => onOpenMessage(thread.id)}>
                      <div className="staff-today-row-top">
                        <strong>{thread.sender}</strong>
                        <span>{thread.atMs ? when(thread.atMs) : "-"}</span>
                      </div>
                      <div className="staff-today-row-meta">
                        <span>{thread.kind || "direct"}</span>
                        {thread.unread ? <span className="staff-unread-dot">Unread</span> : <span>Read</span>}
                      </div>
                      <div className="staff-today-row-note">{shortText(thread.snippet, 120)}</div>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="staff-actions-row">
                <button className="btn btn-ghost btn-small" onClick={() => void openMessagesInbox()}>
                  View all messages
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => void openMessagesInbox()}>
                  Send message
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card staff-console-card staff-today-card">
          <div className="card-title-row">
            <div className="card-title">Firings</div>
            <button
              className="btn btn-secondary btn-small"
              disabled={Boolean(busy) || firingsLoading}
              onClick={() => void refreshTodayFirings()}
            >
              {firingsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="card-subtitle">
            Single active firing model with quick launch and iPad photo capture for kiln evidence.
          </p>
          {firingsLoading ? (
            <div className="staff-skeleton-list" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`today-firing-skeleton-${index}`} className="staff-skeleton-row" />
              ))}
            </div>
          ) : firingsError ? (
            <>
              <div className="staff-note staff-note-error">Firings are unavailable: {firingsError}</div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary btn-small" onClick={() => void retryTodayFirings()}>
                  Retry
                </button>
              </div>
            </>
          ) : activeFiring ? (
            <>
              <div className="staff-note">
                <strong>{activeFiring.label}</strong>
                <div className="staff-mini">Started {activeFiring.startedLabel} · last update {activeFiring.updatedLabel}</div>
              </div>
              <div className="staff-actions-row">
                <button className="btn btn-ghost btn-small" onClick={() => void startFiringFlow()}>
                  Start new firing
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="staff-note">No active firing. Start a new run from the queue workflow.</div>
              <div className="staff-actions-row">
                <button className="btn btn-primary btn-small" onClick={() => void startFiringFlow()}>
                  Start New Firing
                </button>
              </div>
            </>
          )}
          <label className="staff-field">
            Capture kiln/status photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={firingPhotoBusy}
              onChange={onPhotoSelected}
            />
          </label>
          <div className="staff-mini">
            Photos now upload to portal storage. Existing Kilnfire storage remains intact during migration.
          </div>
          {firingPhotoStatus ? <div className="staff-note staff-note-ok">{firingPhotoStatus}</div> : null}
          {firingPhotoError ? <div className="staff-note staff-note-error">{firingPhotoError}</div> : null}
        </section>

        <section className="card staff-console-card staff-today-card">
          <div className="card-title-row">
            <div className="card-title">Payment alerts (P0/P1)</div>
            <button
              className="btn btn-secondary btn-small"
              disabled={Boolean(busy) || commerceLoading}
              onClick={() => void refreshTodayPayments()}
            >
              {commerceLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="card-subtitle">
            Critical payment and smoke/canary risk signals only. Use details links for full transaction workflows.
          </p>
          {paymentDegraded ? (
            <div className="staff-note staff-note-warn">
              Degraded mode: payments status may be delayed.
              {commerceError ? ` ${commerceError}` : ""}
            </div>
          ) : null}
          {commerceLoading ? (
            <div className="staff-skeleton-list" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`today-payment-skeleton-${index}`} className="staff-skeleton-row" />
              ))}
            </div>
          ) : paymentAlerts.length === 0 ? (
            <>
              <div className="staff-note">No P0/P1 payment alerts right now.</div>
            </>
          ) : (
            <>
              <ul className="staff-today-list" aria-label="Payment alerts">
                {paymentAlerts.map((alert) => (
                  <li key={alert.id}>
                    <div className="staff-today-row staff-today-row-static">
                      <div className="staff-today-row-top">
                        <strong>{alert.title}</strong>
                        <span className={`pill ${alert.severity === "P0" ? "staff-pill-danger" : "staff-pill-warn"}`}>
                          {alert.severity}
                        </span>
                      </div>
                      <div className="staff-today-row-note">{alert.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </section>

      {cockpitOpsContent}
    </section>
  );
}
