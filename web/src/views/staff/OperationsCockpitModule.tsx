import type { ReactNode } from "react";
import type { OperationsAreaKey, OperationsOverviewModel } from "./operationsOverview";

type OperationsCockpitModuleProps = {
  overview: OperationsOverviewModel;
  checkinsContent: ReactNode;
  membersContent: ReactNode;
  piecesContent: ReactNode;
  firingsContent: ReactNode;
  eventsContent: ReactNode;
  lendingContent: ReactNode;
  lendingIntakeContent: ReactNode;
  activeOperationsModule: "operations" | OperationsAreaKey | "lending-intake";
  openModuleFromCockpit: (target: string) => void;
};

export default function OperationsCockpitModule({
  overview,
  checkinsContent,
  membersContent,
  piecesContent,
  firingsContent,
  eventsContent,
  lendingContent,
  lendingIntakeContent,
  activeOperationsModule,
  openModuleFromCockpit,
}: OperationsCockpitModuleProps) {
  const contentByModule: Record<OperationsAreaKey | "lending-intake", ReactNode> = {
    checkins: checkinsContent,
    members: membersContent,
    pieces: piecesContent,
    firings: firingsContent,
    events: eventsContent,
    lending: lendingContent,
    "lending-intake": lendingIntakeContent,
  };

  const cardByModule = Object.fromEntries(overview.areaCards.map((card) => [card.key, card])) as Record<
    OperationsAreaKey,
    OperationsOverviewModel["areaCards"][number]
  >;

  if (activeOperationsModule !== "operations") {
    const selectedCard =
      activeOperationsModule === "lending-intake"
        ? {
            title: "Lending intake",
            headline: "Scan and import ISBNs without the rest of the lending workspace in the way.",
          }
        : cardByModule[activeOperationsModule];
    return (
      <section className="staff-operations-focus" data-testid={`operations-focus-${activeOperationsModule}`}>
        <section className="card staff-console-card staff-operations-focus-card">
          <div className="card-title-row">
            <div className="staff-column">
              <div className="staff-subtitle">Operations drill-in</div>
              <div className="card-title">{selectedCard.title}</div>
              <p className="card-subtitle">{selectedCard.headline}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openModuleFromCockpit("operations")}
            >
              Back to operations overview
            </button>
          </div>
          <div className="staff-note">
            Advanced tools, long tables, and cleanup controls stay in the focused module so the Operations overview stays readable.
          </div>
        </section>
        <section className="staff-module-grid">{contentByModule[activeOperationsModule]}</section>
      </section>
    );
  }

  return (
    <section className="staff-operations-overview" data-testid="operations-overview">
      <section className="staff-shift-status-card staff-operations-summary-card" data-tone={overview.tone}>
        <div className="staff-shift-status-header">
          <div className="staff-column">
            <div className="staff-subtitle">Operations workboard</div>
            <div className="staff-shift-status-headline">{overview.headline}</div>
          </div>
          <span className={`pill staff-shift-status-pill staff-shift-status-pill-${overview.tone}`}>
            {overview.label}
          </span>
        </div>
        <div className="staff-note">
          Queue first, then drill into a module only when you need the full workspace for follow-through.
        </div>
      </section>

      <section className="card staff-console-card">
        <div className="card-title">Needs attention now</div>
        <p className="card-subtitle">
          A short cross-module queue so staff can tell what matters next without reading six admin consoles.
        </p>
        {overview.priorityItems.length === 0 ? (
          <div className="staff-note staff-note-ok">No urgent operational blockers right now.</div>
        ) : (
          <div className="staff-operations-priority-list">
            {overview.priorityItems.map((item) => (
              <div
                key={item.id}
                className="staff-operations-priority-item"
                data-tone={item.tone}
                data-testid={`operations-priority-${item.id}`}
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
                  onClick={() => openModuleFromCockpit(item.actionTarget)}
                >
                  {item.actionLabel}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="staff-operations-card-grid">
        {overview.areaCards.map((card) => (
          <section
            key={card.key}
            className="card staff-console-card staff-operations-area-card"
            data-tone={card.tone}
            data-testid={`operations-area-${card.key}`}
          >
            <div className="staff-operations-area-header">
              <div className="staff-column">
                <div className="staff-subtitle">{card.owner}</div>
                <div className="card-title">{card.title}</div>
              </div>
              <span className={`pill staff-operations-area-pill staff-operations-area-pill-${card.tone}`}>
                {card.label}
              </span>
            </div>
            <p className="card-subtitle">{card.headline}</p>
            <div className="staff-operations-metric-grid">
              {card.metrics.map((metric) => (
                <div key={`${card.key}-${metric.label}`} className="staff-operations-metric">
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <div className="staff-note">{card.note}</div>
            <div className="staff-actions-row">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => openModuleFromCockpit(card.actionTarget)}
              >
                {card.actionLabel}
              </button>
            </div>
          </section>
        ))}
      </section>
    </section>
  );
}
