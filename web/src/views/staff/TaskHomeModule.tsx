export type StaffTaskHomeTone = "action" | "watch" | "clear" | "reference";

export type StaffTaskHomeAction = {
  label: string;
  target: string;
  emphasis?: "primary" | "secondary" | "ghost";
};

export type StaffTaskHomeMetric = {
  label: string;
  value: string;
};

export type StaffTaskHomeCard = {
  id: string;
  eyebrow: string;
  title: string;
  badge: string;
  tone: StaffTaskHomeTone;
  summary: string;
  note?: string;
  metrics?: ReadonlyArray<StaffTaskHomeMetric>;
  actions: ReadonlyArray<StaffTaskHomeAction>;
};

export type StaffTaskHomeLane = {
  id: string;
  title: string;
  subtitle: string;
  cards: ReadonlyArray<StaffTaskHomeCard>;
};

export type StaffTaskHomeAttentionItem = {
  id: string;
  tone: "action" | "watch";
  title: string;
  detail: string;
  actionLabel: string;
  actionTarget: string;
};

export type StaffTaskHomeMoreAction = {
  id: string;
  label: string;
  description: string;
  target: string;
};

type TaskHomeModuleProps = {
  title: string;
  summary: string;
  clickBudgetNote: string;
  attentionItems: ReadonlyArray<StaffTaskHomeAttentionItem>;
  lanes: ReadonlyArray<StaffTaskHomeLane>;
  moreActions: ReadonlyArray<StaffTaskHomeMoreAction>;
  onAction: (target: string) => void;
};

function resolveActionClass(action: StaffTaskHomeAction): string {
  switch (action.emphasis) {
    case "secondary":
      return "btn btn-secondary btn-small";
    case "ghost":
      return "btn btn-ghost btn-small";
    default:
      return "btn btn-primary btn-small";
  }
}

export default function TaskHomeModule({
  attentionItems,
  lanes,
  onAction,
}: TaskHomeModuleProps) {
  return (
    <section className="staff-task-home" data-testid="staff-task-home">
      <section className="card staff-console-card staff-task-home-hero">
        <div className="staff-column">
          <h1>Today at the studio</h1>
          <p className="card-subtitle">Drop-offs, firings, pickups, and client messages.</p>
        </div>
      </section>

      <section className="card staff-console-card">
        <div className="card-title">Needs attention now</div>
        {attentionItems.length === 0 ? (
          <div className="staff-note staff-note-ok">No urgent staff blockers are active right now.</div>
        ) : (
          <div className="staff-task-home-attention-list">
            {attentionItems.map((item) => (
              <div
                key={item.id}
                className="staff-task-home-attention-item"
                data-testid={`staff-task-home-attention-${item.id}`}
                data-tone={item.tone}
              >
                <div className="staff-column">
                  <div className="staff-shift-status-reason-top">
                    <span className={`pill ${item.tone === "action" ? "staff-pill-danger" : "staff-pill-warn"}`}>
                      {item.tone === "action" ? "Now" : "Watch"}
                    </span>
                    <strong>{item.title.replace(/smoke\/canary workflow failure/gi, "payment health check needs review")}</strong>
                  </div>
                  <div className="staff-mini">{item.detail}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => onAction(item.actionTarget)}
                >
                  {item.actionLabel}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="staff-daily-work" aria-label="Today's work">
        {[
          { id: "finance", title: "Tickets & payments", detail: "Review work, email an invoice, or finish a pickup.", label: "Open tickets", target: "finance" },
          { id: "checkins", title: "Drop-offs", detail: "Check in arriving work and review the intake queue.", label: "View drop-offs", target: "checkins" },
          { id: "reservations-today", title: "Reservations", detail: "Today's arrivals and the studio calendar.", label: "View calendar", target: "studioReservations" },
          { id: "firings", title: "Firings", detail: "Kiln schedules and work in progress.", label: "View firings", target: "firings" },
          { id: "messages", title: "Messages", detail: "Client questions and replies.", label: "Open inbox", target: "messages" },
          { id: "announcements", title: "Studio announcements", detail: "Send a studio update to clients.", label: "Write announcement", target: "announcementComposer" },
        ].map((row) => {
          const card = lanes.flatMap((lane) => lane.cards).find((item) => item.id === row.id);
          return <article key={row.id} className="staff-daily-work-row" data-testid={`staff-task-home-card-${row.id}`}>
            <div><h2>{row.title}</h2><p>{row.detail}</p></div>
            <span className="staff-daily-work-state">{card?.badge ?? ""}</span>
            <button type="button" className={resolveActionClass({label:row.label,target:row.target,emphasis:"secondary"})} onClick={() => onAction(row.target)}>{row.label}</button>
          </article>;
        })}
      </section>
    </section>
  );
}
