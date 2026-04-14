import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import ControlTowerCommandPalette, { type ControlTowerPaletteItem } from "./controlTower/ControlTowerCommandPalette";
import ControlTowerRoomDrawer from "./controlTower/ControlTowerRoomDrawer";
import {
  clearStoredStudioBrainBaseUrlOverride,
  getStoredStudioBrainBaseUrlOverride,
  setStoredStudioBrainBaseUrlOverride,
} from "../../utils/studioBrain";
import {
  ackControlTowerOverseer,
  fetchControlTowerRoom,
  fetchControlTowerState,
  getStudioBrainControlTowerResolution,
  runControlTowerServiceAction,
  sendControlTowerInstruction,
  setControlTowerRoomPinned,
  spawnControlTowerRoom,
  subscribeControlTowerEvents,
  type ControlTowerActionTarget,
  type ControlTowerRoomDetail,
  type ControlTowerServiceCard,
  type ControlTowerState,
} from "../../utils/studioBrainControlTower";
import "./studioBrainControlTower.css";

type Props = {
  user: User;
  active: boolean;
  disabled: boolean;
  adminToken: string;
  onNavigateTarget: (target: string) => void;
};

const ROOM_QUERY_KEY = "room";

function formatRelativeAge(ageMinutes: number | null): string {
  if (ageMinutes === null) return "Age unknown";
  if (ageMinutes < 1) return "Just now";
  if (ageMinutes === 1) return "1 minute old";
  if (ageMinutes < 60) return `${ageMinutes} minutes old`;
  const hours = Math.floor(ageMinutes / 60);
  return hours === 1 ? "1 hour old" : `${hours} hours old`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "No timestamp yet";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString();
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
}

function toneClass(
  severity: "info" | "warning" | "critical" | "healthy" | "waiting" | "error" | "neutral",
): "danger" | "warn" | "ok" | "neutral" {
  switch (severity) {
    case "critical":
    case "error":
      return "danger";
    case "warning":
    case "waiting":
      return "warn";
    case "healthy":
      return "ok";
    default:
      return "neutral";
  }
}

function continuityTone(state: "ready" | "continuity_degraded" | "missing" | null | undefined): "danger" | "warn" | "ok" | "neutral" {
  if (state === "ready") return "ok";
  if (state === "continuity_degraded") return "warn";
  return "neutral";
}

function streamTone(state: "connecting" | "live" | "fallback"): "danger" | "warn" | "ok" | "neutral" {
  if (state === "live") return "ok";
  if (state === "fallback") return "warn";
  return "neutral";
}

function consolidationTone(
  mode: "idle" | "scheduled" | "running" | "repair" | "unavailable" | null | undefined,
): "danger" | "warn" | "ok" | "neutral" {
  if (mode === "running") return "ok";
  if (mode === "scheduled" || mode === "idle") return "neutral";
  if (mode === "repair") return "warn";
  return "neutral";
}

function getInitialRoomId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get(ROOM_QUERY_KEY);
  return roomId && roomId.trim() ? roomId.trim() : null;
}

