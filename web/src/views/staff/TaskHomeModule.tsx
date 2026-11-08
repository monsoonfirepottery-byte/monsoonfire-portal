import { flushSync } from "react-dom";

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

type TaskHomeModuleProps = {
  attentionItems: ReadonlyArray<StaffTaskHomeAttentionItem>;
  pickupQueueState?: "checking" | "ready" | "error";
  onRetryPickupQueue?: () => void;
  lanes: ReadonlyArray<StaffTaskHomeLane>;
  onAction: (target: string) => void;
};

function enterStudioArea(target: string, onAction: (target: string) => void, source: HTMLElement) {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || typeof document.startViewTransition !== "function") {
    onAction(target);
    return;
  }
  const bounds = source.getBoundingClientRect();
  root.style.setProperty("--studio-entry-x", `${bounds.left + bounds.width / 2}px`);
  root.style.setProperty("--studio-entry-y", `${bounds.top + bounds.height / 2}px`);
  root.classList.add("staff-studio-transition");
  let navigated = false;
  const navigate = () => { navigated = true; flushSync(() => onAction(target)); };
  const cleanup = () => {
    root.classList.remove("staff-studio-transition");
    root.style.removeProperty("--studio-entry-x");
    root.style.removeProperty("--studio-entry-y");
  };
  try {
    const transition = document.startViewTransition(navigate);
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    if (!navigated) onAction(target);
  }
}

export default function TaskHomeModule({
  attentionItems,
  pickupQueueState,
  onRetryPickupQueue,
  lanes,
  onAction,
}: TaskHomeModuleProps) {
  const areas = [
    { id: "pathfinder", title: "Plan a drop-off", label: "Open Pathfinder", target: "pathfinder", icon: "inbox", position: "intake" },
    { id: "reservations-today", title: "Reservations", label: "View calendar", target: "studio-reservations", icon: "calendar", position: "calendar" },
    { id: "firings", title: "Kiln schedule", label: "View kiln schedule", target: "kilnSchedule", icon: "fire", position: "kiln" },
    { id: "finance", title: "Tickets & payments", label: "Open tickets", target: "finance", icon: "receipt", position: "counter" },
    { id: "messages", title: "Messages", label: "Open inbox", target: "messages", icon: "message", position: "desk" },
    { id: "announcements", title: "Announcements", label: "Write announcement", target: "announcementComposer", icon: "megaphone", position: "shelves" },
  ];
  const cards = lanes.flatMap((lane) => lane.cards);
  return (
    <section className="staff-task-home" data-testid="staff-task-home">
      <header className="staff-today-header">
        <div><h1>Today at the studio</h1><p>Explore the studio to see what needs your attention.</p></div>
      </header>
      <section className="staff-today-attention" aria-labelledby="staff-today-attention-heading">
        <div className="staff-today-section-heading"><h2 id="staff-today-attention-heading">Needs attention</h2><span>{attentionItems.length ? `${attentionItems.length} to review` : pickupQueueState === "checking" ? "Checking tickets…" : pickupQueueState === "error" ? "Ticket status unavailable" : "All clear"}</span></div>
        {pickupQueueState === "error" ? (
          <div className="staff-note staff-note-error" role="status">
            Pickup reviews couldn’t be refreshed. The last known items are shown below.
            <button type="button" className="btn btn-ghost btn-small" onClick={onRetryPickupQueue}>Retry ticket check</button>
          </div>
        ) : null}
        {attentionItems.length === 0 ? (
          pickupQueueState !== "checking" && pickupQueueState !== "error" ? <div className="staff-note staff-note-ok">No urgent staff blockers are active right now.</div> : null
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
        <div className="staff-today-section-heading"><div><h2 id="staff-studio-overview-heading">Studio overview</h2><p>Select an area to open its workspace.</p></div></div>
        <div className="staff-studio-scene">
          <img src="/staff-studio-overview.png" alt="Illustrated ceramics studio with a kiln, worktables, calendar, and front desk" />
          {areas.map((area) => {
            const card = cards.find((item) => item.id === area.id);
            return <button key={area.id} type="button" className={`staff-studio-marker staff-studio-marker-${area.position}`} aria-label={`${area.title}${card?.badge ? `: ${card.badge}` : ""}`} onClick={(event) => enterStudioArea(area.target, onAction, event.currentTarget)}>
              <StudioIcon name={area.icon} /><span>{area.title}{card?.badge && <small>{card.badge}</small>}</span><i data-tone={card?.tone ?? "reference"} aria-hidden="true" />
            </button>;
          })}
        </div>
        <div className="staff-studio-picker" aria-label="Studio areas">{areas.map((area) => {
          const card = cards.find((item) => item.id === area.id);
          return <button key={area.id} type="button" onClick={(event) => enterStudioArea(area.target, onAction, event.currentTarget)}>{area.title}{card?.badge && <span>{card.badge}</span>}</button>;
        })}</div>
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

