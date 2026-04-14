type GuidedStateAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "ghost";
};

type Props = {
  eyebrow?: string;
  title: string;
  body: string;
  actions?: GuidedStateAction[];
  className?: string;
};

export default function GuidedStateCard({ eyebrow, title, body, actions = [], className = "" }: Props) {
  return (
    <div className={`guided-state-card ${className}`.trim()}>
      {eyebrow ? <div className="guided-state-eyebrow">{eyebrow}</div> : null}
      <div className="guided-state-title">{title}</div>
      <div className="guided-state-body">{body}</div>
      {actions.length > 0 ? (
        <div className="guided-state-actions">
          {actions.map((action) =>
            action.href ? (
              <a
                key={`${action.label}:${action.href}`}
                className={action.variant === "ghost" ? "btn btn-ghost btn-small" : "btn btn-primary btn-small"}
                href={action.href}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                className={action.variant === "ghost" ? "btn btn-ghost btn-small" : "btn btn-primary btn-small"}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
