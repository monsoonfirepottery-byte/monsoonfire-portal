import type { ReactNode } from "react";
const ADMIN_STYLE = `.admin-page-header{display:grid;grid-template-columns:30% 1fr;gap:1rem;overflow:hidden;margin:0 0 1rem;border:1px solid var(--border,#30363d);border-radius:16px;background:linear-gradient(115deg,rgba(194,120,69,.14),rgba(20,25,28,.35))}.admin-page-art{width:100%;height:100%;min-height:150px;object-fit:cover;animation:a .7s ease-out}.admin-page-header-copy{padding:1rem}.admin-eyebrow,.admin-workflow figcaption{font-size:.75rem;color:#d7a16a;text-transform:uppercase;letter-spacing:.08em}.admin-page-header h1{margin:.2rem 0;font-size:1.35rem}.admin-page-header p{margin:0;color:var(--muted,#b7bbc1)}.admin-page-header .staff-actions-row{margin-top:.7rem}.admin-workflow{margin:0 0 1rem;padding:.8rem;border:1px solid var(--border,#30363d);border-radius:14px;background:rgba(17,22,25,.62)}.admin-workflow ol{display:flex;gap:.4rem;list-style:none;margin:.6rem 0 0;padding:0}.admin-workflow li{display:flex;gap:.45rem;flex:1;min-width:0;padding:.5rem;border-radius:9px;background:rgba(255,255,255,.04);animation:b .55s calc(var(--admin-step)*70ms) both}.admin-workflow-marker{display:grid;place-items:center;flex:none;width:1.5rem;height:1.5rem;border-radius:50%;background:#485057;color:#fff;font-size:.72rem}.admin-workflow [data-state=ok] .admin-workflow-marker{background:#67c99a;color:#10251d}.admin-workflow [data-state=warn] .admin-workflow-marker{background:#e0a95e;color:#2d1b08}.admin-workflow [data-state=danger] .admin-workflow-marker{background:#e07b70;color:#35110d}.admin-workflow strong,.admin-workflow small{display:block;overflow:hidden;text-overflow:ellipsis}.admin-workflow strong{font-size:.82rem}.admin-workflow small{font-size:.72rem;color:var(--muted,#b7bbc1)}.admin-ranked-row{display:grid;grid-template-columns:1fr 2fr auto;gap:.6rem;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,.08)}.admin-ranked-bar{height:.45rem;background:rgba(255,255,255,.1);border-radius:99px;overflow:hidden}.admin-ranked-bar span{display:block;height:100%;width:var(--bar);background:linear-gradient(90deg,#d89b60,#83d6b0);animation:c .7s ease-out}@keyframes a{from{opacity:.3;transform:scale(1.03)}}@keyframes b{from{opacity:0;transform:translateY(7px)}}@keyframes c{from{transform:scaleX(.05);transform-origin:left}}@media(max-width:620px){.admin-page-header{grid-template-columns:1fr}.admin-page-art{height:130px;min-height:0}.admin-workflow ol{flex-direction:column}.admin-ranked-row{grid-template-columns:1fr 1fr auto}}@media(prefers-reduced-motion:reduce){.admin-page-art,.admin-workflow li,.admin-ranked-bar span{animation:none}}`;

export type AdminStage = { label: string; state?: "ok" | "warn" | "danger" | "neutral"; detail?: string };

export function AdminPageHeader({ eyebrow, title, description, art, children }: { eyebrow: string; title: string; description: string; art: string; children?: ReactNode }) {
  return <header className="admin-page-header">
    <style>{ADMIN_STYLE}</style>
    <img className="admin-page-art" src={art} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
    <div className="admin-page-header-copy"><div className="admin-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p>{children}</div>
  </header>;
}

export function AdminWorkflow({ label, stages }: { label: string; stages: AdminStage[] }) {
  return <figure className="admin-workflow" aria-label={label}>
    <style>{ADMIN_STYLE}</style>
    <figcaption>{label}</figcaption>
    <ol>{stages.map((stage, index) => <li key={stage.label} data-state={stage.state ?? "neutral"} style={{ "--admin-step": index } as React.CSSProperties}>
      <span className="admin-workflow-marker" aria-hidden="true">{index + 1}</span><span><strong>{stage.label}</strong>{stage.detail ? <small>{stage.detail}</small> : null}</span>
    </li>)}</ol>
  </figure>;
}