function setRoomQuery(roomId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set(ROOM_QUERY_KEY, roomId);
  else url.searchParams.delete(ROOM_QUERY_KEY);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function actionButtonLabel(target: ControlTowerActionTarget): string {
  if (target.type === "room") return "Inspect room";
  if (target.type === "service") return "Inspect service";
  if (target.type === "session") return "Attach lane";
  return "Review";
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatLatency(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.round(Number(value))}ms`;
}

function startupScoreTone(scorecard: ControlTowerState["startupScorecard"]): "danger" | "warn" | "ok" | "neutral" {
  const score = Number(scorecard?.rubric.overallScore ?? NaN);
  if (!Number.isFinite(score)) return "neutral";
  if (score >= 90) return "ok";
  if (score >= 75) return "warn";
  return "danger";
}

function actionabilityTone(status: string | null | undefined): "danger" | "warn" | "ok" | "neutral" {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "passed") return "ok";
  if (normalized === "repair" || normalized === "rathole") return "warn";
  if (normalized) return "neutral";
  return "neutral";
}

function shouldSurfaceMemoryActions(state: ControlTowerState | null): boolean {
  if (!state) return false;
  if (state.memoryBrief.continuityState !== "ready") return true;

  const actionabilityStatus = String(state.memoryBrief.consolidation.actionabilityStatus ?? "").trim().toLowerCase();
  if (actionabilityStatus && actionabilityStatus !== "passed") return true;

  const scorecard = state.startupScorecard;
  if (!scorecard) return false;
  if (scorecard.latest.sample.status !== "pass") return true;
  if (
    Number.isFinite(scorecard.metrics.readyRate) &&
    Number(scorecard.metrics.readyRate) < 0.85
  ) {
    return true;
  }
  if (
    Number.isFinite(scorecard.metrics.groundingReadyRate) &&
    Number(scorecard.metrics.groundingReadyRate) < 0.9
  ) {
    return true;
  }
  if (
    Number.isFinite(scorecard.metrics.blockedContinuityRate) &&
    Number(scorecard.metrics.blockedContinuityRate) > 0.05
  ) {
    return true;
  }
  return false;
}

function getMemoryActionRows(state: ControlTowerState | null): string[] {
  if (!state || !shouldSurfaceMemoryActions(state)) return [];
  const seen = new Set<string>();
  const rows = [
    ...state.memoryBrief.recommendedNextActions,
    ...(state.memoryBrief.consolidation.topActions ?? []),
  ];
  return rows.filter((row) => {
    const key = row.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

async function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("Clipboard access is unavailable in this browser.");
}

export default function StudioBrainControlTowerModule({
  user,
  active,
  disabled,
  adminToken,
  onNavigateTarget,
}: Props) {
  const [, setResolutionVersion] = useState(0);
  const resolution = getStudioBrainControlTowerResolution();
  const isDisabled = disabled;
  const [baseUrlDraft, setBaseUrlDraft] = useState(() => getStoredStudioBrainBaseUrlOverride());
  const [baseUrlStatus, setBaseUrlStatus] = useState("");
  const [state, setState] = useState<ControlTowerState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => getInitialRoomId());
  const [roomDetail, setRoomDetail] = useState<ControlTowerRoomDetail | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "fallback">("connecting");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const servicesRef = useRef<HTMLElement | null>(null);
  const eventsRef = useRef<HTMLElement | null>(null);
  const streamRefreshTimerRef = useRef<number | null>(null);

  const fetchOptions = useMemo(
    () => ({
      user,
      adminToken,
    }),
    [adminToken, user],
  );

  const openRoom = useCallback(async (roomId: string) => {
    setSelectedRoomId(roomId);
    setRoomQuery(roomId);
    try {
      const room = await fetchControlTowerRoom(roomId, fetchOptions);
      setRoomDetail(room);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [fetchOptions]);

  const closeRoom = useCallback(() => {
    setSelectedRoomId(null);
    setRoomDetail(null);
    setRoomQuery(null);
  }, []);

  const loadState = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!active || isDisabled || !resolution.baseUrl) return;
      if (!options?.silent) setLoading(true);
      try {
        const nextState = await fetchControlTowerState(fetchOptions);
        setState(nextState);
        if (selectedRoomId) {
          const room = await fetchControlTowerRoom(selectedRoomId, fetchOptions);
          setRoomDetail(room);
        }
        if (!options?.silent) setErrorMessage("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [active, fetchOptions, isDisabled, resolution.baseUrl, selectedRoomId],
  );

  useEffect(() => {
    if (!active || isDisabled || !resolution.baseUrl) return;
    void loadState();
  }, [active, isDisabled, loadState, resolution.baseUrl]);

  useEffect(() => {
    if (!active || isDisabled || !resolution.baseUrl) return;
    if (streamStatus === "live") return;
    let cancelled = false;
    let timer: number | null = null;

    const queueNext = () => {
      if (cancelled) return;
      const delay = document.visibilityState === "visible" ? 5_000 : 30_000;
      timer = window.setTimeout(async () => {
        await loadState({ silent: true });
        queueNext();
      }, delay);
    };

    if (streamStatus === "fallback") {
      void loadState({ silent: true });
    }
    queueNext();

    const onVisibilityChange = () => {
      if (timer !== null) window.clearTimeout(timer);
      queueNext();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, isDisabled, loadState, resolution.baseUrl, streamStatus]);

  useEffect(() => {
    if (!active || isDisabled || !resolution.baseUrl) return;
    setStreamStatus("connecting");

    const unsubscribe = subscribeControlTowerEvents({
      ...fetchOptions,
      onOpen: () => setStreamStatus("live"),
      onEvent: () => {
        setStreamStatus("live");
        if (streamRefreshTimerRef.current !== null) return;
        streamRefreshTimerRef.current = window.setTimeout(() => {
          streamRefreshTimerRef.current = null;
          void loadState({ silent: true });
        }, 250);
      },
      onError: () => setStreamStatus("fallback"),
    });

    return () => {
      unsubscribe();
      if (streamRefreshTimerRef.current !== null) {
        window.clearTimeout(streamRefreshTimerRef.current);
        streamRefreshTimerRef.current = null;
      }
    };
  }, [active, fetchOptions, isDisabled, loadState, resolution.baseUrl]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    setStatusMessage("");
    setErrorMessage("");
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey("");
    }
  }, [busyKey]);

  const handleActionTarget = useCallback(
    (target: ControlTowerActionTarget) => {
      if (target.type === "room") {
        void openRoom(target.roomId);
        return;
      }
      if (target.type === "service") {
        servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (target.type === "session") {
        const matchingRoom = state?.rooms.find((room) => room.sessionNames.includes(target.sessionName));
        if (matchingRoom) void openRoom(matchingRoom.id);
        return;
      }
      if (target.action === "overseer" || target.action === "events") {
        eventsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (target.action === "approvals") {
        onNavigateTarget("system");
        return;
      }
      void loadState();
    },
    [loadState, onNavigateTarget, openRoom, state?.rooms],
  );

  const jumpToServices = useCallback(() => {
    servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const jumpToEvents = useCallback(() => {
    eventsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleSendInstruction = useCallback(
    async (text: string) => {
      if (!roomDetail) return;
      await runAction("send-room-instruction", async () => {
        await sendControlTowerInstruction(roomDetail.id, text, fetchOptions);
        setStatusMessage(`Sent instruction to ${roomDetail.name}.`);
        await openRoom(roomDetail.id);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, openRoom, roomDetail, runAction],
  );

  const handleTogglePinned = useCallback(
    async (nextPinned: boolean) => {
      if (!roomDetail) return;
      await runAction(nextPinned ? "pin-room" : "unpin-room", async () => {
        await setControlTowerRoomPinned(
          roomDetail.id,
          nextPinned,
          nextPinned ? `Escalated ${roomDetail.name} from the browser control tower.` : `Cleared escalation for ${roomDetail.name}.`,
          fetchOptions,
        );
        setStatusMessage(nextPinned ? `${roomDetail.name} is now escalated.` : `${roomDetail.name} escalation cleared.`);
        await openRoom(roomDetail.id);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, openRoom, roomDetail, runAction],
  );

  const handleCopyAttach = useCallback(
    async (command: string) => {
      await runAction("copy-attach", async () => {
        await copyText(command);
        setStatusMessage("Attach command copied.");
      });
    },
    [runAction],
  );

  const handleServiceAction = useCallback(
    async (service: ControlTowerServiceCard, action: string, requiresConfirmation: boolean) => {
      if (requiresConfirmation && !window.confirm(`Run ${action} on ${service.label}?`)) return;
      await runAction(`${service.id}:${action}`, async () => {
        const result = await runControlTowerServiceAction(service.id, action, fetchOptions);
        setStatusMessage(result.message || `${service.label} ${action} complete.`);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handleAckOverseer = useCallback(
    async (note: string) => {
      await runAction("ack-overseer", async () => {
        await ackControlTowerOverseer(note, fetchOptions);
        setStatusMessage("Overseer acknowledgement recorded.");
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handleSpawnRoom = useCallback(
    async (draft: {
      name: string;
      group: string;
      summary: string;
      objective: string;
      tool: string;
      cwd: string;
    }) => {
      await runAction("spawn-room", async () => {
        await spawnControlTowerRoom(
          {
            name: draft.name,
            group: draft.group,
            room: draft.group,
            summary: draft.summary,
            objective: draft.objective,
            tool: draft.tool,
            cwd: draft.cwd,
          },
          fetchOptions,
        );
        setPaletteOpen(false);
        setStatusMessage(`Created room ${draft.name}.`);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handleSaveBaseUrlOverride = useCallback(() => {
    setStoredStudioBrainBaseUrlOverride(baseUrlDraft);
    const nextResolution = getStudioBrainControlTowerResolution();
    setResolutionVersion((prev) => prev + 1);
    setBaseUrlStatus(
      nextResolution.baseUrl
        ? `Studio Brain URL set to ${nextResolution.baseUrl}.`
        : nextResolution.reason || "Studio Brain URL is still unavailable.",
    );
  }, [baseUrlDraft]);

  const handleClearBaseUrlOverride = useCallback(() => {
    clearStoredStudioBrainBaseUrlOverride();
    setBaseUrlDraft("");
    const nextResolution = getStudioBrainControlTowerResolution();
    setResolutionVersion((prev) => prev + 1);
    setBaseUrlStatus(nextResolution.reason || "Studio Brain URL override cleared.");
  }, []);

  const counts = state?.counts ?? {
    needsAttention: 0,
    working: 0,
    waiting: 0,
    blocked: 0,
    escalated: 0,
  };
  const startupScorecard = state?.startupScorecard ?? null;
  const memoryActionRows = useMemo(() => getMemoryActionRows(state), [state]);
  const memoryActionsQuiet = memoryActionRows.length === 0;

  const paletteItems = useMemo<ControlTowerPaletteItem[]>(() => {
    const items: ControlTowerPaletteItem[] = [
      {
        id: "palette:refresh",
        title: "Refresh Control Tower",
        detail: "Pull the latest rooms, services, and incident state into the browser.",
        meta: "Tower action",
        actionLabel: "Refresh",
        keywords: ["refresh", "reload", "sync", "state"],
        onSelect: () => void loadState(),
      },
      {
        id: "palette:ack-overseer",
        title: "Acknowledge the latest overseer run",
        detail: "Record that the latest overseer recommendation was reviewed in the browser shell.",
        meta: "Overseer action",
        actionLabel: "Ack overseer",
        keywords: ["ack", "overseer", "review", "incident"],
        tone: "warn",
        onSelect: () => void handleAckOverseer("Reviewed in Control Tower and queued follow-up."),
      },
      {
        id: "palette:services",
        title: "Jump to services",
        detail: "Review health, impact, and safe service actions.",
        meta: "Services section",
        actionLabel: "Open services",
        keywords: ["services", "relay", "status", "restart", "health"],
        onSelect: jumpToServices,
      },
      {
        id: "palette:events",
        title: "Jump to recent events",
        detail: "Open the incident and operator timeline instead of scrolling for it.",
        meta: "Events section",
        actionLabel: "Open events",
        keywords: ["events", "timeline", "incidents", "acks", "alerts"],
        onSelect: jumpToEvents,
      },
      {
        id: "palette:admin",
        title: "Open advanced admin",
        detail: "Leave the operator shell and move into the deeper Studio Brain admin surface.",
        meta: "Advanced administration",
        actionLabel: "Open admin",
        keywords: ["admin", "system", "advanced", "governance"],
        onSelect: () => onNavigateTarget("system"),
      },
    ];

    (state?.overview.needsAttention ?? []).forEach((item) => {
      items.push({
        id: `palette:attention:${item.id}`,
        title: item.title,
        detail: item.why,
        meta: `Needs attention · ${formatRelativeAge(item.ageMinutes)}`,
        actionLabel: item.actionLabel,
        keywords: [item.severity, "attention", item.actionLabel],
        tone: toneClass(item.severity),
        onSelect: () => handleActionTarget(item.target),
      });
    });

    (state?.overview.activeRooms ?? []).forEach((room) => {
      items.push({
        id: `palette:room:${room.id}`,
        title: `Open ${room.name}`,
        detail: room.objective || room.summary,
        meta: `${room.project} · ${room.status} · ${formatRelativeAge(room.ageMinutes)}`,
        actionLabel: "Inspect room",
        keywords: [room.name, room.project, room.status, room.tool, ...(room.sessionNames ?? [])],
        tone: room.isEscalated ? "warn" : room.status === "blocked" ? "danger" : "neutral",
        onSelect: () => void openRoom(room.id),
      });
    });

    (state?.services ?? []).forEach((service) => {
      items.push({
        id: `palette:service:${service.id}`,
        title: `Review ${service.label}`,
        detail: service.summary,
        meta: `${service.health} · ${service.impact}`,
        actionLabel: "Inspect service",
        keywords: [service.id, service.label, service.health, "service"],
        tone: toneClass(service.health),
        onSelect: jumpToServices,
      });
    });

    return items;
  }, [handleAckOverseer, handleActionTarget, jumpToEvents, jumpToServices, loadState, onNavigateTarget, openRoom, state]);

  if (isDisabled) {
    return (
      <section className="card staff-console-card control-tower-shell">
        <div className="control-tower-kicker">Studio Brain Control Tower</div>
        <h2>Control Tower needs operator access</h2>
        <p className="card-subtitle">
          This browser session is signed in, but it does not currently have the Studio Brain operator access needed to
          inspect rooms, run bounded service actions, or steer agent work.
        </p>
        <div className="staff-note">Ask for staff operator access, or use advanced admin for deeper governance work.</div>
        <div className="staff-actions-row">
          <button type="button" className="btn btn-secondary" onClick={() => onNavigateTarget("system")}>
            Open advanced admin
          </button>
        </div>
      </section>
    );
  }

  if (!resolution.baseUrl) {
    return (
      <section className="card staff-console-card control-tower-shell">
        <div className="control-tower-kicker">Studio Brain Control Tower</div>
        <h2>Control Tower is waiting on the Studio Brain bridge</h2>
        <p className="card-subtitle">
          The browser shell needs a reachable Studio Brain base URL before it can operate rooms, services, and overseer
          flows directly.
        </p>
        <div className="staff-note">
          {resolution.reason || "Studio Brain is not configured for this browser host."}
        </div>
        {!resolution.baseUrl ? (
          <div className="control-tower-setup-card">
            <label className="control-tower-setup-label" htmlFor="control-tower-base-url">
              Studio Brain base URL
            </label>
            <p className="control-tower-setup-help">
              Paste the reachable HTTPS Studio Brain endpoint for this browser session. Once a tunnel or public host exists,
              Control Tower can use it immediately without another portal rebuild.
            </p>
            <div className="control-tower-setup-row">
              <input
                id="control-tower-base-url"
                type="url"
                placeholder="https://studio-brain.example.com"
                value={baseUrlDraft}
                onChange={(event) => setBaseUrlDraft(event.target.value)}
                autoComplete="off"
              />
              <button type="button" className="btn btn-primary" onClick={handleSaveBaseUrlOverride}>
                Save URL
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleClearBaseUrlOverride}>
                Clear
              </button>
            </div>
            {baseUrlStatus ? <div className="staff-note">{baseUrlStatus}</div> : null}
          </div>
        ) : null}
        <div className="staff-actions-row">
          <button type="button" className="btn btn-secondary" onClick={() => onNavigateTarget("system")}>
            Open advanced admin
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="control-tower-shell" data-testid="studio-brain-control-tower">
        <section className="card staff-console-card control-tower-hero">
          <div className="control-tower-hero-copy">
            <div className="control-tower-kicker">Studio Brain Control Tower v3</div>
            <h1>30-second operator plane</h1>
            <p>
              Mission board, approvals, memory brief, and live channels are the first screen now. tmux and logs stay backstage as recovery substrate.
            </p>
          </div>
          <div className="control-tower-hero-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void loadState()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setPaletteOpen(true)}>
              Command palette
            </button>
            <button type="button" className="btn btn-ghost" onClick={jumpToServices}>
              Services
            </button>
            <button type="button" className="btn btn-ghost" onClick={jumpToEvents}>
              Events
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onNavigateTarget("system")}>
              Advanced admin
            </button>
          </div>

          <div className="control-tower-stat-grid">
            <article className="control-tower-stat-card">
              <span>Needs Attention</span>
              <strong>{counts.needsAttention}</strong>
              <p>Human follow-up or operator review is needed now.</p>
            </article>
            <article className="control-tower-stat-card">
              <span>Active Rooms</span>
              <strong>{state?.overview.activeRooms.length ?? 0}</strong>
              <p>Rooms that are moving, blocked, or escalated.</p>
            </article>
            <article className="control-tower-stat-card">
              <span>Waiting</span>
              <strong>{counts.waiting}</strong>
              <p>Rooms that are quiet enough to need a nudge.</p>
            </article>
            <article className="control-tower-stat-card">
              <span>Escalated</span>
              <strong>{counts.escalated}</strong>
              <p>Pinned blockers that stay visible until they are cleared.</p>
            </article>
            <article className="control-tower-stat-card">
              <span>Approvals</span>
              <strong>{state?.approvals.length ?? 0}</strong>
              <p>Pending or in-flight operator approvals from the control plane.</p>
            </article>
          </div>

          <div className="control-tower-status-row">
            <span className={`pill control-tower-pill-${toneClass(state?.ops.overallStatus ?? "neutral")}`}>
              {`Ops ${state?.ops.overallStatus ?? "neutral"}`}
            </span>
            <span className={`pill control-tower-pill-${continuityTone(state?.memoryBrief?.continuityState ?? "missing")}`}>
              {`Memory ${state?.memoryBrief?.continuityState ?? "missing"}`}
            </span>
            <span className={`pill control-tower-pill-${startupScoreTone(startupScorecard)}`}>
              {startupScorecard
                ? `Startup ${startupScorecard.rubric.overallScore ?? "n/a"}/${startupScorecard.rubric.grade}`
                : "Startup n/a"}
            </span>
            <span className={`pill control-tower-pill-${streamTone(streamStatus)}`}>
              {streamStatus === "live" ? "SSE live" : streamStatus === "fallback" ? "Polling fallback" : "Stream connecting"}
            </span>
            <span>{state?.ops.summary || "Loading Control Tower status..."}</span>
            <span>{state?.generatedAt ? `Updated ${formatTimestamp(state.generatedAt)}` : ""}</span>
          </div>
        </section>

        {statusMessage ? <div className="staff-note staff-note-ok">{statusMessage}</div> : null}
        {errorMessage ? <div className="staff-note staff-note-danger">{errorMessage}</div> : null}

        <section className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Board</div>
              <h2>30-second operator board</h2>
              <p>Fixed schema across surfaces: owner, task, state, blocker, next, and last update.</p>
            </div>
          </div>
          <div className="control-tower-board-list">
            {(state?.board ?? []).map((row) => (
              <article key={row.id} className="control-tower-board-card">
                <div className="control-tower-card-top">
                  <div>
                    <span className="control-tower-room-name">{row.owner}</span>
                    <span className="control-tower-room-project">{row.state}</span>
                  </div>
                  <span>{formatTimestamp(row.last_update)}</span>
                </div>
                <div className="control-tower-board-grid">
                  <div>
                    <span className="control-tower-board-label">Task</span>
                    <strong>{row.task}</strong>
                  </div>
                  <div>
                    <span className="control-tower-board-label">Blocker</span>
                    <strong>{row.blocker || "None"}</strong>
                  </div>
                  <div>
                    <span className="control-tower-board-label">Next</span>
                    <strong>{row.next}</strong>
                  </div>
                </div>
                {row.roomId ? (
                  <div className="control-tower-next-footer">
                    <span>{row.sessionName || row.roomId}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => handleActionTarget({ type: "room", roomId: row.roomId as string })}
                    >
                      Open lane
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!state?.board.length ? (
              <div className="staff-note staff-note-muted">The mission board will populate when the first active rooms appear.</div>
            ) : null}
          </div>
        </section>

        <div className="control-tower-grid">
          <div className="control-tower-main">
            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Home</div>
                  <h2>Needs Attention</h2>
                  <p>Each item tells you what it is, why it matters, and the next clean move.</p>
                </div>
              </div>
              <div className="control-tower-attention-grid">
                {(state?.overview.needsAttention ?? []).map((item) => (
                  <article key={item.id} className={`control-tower-attention-card control-tower-tone-${toneClass(item.severity)}`}>
                    <div className="control-tower-card-top">
                      <span className="pill">{item.severity}</span>
                      <span>{formatRelativeAge(item.ageMinutes)}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.why}</p>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => handleActionTarget(item.target)}>
                      {item.actionLabel}
                    </button>
                  </article>
                ))}
                {!state?.overview.needsAttention.length ? (
                  <div className="staff-note staff-note-ok">Nothing critical is pulling for attention right now.</div>
                ) : null}
              </div>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Rooms</div>
                  <h2>Active Rooms</h2>
                  <p>Rooms group related work lanes so you can inspect, act, and move on.</p>
                </div>
              </div>
              <div className="control-tower-room-grid">
                {(state?.overview.activeRooms ?? []).map((room) => (
                  <article
                    key={room.id}
                    className={`control-tower-room-card control-tower-room-${room.status}`}
                    onClick={() => void openRoom(room.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openRoom(room.id);
                      }
                    }}
                  >
                    <div className="control-tower-card-top">
                      <div>
                        <span className="control-tower-room-name">{room.name}</span>
                        <span className="control-tower-room-project">{room.project}</span>
                      </div>
                      <span className={`pill control-tower-pill-${toneClass(room.status === "blocked" ? "critical" : room.isEscalated ? "warning" : "neutral")}`}>
                        {room.isEscalated ? "Escalated" : room.status}
                      </span>
                    </div>
                    <h3>{room.objective}</h3>
                    <p>{room.summary}</p>
                    <div className="control-tower-room-footer">
                      <span>{formatRelativeAge(room.ageMinutes)}</span>
                      <span>{room.sessionNames.length} lane{room.sessionNames.length === 1 ? "" : "s"}</span>
                    </div>
                  </article>
                ))}
                {!state?.overview.activeRooms.length ? (
                  <div className="staff-note staff-note-muted">No active rooms yet. Use the command palette to create one.</div>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="control-tower-rail">
            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Memory</div>
                  <h2>Continuity brief</h2>
                  <p>Four active layers stay explicit, and an offline dream cycle handles cleanup, linking, and promotion during quiet windows.</p>
                </div>
              </div>
              <div className="control-tower-memory-stack">
                <article className="control-tower-next-card">
                  <h3>{state?.memoryBrief?.goal || "No continuity goal yet."}</h3>
                  <p>{state?.memoryBrief?.summary || "Continuity will appear here when the startup brief is ready."}</p>
                  <div className="control-tower-next-footer">
                    <span>{state?.memoryBrief?.sourcePath || "live state fallback"}</span>
                    <span>{formatTimestamp(state?.memoryBrief?.generatedAt ?? null)}</span>
                  </div>
                </article>
                <article className="control-tower-memory-card">
                  <div className="control-tower-title-row">
                    <h3>Next memory actions</h3>
                    <span
                      className={`pill control-tower-pill-${actionabilityTone(state?.memoryBrief?.consolidation.actionabilityStatus ?? null)}`}
                    >
                      {state?.memoryBrief?.consolidation.actionabilityStatus || "quiet"}
                    </span>
                  </div>
                  <p>
                    {memoryActionsQuiet
                      ? "Startup continuity is inside the current thresholds, so memory action guidance stays quiet."
                      : "These actions are only surfaced when continuity, startup quality, or memory actionability falls below target."}
                  </p>
                  <div className="control-tower-memory-list">
                    {memoryActionRows.map((row) => (
                      <span key={row}>{row}</span>
                    ))}
                    {memoryActionsQuiet ? <span>No extra memory action is needed right now.</span> : null}
                  </div>
                  <div className="control-tower-next-footer">
                    <span>actionable insights: {state?.memoryBrief?.consolidation.actionableInsightCount ?? 0}</span>
                    <span>top actions: {(state?.memoryBrief?.consolidation.topActions ?? []).length}</span>
                  </div>
                </article>
                {[
                  { label: "Core blocks", rows: state?.memoryBrief?.layers.coreBlocks ?? [] },
                  { label: "Working memory", rows: state?.memoryBrief?.layers.workingMemory ?? [] },
                  { label: "Episodic memory", rows: state?.memoryBrief?.layers.episodicMemory ?? [] },
                  { label: "Canonical memory", rows: state?.memoryBrief?.layers.canonicalMemory ?? [] },
                ].map(({ label, rows }) => (
                  <article key={label} className="control-tower-memory-card">
                    <h3>{label}</h3>
                    <div className="control-tower-memory-list">
                      {rows.slice(0, 3).map((row) => (
                        <span key={row}>{row}</span>
                      ))}
                      {!rows.length ? <span>No items yet.</span> : null}
                    </div>
                  </article>
                ))}
                <article className="control-tower-memory-card">
                  <div className="control-tower-title-row">
                    <h3>Offline consolidation</h3>
                    <span
                      className={`pill control-tower-pill-${consolidationTone(state?.memoryBrief?.consolidation.mode ?? "unavailable")}`}
                    >
                      {state?.memoryBrief?.consolidation.mode ?? "unavailable"}
                    </span>
                  </div>
                  <p>
                    {state?.memoryBrief?.consolidation.summary ||
                      "Dream-cycle maintenance will appear here when the memory brief is ready."}
                  </p>
                  <div className="control-tower-memory-list">
                    {(state?.memoryBrief?.consolidation.focusAreas ?? []).slice(0, 3).map((row) => (
                      <span key={row}>{row}</span>
                    ))}
                    {!(state?.memoryBrief?.consolidation.focusAreas ?? []).length ? <span>No focus areas yet.</span> : null}
                  </div>
                  <div className="control-tower-next-footer">
                    <span>{formatTimestamp(state?.memoryBrief?.consolidation.lastRunAt ?? null)}</span>
                    <span>{formatTimestamp(state?.memoryBrief?.consolidation.nextRunAt ?? null)}</span>
                  </div>
                  <div className="control-tower-memory-list">
                    <span>status: {state?.memoryBrief?.consolidation.status || "unknown"}</span>
                    <span>promotions: {state?.memoryBrief?.consolidation.counts?.promotions ?? 0}</span>
                    <span>archives: {state?.memoryBrief?.consolidation.counts?.archives ?? 0}</span>
                    <span>quarantines: {state?.memoryBrief?.consolidation.counts?.quarantines ?? 0}</span>
                    <span>repaired links: {state?.memoryBrief?.consolidation.counts?.repairedLinks ?? 0}</span>
                    <span>mix quality: {state?.memoryBrief?.consolidation.mixQuality || "unknown"}</span>
                    <span>second pass queries: {state?.memoryBrief?.consolidation.secondPassQueriesUsed ?? 0}</span>
                    <span>pending candidates: {state?.memoryBrief?.consolidation.promotionCandidatesPending ?? 0}</span>
                    <span>confirmed candidates: {state?.memoryBrief?.consolidation.promotionCandidatesConfirmed ?? 0}</span>
                    <span>stalled candidates: {state?.memoryBrief?.consolidation.stalledCandidateCount ?? 0}</span>
                    {(state?.memoryBrief?.consolidation.dominanceWarnings ?? []).slice(0, 2).map((warning) => (
                      <span key={warning}>warning: {warning}</span>
                    ))}
                    {state?.memoryBrief?.consolidation.lastError ? <span>last error: {state.memoryBrief.consolidation.lastError}</span> : null}
                  </div>
                </article>
                <article className="control-tower-memory-card">
                  <div className="control-tower-title-row">
                    <h3>Startup quality</h3>
                    <span className={`pill control-tower-pill-${startupScoreTone(startupScorecard)}`}>
                      {startupScorecard
                        ? `${startupScorecard.rubric.overallScore ?? "n/a"}/${startupScorecard.rubric.grade}`
                        : "n/a"}
                    </span>
                  </div>
                  <p>
                    {startupScorecard
                      ? `Latest startup is ${startupScorecard.latest.sample.status} with ${startupScorecard.latest.sample.reasonCode || "unknown"} and continuity ${startupScorecard.latest.sample.continuityState}.`
                      : "The startup scorecard artifact has not been written yet."}
                  </p>
                  <div className="control-tower-memory-list">
                    <span>ready rate: {formatPercent(startupScorecard?.metrics.readyRate)}</span>
                    <span>grounding-ready rate: {formatPercent(startupScorecard?.metrics.groundingReadyRate)}</span>
                    <span>blocked continuity: {formatPercent(startupScorecard?.metrics.blockedContinuityRate)}</span>
                    <span>p95 latency: {formatLatency(startupScorecard?.metrics.p95LatencyMs)}</span>
                    <span>telemetry coverage: {formatPercent(startupScorecard?.supportingSignals.toolcalls.telemetryCoverageRate)}</span>
                    <span>avg pre-start repo reads: {startupScorecard?.supportingSignals.toolcalls.averagePreStartupRepoReads ?? "n/a"}</span>
                  </div>
                  <div className="control-tower-memory-list">
                    {(startupScorecard?.coverage.gaps ?? []).slice(0, 3).map((gap) => (
                      <span key={gap}>gap: {gap}</span>
                    ))}
                    {!(startupScorecard?.coverage.gaps ?? []).length ? <span>No current scorecard gaps.</span> : null}
                  </div>
                </article>
              </div>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Approvals</div>
                  <h2>Approval queue</h2>
                  <p>Pending capability reviews stay visible here instead of hiding inside raw audit trails.</p>
                </div>
              </div>
              <div className="control-tower-pinned-list">
                {(state?.approvals ?? []).map((approval) => (
                  <article key={approval.id} className="control-tower-pinned-card">
                    <h3>{approval.capabilityId}</h3>
                    <p>{approval.summary}</p>
                    <span>
                      {approval.owner} · {approval.status} · {approval.risk}
                    </span>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => handleActionTarget(approval.target)}>
                      Open approvals
                    </button>
                  </article>
                ))}
                {!state?.approvals.length ? (
                  <div className="staff-note staff-note-ok">No approvals are waiting right now.</div>
                ) : null}
              </div>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Next</div>
                  <h2>Good Next Moves</h2>
                </div>
              </div>
              <div className="control-tower-next-list">
                {(state?.overview.goodNextMoves ?? []).map((action) => (
                  <article key={action.id} className="control-tower-next-card">
                    <h3>{action.title}</h3>
                    <p>{action.why}</p>
                    <div className="control-tower-next-footer">
                      <span>{formatRelativeAge(action.ageMinutes)}</span>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => handleActionTarget(action.target)}>
                        {action.actionLabel || actionButtonLabel(action.target)}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Escalated</div>
                  <h2>Pinned blockers</h2>
                </div>
              </div>
              <div className="control-tower-pinned-list">
                {(state?.pinnedItems ?? []).map((item) => (
                  <article key={item.id} className="control-tower-pinned-card">
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <span>{item.actionHint}</span>
                  </article>
                ))}
                {!state?.pinnedItems.length ? (
                  <div className="staff-note staff-note-ok">No host-wide blockers are pinned right now.</div>
                ) : null}
              </div>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Changes</div>
                  <h2>Recent changes</h2>
                  <p>Structured event envelopes replace log-first scanning.</p>
                </div>
              </div>
              <div className="control-tower-timeline">
                {(state?.recentChanges ?? []).slice(0, 4).map((event) => (
                  <article key={event.id} className={`control-tower-event-card control-tower-event-${event.severity}`}>
                    <div className="control-tower-event-meta">
                      <strong>{event.title}</strong>
                      <time>{formatRelativeAge(minutesSince(event.occurredAt || event.at))}</time>
                    </div>
                    <p>{event.summary}</p>
                    <div className="control-tower-event-footer">
                      <span>{event.type || event.kind}</span>
                      {event.actionLabel ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() =>
                            handleActionTarget(
                              event.roomId
                                ? { type: "room", roomId: event.roomId }
                                : event.serviceId
                                  ? { type: "service", serviceId: event.serviceId }
                                  : { type: "ops", action: "events" },
                            )
                          }
                        >
                          {event.actionLabel}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!state?.recentChanges.length ? (
                  <div className="staff-note staff-note-muted">No recent changes are recorded yet.</div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>

        <section className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Channels</div>
              <h2>Active Codex, Discord, and planning lanes</h2>
              <p>Channel summaries stay compact so the operator can understand live ownership without opening every room.</p>
            </div>
          </div>
          <div className="control-tower-channel-grid">
            {(state?.channels ?? []).map((channel) => (
              <article key={channel.id} className="control-tower-channel-card">
                <div className="control-tower-card-top">
                  <div>
                    <span className="control-tower-room-name">{channel.label}</span>
                    <span className="control-tower-room-project">{channel.channel}</span>
                  </div>
                  <span className={`pill control-tower-pill-${toneClass(channel.state === "error" ? "error" : channel.state === "waiting" ? "warning" : "neutral")}`}>
                    {channel.state}
                  </span>
                </div>
                <h3>{channel.objective}</h3>
                <p>{channel.blocker || channel.next}</p>
                <div className="control-tower-next-footer">
                  <span>{channel.owner}</span>
                  {channel.roomId ? (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => handleActionTarget({ type: "room", roomId: channel.roomId as string })}>
                      Open lane
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!state?.channels.length ? (
              <div className="staff-note staff-note-muted">No active channels are bound yet.</div>
            ) : null}
          </div>
        </section>

        <section ref={servicesRef} id="control-tower-services" className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Services</div>
              <h2>Service oversight</h2>
              <p>Healthy, readable cards with bounded actions and confirmation where needed.</p>
            </div>
          </div>
          <div className="control-tower-service-grid">
            {(state?.services ?? []).map((service) => (
              <article key={service.id} className={`control-tower-service-card control-tower-tone-${toneClass(service.health)}`}>
                <div className="control-tower-card-top">
                  <div>
                    <span className="control-tower-service-name">{service.label}</span>
                    <span className="control-tower-service-impact">{service.impact}</span>
                  </div>
                  <span className={`pill control-tower-pill-${toneClass(service.health)}`}>{service.health}</span>
                </div>
                <p>{service.summary}</p>
                <div className="control-tower-service-change">{service.recentChanges}</div>
                <div className="control-tower-service-actions">
                  {service.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={action.verb === "status" ? "btn btn-ghost btn-small" : "btn btn-secondary btn-small"}
                      onClick={() => void handleServiceAction(service, action.verb, action.requiresConfirmation)}
                      disabled={Boolean(busyKey)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section ref={eventsRef} id="control-tower-events" className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Events</div>
              <h2>Recent events and incidents</h2>
              <p>Curated operator timeline, not raw logs first.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {(state?.events ?? []).map((event) => (
              <article key={event.id} className={`control-tower-event-card control-tower-event-${event.severity}`}>
                <div className="control-tower-event-meta">
                  <strong>{event.title}</strong>
                  <time>{formatTimestamp(event.at)}</time>
                </div>
                <p>{event.summary}</p>
                <div className="control-tower-event-footer">
                  <span>{event.actor}</span>
                  {event.actionLabel ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => handleActionTarget(
                        event.roomId
                          ? { type: "room", roomId: event.roomId }
                          : event.serviceId
                            ? { type: "service", serviceId: event.serviceId }
                            : { type: "ops", action: "events" },
                      )}
                    >
                      {event.actionLabel}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      {paletteOpen ? (
        <ControlTowerCommandPalette
          open
          busy={Boolean(busyKey)}
          items={paletteItems}
          onClose={() => setPaletteOpen(false)}
          onSpawnRoom={(draft) => handleSpawnRoom(draft)}
        />
      ) : null}

      {selectedRoomId && roomDetail ? (
        <ControlTowerRoomDrawer
          key={roomDetail.id}
          open
          room={roomDetail}
          busy={Boolean(busyKey)}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          onClose={closeRoom}
          onRefresh={() => {
            void openRoom(selectedRoomId);
          }}
          onSendInstruction={handleSendInstruction}
          onTogglePinned={handleTogglePinned}
          onCopyAttach={handleCopyAttach}
        />
      ) : null}
    </>
  );
}
