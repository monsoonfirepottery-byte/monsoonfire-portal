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
  title,
  summary,
  clickBudgetNote,
  attentionItems,
  lanes,
  moreActions,
  onAction,
}: TaskHomeModuleProps) {
  return (
    <section className="staff-task-home" data-testid="staff-task-home">
      <section className="card staff-console-card staff-task-home-hero">
        <div className="staff-column">
          <div className="staff-subtitle">Task-first staff home</div>
          <div className="card-title">{title}</div>
          <p className="card-subtitle">{summary}</p>
        </div>
        <div className="staff-note staff-note-muted">{clickBudgetNote}</div>
      </section>

      <section className="card staff-console-card">
        <div className="card-title">Needs attention now</div>
        <p className="card-subtitle">A short queue for the next highest-value move on shift.</p>
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
                    <strong>{item.title}</strong>
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

      {lanes.map((lane) => (
        <section key={lane.id} className="staff-task-home-lane" data-testid={`staff-task-home-lane-${lane.id}`}>
          <div className="staff-task-home-lane-header">
            <div className="staff-column">
              <div className="card-title">{lane.title}</div>
              <p className="card-subtitle">{lane.subtitle}</p>
            </div>
          </div>
          <div className="staff-task-home-lane-grid">
            {lane.cards.map((card) => (
              <section
                key={card.id}
                className="card staff-console-card staff-task-home-card"
                data-testid={`staff-task-home-card-${card.id}`}
                data-tone={card.tone}
              >
                <div className="staff-task-home-card-header">
                  <div className="staff-column">
                    <div className="staff-subtitle">{card.eyebrow}</div>
                    <div className="card-title">{card.title}</div>
                  </div>
                  <span className={`pill staff-task-home-card-badge staff-task-home-card-badge-${card.tone}`}>
                    {card.badge}
                  </span>
                </div>
                <p className="card-subtitle">{card.summary}</p>
                {card.metrics?.length ? (
                  <div className="staff-task-home-card-metrics">
                    {card.metrics.map((metric) => (
                      <div key={`${card.id}-${metric.label}`} className="staff-task-home-card-metric">
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                {card.note ? <div className="staff-note staff-note-muted">{card.note}</div> : null}
                <div className="staff-actions-row">
                  {card.actions.map((action) => (
                    <button
                      key={`${card.id}-${action.label}`}
                      type="button"
                      className={resolveActionClass(action)}
                      onClick={() => onAction(action.target)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ))}

      <details className="card staff-console-card staff-task-home-more" data-testid="staff-task-home-more">
        <summary>More tools</summary>
        <div className="staff-note staff-note-muted">
          Rare and power-user tools stay here so the main board can stay focused on live staff work.
        </div>
        <div className="staff-task-home-more-grid">
          {moreActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="staff-task-home-more-btn"
              data-testid={`staff-task-home-more-${action.id}`}
              onClick={() => onAction(action.target)}
            >
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
