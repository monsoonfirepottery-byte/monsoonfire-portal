import { useEffect, useMemo, useState } from "react";

export type ControlTowerPaletteItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  actionLabel: string;
  keywords?: string[];
  tone?: "neutral" | "warn" | "danger" | "ok";
  onSelect: () => void;
};

type SpawnDraft = {
  name: string;
  group: string;
  summary: string;
  objective: string;
  tool: string;
  cwd: string;
};

type Props = {
  open: boolean;
  busy: boolean;
  items: ControlTowerPaletteItem[];
  onClose: () => void;
  onSpawnRoom: (draft: SpawnDraft) => Promise<void> | void;
};

type PaletteView = "jump" | "create";

const EMPTY_DRAFT: SpawnDraft = {
  name: "",
  group: "",
  summary: "",
  objective: "",
  tool: "codex",
  cwd: "/home/wuff/monsoonfire-portal",
};

function matchesQuery(item: ControlTowerPaletteItem, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [item.title, item.detail, item.meta, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export default function ControlTowerCommandPalette({
  open,
  busy,
  items,
  onClose,
  onSpawnRoom,
}: Props) {
  const [draft, setDraft] = useState<SpawnDraft>(EMPTY_DRAFT);
  const [view, setView] = useState<PaletteView>("jump");
  const [query, setQuery] = useState("");
  const canSpawn = useMemo(() => draft.name.trim().length > 0, [draft.name]);

  const filteredItems = useMemo(
    () => items.filter((item) => matchesQuery(item, query)).slice(0, 12),
    [items, query],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (view === "jump" && event.key === "Enter" && filteredItems[0] && !busy) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") return;
        filteredItems[0].onSelect();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, filteredItems, onClose, open, view]);

  if (!open) return null;

  return (
    <div className="control-tower-palette-backdrop" role="presentation" onClick={onClose}>
      <section
        className="control-tower-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Control Tower command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="control-tower-palette-header">
          <div>
            <div className="control-tower-kicker">Control actions</div>
            <h2>Command palette</h2>
            <p>Jump straight to the next useful thing or spin up a new room without leaving the bridge.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="control-tower-palette-tabs" role="tablist" aria-label="Command palette views">
          <button
            type="button"
            role="tab"
            aria-selected={view === "jump"}
            className={`control-tower-palette-tab ${view === "jump" ? "is-active" : ""}`}
            onClick={() => setView("jump")}
          >
            Jump around
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "create"}
            className={`control-tower-palette-tab ${view === "create" ? "is-active" : ""}`}
            onClick={() => setView("create")}
          >
            Create room
          </button>
        </div>

        {view === "jump" ? (
          <div className="control-tower-palette-grid control-tower-palette-grid-jump">
            <section className="control-tower-palette-card">
              <h3>Find the next move</h3>
              <label className="control-tower-palette-search">
                <span>Search actions, rooms, or services</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try portal, relay, attention, refresh..."
                />
              </label>
              <p>
                Press <kbd>Enter</kbd> to run the first match, or click a card when you see the right move.
              </p>
            </section>

            <section className="control-tower-palette-card">
              <h3>Available actions</h3>
              <div className="control-tower-palette-results">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`control-tower-palette-result control-tower-tone-${item.tone ?? "neutral"}`}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
                    disabled={busy}
                  >
                    <div className="control-tower-palette-result-top">
                      <strong>{item.title}</strong>
                      <span>{item.actionLabel}</span>
                    </div>
                    <p>{item.detail}</p>
                    <small>{item.meta}</small>
                  </button>
                ))}
                {!filteredItems.length ? (
                  <div className="staff-note staff-note-muted">Nothing matches that search yet.</div>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <section className="control-tower-palette-card">
            <h3>Spawn a room</h3>
            <p>Use this when the next clean move is to open a dedicated lane instead of nudging an existing one.</p>
            <div className="control-tower-form-grid">
              <label>
                <span>Session name</span>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="kiln-followup"
                />
              </label>
              <label>
                <span>Room / group</span>
                <input
                  value={draft.group}
                  onChange={(event) => setDraft((prev) => ({ ...prev, group: event.target.value }))}
                  placeholder="portal"
                />
              </label>
              <label>
                <span>Tool</span>
                <input
                  value={draft.tool}
                  onChange={(event) => setDraft((prev) => ({ ...prev, tool: event.target.value }))}
                  placeholder="codex"
                />
              </label>
              <label>
                <span>Working directory</span>
                <input
                  value={draft.cwd}
                  onChange={(event) => setDraft((prev) => ({ ...prev, cwd: event.target.value }))}
                  placeholder="/home/wuff/monsoonfire-portal"
                />
              </label>
              <label className="control-tower-form-span-2">
                <span>Summary</span>
                <input
                  value={draft.summary}
                  onChange={(event) => setDraft((prev) => ({ ...prev, summary: event.target.value }))}
                  placeholder="Portal lane for kiln follow-up"
                />
              </label>
              <label className="control-tower-form-span-2">
                <span>Objective</span>
                <textarea
                  rows={3}
                  value={draft.objective}
                  onChange={(event) => setDraft((prev) => ({ ...prev, objective: event.target.value }))}
                  placeholder="Investigate the current kiln issue and report the next safe operator move."
                />
              </label>
            </div>

            <div className="control-tower-palette-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={!canSpawn || busy}
                onClick={() => {
                  void onSpawnRoom(draft);
                }}
              >
                Create room
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
