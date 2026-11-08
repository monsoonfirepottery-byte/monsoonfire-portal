import { useId, useState } from "react";
import { FIRING_PATHFINDER_URL, STUDIO_BOOKINGS_PAUSED } from "../../utils/reservationsPaths";

type Props = {
  active: string;
  onNavigate: (target: string) => void;
  onHome: () => void;
  onMessages: () => void;
  onReservations: () => void;
  onNewTicket?: () => void;
  onPortal?: () => void;
};

export default function StaffWorkspaceNav({ active, onNavigate, onHome, onMessages, onReservations, onNewTicket, onPortal }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const daily = [
    { key: "today", label: "Today", action: onHome },
    { key: "finance", label: "Tickets & payments", action: () => onNavigate("finance") },
    ...(STUDIO_BOOKINGS_PAUSED ? [] : [{ key: "studioReservations", label: "Reservations", action: onReservations }]),
    { key: "members", label: "Clients", action: () => onNavigate("members") },
    { key: "messages", label: "Messages", action: onMessages },
  ];
  return <aside className="staff-workspace-nav" aria-label="Staff workspace">
    <div className="staff-workspace-brand">Studio desk<span>Monsoon Fire</span></div>
    {onNewTicket ? <button type="button" className="btn btn-primary staff-new-ticket" onClick={onNewTicket}>+ New firing ticket</button> : null}
    <nav aria-label="Daily work">{daily.map((item) => <button key={item.key} type="button" aria-current={active === item.key ? "page" : undefined} onClick={item.action}>{item.label}</button>)}</nav>
    <a className="btn btn-ghost" href={FIRING_PATHFINDER_URL} target="_blank" rel="noreferrer">Firing Pathfinder (new tab)</a>
    <button type="button" className="btn btn-ghost staff-more-tools" aria-controls={moreId} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>More tools</button>
    <div id={moreId} className="staff-extra-tools" data-expanded={moreOpen}>
      <div className="staff-workspace-nav-label">Studio</div>
      <nav aria-label="Studio management">{[
        ["pieces", "Pieces & batches"], ["events", "Events"], ["lending", "Library"],
        ["communityBlogs", "Studio blog"], ["reports", "Reports"],
      ].map(([key, label]) => <button key={key} type="button" aria-current={active === key ? "page" : undefined} onClick={() => onNavigate(key)}>{label}</button>)}</nav>
      <div className="staff-workspace-nav-label">Administration</div>
      <nav aria-label="Administration">{[["platform", "System health"], ["automation", "Automations"], ["policyAgentOps", "Policies & integrations"], ["moduleTelemetry", "Usage reports"], ["controlTower", "Studio Brain"]].map(([key, label]) => <button key={key} type="button" aria-current={active === key ? "page" : undefined} onClick={() => onNavigate(key)}>{label}</button>)}</nav>
      <details className="staff-archived-tools" open={active === "checkins" || active === "firings" || (STUDIO_BOOKINGS_PAUSED && active === "studioReservations") || undefined}>
        <summary>Archived tools</summary>
        <nav aria-label="Archived staff tools">
          <button type="button" aria-current={active === "checkins" ? "page" : undefined} onClick={() => onNavigate("checkins")}>Drop-off records</button>
          <button type="button" aria-current={active === "firings" ? "page" : undefined} onClick={() => onNavigate("firings")}>Firing records and controls</button>
          {STUDIO_BOOKINGS_PAUSED ? <button type="button" aria-current={active === "studioReservations" ? "page" : undefined} onClick={onReservations}>Reservation records</button> : null}
        </nav>
      </details>
      {onPortal ? <button type="button" className="btn btn-ghost staff-return-portal" onClick={onPortal}>Return to portal</button> : null}
    </div>
  </aside>;
}
