import type { ReactNode } from "react";

export type AdminStage = { label: string; state?: "ok" | "warn" | "danger" | "neutral"; detail?: string };

export function AdminPageHeader({ eyebrow, title, description, art, children }: { eyebrow: string; title: string; description: string; art: string; children?: ReactNode }) {
  return <header className="admin-page-header">
    <link rel="stylesheet" href="/staff-admin/workflows.css" />
    <img className="admin-page-art" src={art} alt="" />
    <div className="admin-page-header-copy"><div className="admin-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p>{children}</div>
  </header>;
}

export function AdminWorkflow({ label, stages }: { label: string; stages: AdminStage[] }) {
  return <figure className="admin-workflow" aria-label={label}>
    <figcaption>{label}</figcaption>
    <ol>{stages.map((stage) => <li key={stage.label} data-state={stage.state ?? "neutral"}>
      <span className="admin-workflow-marker" aria-hidden="true">{index + 1}</span><span><strong>{stage.label}</strong>{stage.detail ? <small>{stage.detail}</small> : null}</span>
    </li>)}</ol>
  </figure>;
}
