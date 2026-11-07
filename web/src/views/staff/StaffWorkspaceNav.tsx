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
  const daily = [
    { key: "today", label: "Today", action: onHome },
    { key: "finance", label: "Tickets & payments", action: () => onNavigate("finance") },
    { key: "reservations", label: "Reservations", action: onReservations },
    { key: "checkins", label: "Drop-offs", action: () => onNavigate("checkins") },
    { key: "firings", label: "Firings", action: () => onNavigate("firings") },
    { key: "members", label: "Clients", action: () => onNavigate("members") },
    { key: "messages", label: "Messages", action: onMessages },
  ];
  return <aside className="staff-workspace-nav" aria-label="Staff workspace">
    <div className="staff-workspace-brand">Studio desk<span>Monsoon Fire</span></div>
    {onNewTicket ? <button type="button" className="btn btn-primary staff-new-ticket" onClick={onNewTicket}>+ New firing ticket</button> : null}
    <nav aria-label="Daily work">{daily.map((item) => <button key={item.key} type="button" aria-current={active === item.key ? "page" : undefined} onClick={item.action}>{item.label}</button>)}</nav>
    <div className="staff-workspace-nav-label">Studio</div>
    <nav aria-label="Studio management">{[
      ["pieces", "Pieces & batches"], ["events", "Events"], ["lending", "Library"],
      ["communityBlogs", "Studio blog"], ["reports", "Reports"],
    ].map(([key, label]) => <button key={key} type="button" aria-current={active === key ? "page" : undefined} onClick={() => onNavigate(key)}>{label}</button>)}</nav>
    <div className="staff-workspace-nav-label">Administration</div>
    <nav aria-label="Administration">{[["platform", "System health"], ["automation", "Automations"], ["policyAgentOps", "Policies & integrations"], ["moduleTelemetry", "Usage reports"], ["controlTower", "Studio Brain"]].map(([key, label]) => <button key={key} type="button" aria-current={active === key ? "page" : undefined} onClick={() => onNavigate(key)}>{label}</button>)}</nav>
    {onPortal ? <button type="button" className="btn btn-ghost staff-return-portal" onClick={onPortal}>Return to portal</button> : null}
  </aside>;
}
