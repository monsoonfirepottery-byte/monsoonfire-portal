import { useState } from "react";

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
  const [selected, setSelected] = useState("reservations-today");
  const areas = [
    { id: "checkins", title: "Drop-offs", label: "View drop-offs", target: "checkins", icon: "inbox", position: "intake" },
    { id: "reservations-today", title: "Reservations", label: "View calendar", target: "studio-reservations", icon: "calendar", position: "calendar" },
    { id: "firings", title: "Firings", label: "View firings", target: "firings", icon: "fire", position: "kiln" },
    { id: "finance", title: "Tickets & payments", label: "Open tickets", target: "finance", icon: "receipt", position: "counter" },
    { id: "messages", title: "Messages", label: "Open inbox", target: "messages", icon: "message", position: "desk" },
    { id: "announcements", title: "Announcements", label: "Write announcement", target: "announcementComposer", icon: "megaphone", position: "shelves" },
  ];
  const cards = lanes.flatMap((lane) => lane.cards);
  const active = areas.find((area) => area.id === selected) ?? areas[0];
  const activeCard = cards.find((card) => card.id === active.id);
  return (
    <section className="staff-task-home" data-testid="staff-task-home">
      <header className="staff-today-header">
        <div><h1>Today at the studio</h1><p>Explore the studio to see what needs your attention.</p></div>
      </header>
      <section className="staff-today-attention" aria-labelledby="staff-today-attention-heading">
        <div className="staff-today-section-heading"><h2 id="staff-today-attention-heading">Needs attention</h2><span>{attentionItems.length ? `${attentionItems.length} to review` : "All clear"}</span></div>
        {attentionItems.length === 0 ? (
          <div className="staff-note staff-note-ok">No urgent staff blockers are active right now.</div>
        ) : (
          <div className="staff-task-home-attention-list">{attentionItems.map((item) => (
            <div key={item.id} className="staff-task-home-attention-item" data-testid={`staff-task-home-attention-${item.id}`} data-tone={item.tone}>
              <div className="staff-column"><div className="staff-shift-status-reason-top"><span className={`pill ${item.tone === "action" ? "staff-pill-danger" : "staff-pill-warn"}`}>{item.tone === "action" ? "Now" : "Watch"}</span><strong>{item.title.replace(/smoke\/canary workflow failure/gi, "payment health check needs review")}</strong></div><div className="staff-mini">{item.detail}</div></div>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => onAction(item.actionTarget)}>{item.actionLabel}</button>
            </div>
          ))}</div>
        )}
      </section>
      <section className="staff-studio-overview" aria-labelledby="staff-studio-overview-heading">
        <div className="staff-today-section-heading"><div><h2 id="staff-studio-overview-heading">Studio overview</h2><p>Select a marker to see its current status.</p></div></div>
        <div className="staff-studio-scene">
          <img src="/staff-studio-overview.png" alt="Illustrated ceramics studio with a kiln, worktables, calendar, and front desk" />
          {areas.map((area) => {
            const card = cards.find((item) => item.id === area.id);
            return <button key={area.id} type="button" className={`staff-studio-marker staff-studio-marker-${area.position}`} aria-pressed={selected === area.id} aria-label={`${area.title}${card?.badge ? `: ${card.badge}` : ""}`} onClick={() => setSelected(area.id)}>
              <StudioIcon name={area.icon} /><span>{area.title}{card?.badge && <small>{card.badge}</small>}</span><i data-tone={card?.tone ?? "reference"} aria-hidden="true" />
            </button>;
          })}
        </div>
        <div className="staff-studio-picker" aria-label="Studio areas">{areas.map((area) => <button key={area.id} type="button" aria-pressed={selected === area.id} onClick={() => setSelected(area.id)}>{area.title}</button>)}</div>
        <div className="staff-studio-detail" data-testid={`staff-task-home-card-${active.id}`} aria-live="polite">
          <div className="staff-studio-detail-copy"><div className="staff-studio-detail-title"><h3>{active.title}</h3>{activeCard?.badge && <span>{activeCard.badge}</span>}</div><p>{activeCard?.badge === "Loading..." ? "Loading current activity…" : activeCard?.summary ?? "Open this area to view its current work."}</p>
            {activeCard?.metrics && activeCard.metrics.length > 0 && <dl className="staff-today-metrics">{activeCard.metrics.slice(0, 3).map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
          </div>
          <button type="button" className={resolveActionClass({ label: active.label, target: active.target, emphasis: "secondary" })} onClick={() => onAction(active.target)}>{active.label}</button>
        </div>
      </section>
    </section>
  );
}

function StudioIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    inbox: <><path d="M4 5h16v14H4z"/><path d="M4 14h5l2 2h2l2-2h5"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></>,
    fire: <path d="M12 3c1 4-3 5-3 9-1-1-2-2-2-3-3 4-2 10 5 11 7-1 8-7 4-11 0 2-1 3-2 4 1-4-1-7-2-10z"/>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></>,
    message: <path d="M4 5h16v11H9l-5 4z"/>,
    megaphone: <><path d="M4 10v4h4l9 4V6L8 10zM8 14l2 5h3l-2-4M20 9v6"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

