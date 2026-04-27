import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import ControlTowerRoomDrawer from "./controlTower/ControlTowerRoomDrawer";
import ControlTowerRunDrawer from "./controlTower/ControlTowerRunDrawer";
import {
  clearStoredStudioBrainBaseUrlOverride,
  getStoredStudioBrainBaseUrlOverride,
  setStoredStudioBrainBaseUrlOverride,
} from "../../utils/studioBrain";
import {
  ackControlTowerOverseer,
  approveControlTowerProposal,
  fetchAgentRuntimeRunDetail,
  fetchControlTowerRoom,
  fetchControlTowerState,
  getStudioBrainControlTowerResolution,
  rejectControlTowerProposal,
  runControlTowerServiceAction,
  sendControlTowerInstruction,
  sendPartnerCheckinAction,
  setControlTowerRoomPinned,
  subscribeControlTowerEvents,
  updatePartnerOpenLoopStatus,
  type AgentRuntimeRunDetail,
  type ControlTowerActionTarget,
  type ControlTowerApprovalItem,
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

function formatHostMetric(value: number | null | undefined, suffix = "%", factor = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.round(Number(value) * factor)}${suffix}`;
}

function runtimeTone(
  status: "queued" | "running" | "blocked" | "verified" | "completed" | "failed" | null | undefined,
): "danger" | "warn" | "ok" | "neutral" {
  if (status === "failed") return "danger";
  if (status === "blocked" || status === "queued") return "warn";
  if (status === "running" || status === "verified" || status === "completed") return "ok";
  return "neutral";
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

function partnerInitiativeTone(
  state: "quiet" | "monitoring" | "briefing" | "executing" | "cooldown" | "waiting_on_owner",
): "danger" | "warn" | "ok" | "neutral" {
  if (state === "waiting_on_owner") return "warn";
  if (state === "executing") return "ok";
  if (state === "cooldown") return "neutral";
  if (state === "briefing") return "ok";
  if (state === "monitoring") return "neutral";
  return "neutral";
}

function openLoopTone(status: "open" | "delegated" | "paused" | "resolved"): "danger" | "warn" | "ok" | "neutral" {
  if (status === "open") return "warn";
  if (status === "resolved") return "ok";
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<AgentRuntimeRunDetail | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "fallback">("connecting");
  const servicesRef = useRef<HTMLElement | null>(null);
  const eventsRef = useRef<HTMLElement | null>(null);
  const partnerRef = useRef<HTMLElement | null>(null);
  const approvalsRef = useRef<HTMLElement | null>(null);
  const incidentsRef = useRef<HTMLElement | null>(null);
  const streamRefreshTimerRef = useRef<number | null>(null);

  const fetchOptions = useMemo(
    () => ({
      user,
      adminToken,
    }),
    [adminToken, user],
  );

  const openRoom = useCallback(async (roomId: string) => {
    setSelectedRunId(null);
    setRunDetail(null);
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

  const openRun = useCallback(
    async (runId: string) => {
      setSelectedRoomId(null);
      setRoomDetail(null);
      setRoomQuery(null);
      setSelectedRunId(runId);
      try {
        const detail = await fetchAgentRuntimeRunDetail(runId, fetchOptions);
        setRunDetail(detail);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [fetchOptions],
  );

  const closeRun = useCallback(() => {
    setSelectedRunId(null);
    setRunDetail(null);
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
        if (selectedRunId) {
          const detail = await fetchAgentRuntimeRunDetail(selectedRunId, fetchOptions);
          setRunDetail(detail);
        }
        if (!options?.silent) setErrorMessage("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [active, fetchOptions, isDisabled, resolution.baseUrl, selectedRoomId, selectedRunId],
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
      if (target.action === "agent-runtime") {
        const runId = state?.agentRuntime?.runId || runDetail?.runId;
        if (runId) {
          void openRun(runId);
        }
        return;
      }
      if (target.action === "overseer" || target.action === "events") {
        eventsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (target.action === "partner") {
        partnerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (target.action === "approvals") {
        approvalsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      void loadState();
    },
    [loadState, openRoom, openRun, runDetail?.runId, state?.agentRuntime?.runId, state?.rooms],
  );

  const jumpToServices = useCallback(() => {
    servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const jumpToEvents = useCallback(() => {
    incidentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const handlePartnerCommand = useCallback(
    async (
      action: "ack" | "snooze" | "pause" | "redirect" | "why_this" | "continue",
      payload?: { note?: string; snoozeMinutes?: number; successMessage?: string },
    ) => {
      await runAction(`partner:${action}`, async () => {
        await sendPartnerCheckinAction(action, fetchOptions, {
          note: payload?.note,
          snoozeMinutes: payload?.snoozeMinutes,
        });
        setStatusMessage(payload?.successMessage || `Chief-of-staff command "${action}" recorded.`);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handlePartnerOpenLoop = useCallback(
    async (
      loopId: string,
      status: "delegated" | "paused" | "resolved",
      payload?: { note?: string; successMessage?: string },
    ) => {
      await runAction(`partner-loop:${loopId}:${status}`, async () => {
        await updatePartnerOpenLoopStatus(loopId, status, fetchOptions, {
          note: payload?.note,
        });
        setStatusMessage(payload?.successMessage || `Updated ${loopId} to ${status}.`);
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

  const handleAckIncident = useCallback(
    async (runId?: string | null) => {
      await runAction(`incident-ack:${runId || "latest"}`, async () => {
        await ackControlTowerOverseer("Acknowledged from the Control Tower incident queue.", fetchOptions, {
          runId: runId || undefined,
        });
        setStatusMessage("Incident acknowledgement recorded.");
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handleApproveProposal = useCallback(
    async (approval: ControlTowerApprovalItem) => {
      const rationale = window.prompt(
        `Approval rationale for ${approval.capabilityId}`,
        `Approved from the Control Tower after reviewing ${approval.capabilityId}.`,
      );
      if (!rationale) return;
      await runAction(`approval:approve:${approval.id}`, async () => {
        await approveControlTowerProposal(approval.id, rationale, fetchOptions);
        setStatusMessage(`${approval.capabilityId} approved.`);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const handleRejectProposal = useCallback(
    async (approval: ControlTowerApprovalItem) => {
      const reason = window.prompt(
        `Rejection reason for ${approval.capabilityId}`,
        `Rejected from the Control Tower because the requested action needs revision.`,
      );
      if (!reason) return;
      await runAction(`approval:reject:${approval.id}`, async () => {
        await rejectControlTowerProposal(approval.id, reason, fetchOptions);
        setStatusMessage(`${approval.capabilityId} rejected.`);
        await loadState({ silent: true });
      });
    },
    [fetchOptions, loadState, runAction],
  );

  const counts = state?.counts ?? {
    needsAttention: 0,
    working: 0,
    waiting: 0,
    blocked: 0,
    escalated: 0,
  };
  const startupScorecard = state?.startupScorecard ?? null;
  const runtimeSummary = state?.agentRuntime ?? null;
  const hosts = state?.hosts ?? [];
  const boardRows = state?.board ?? [];
  const approvals = state?.approvals ?? [];
  const channels = state?.channels ?? [];
  const services = state?.services ?? [];
  const timelineEvents = state?.events ?? [];
  const recentChanges = (state?.recentChanges ?? []).slice(0, 4);
  const needsAttentionItems = state?.overview.needsAttention ?? [];
  const activeRooms = state?.overview.activeRooms ?? [];
  const goodNextMoves = state?.overview.goodNextMoves ?? [];
  const pinnedItems = state?.pinnedItems ?? [];
  const incidentEvents = (state?.events ?? []).filter((event) => event.severity !== "info").slice(0, 6);
  const partner = state?.partner ?? null;
  const primaryPartnerLoop = partner?.openLoops.find((loop) => loop.status === "open") ?? partner?.openLoops[0] ?? null;
  const memoryActionRows = useMemo(() => getMemoryActionRows(state), [state]);
  const memoryActionsQuiet = memoryActionRows.length === 0;
  const memoryLayerRows = [
    { label: "Core blocks", rows: state?.memoryBrief?.layers.coreBlocks ?? [] },
    { label: "Working memory", rows: state?.memoryBrief?.layers.workingMemory ?? [] },
    { label: "Episodic memory", rows: state?.memoryBrief?.layers.episodicMemory ?? [] },
    { label: "Canonical memory", rows: state?.memoryBrief?.layers.canonicalMemory ?? [] },
  ];
  const memoryVerbose =
    !memoryActionsQuiet ||
    (state?.memoryBrief?.continuityState ?? "missing") === "continuity_degraded" ||
    Boolean(state?.memoryBrief?.consolidation.lastError);
  const hasActionableRuntime =
    Boolean(runtimeSummary) &&
    ["queued", "running", "blocked", "failed"].includes(String(runtimeSummary?.status ?? "").trim().toLowerCase());
  const partnerHasActionableState =
    Boolean(partner?.needsOwnerDecision) ||
    Boolean(partner?.singleDecisionNeeded) ||
    Boolean(partner?.lastMeaningfulContactAt) ||
    Boolean(partner?.nextCheckInAt) ||
    Boolean(partner?.cooldownUntil) ||
    (partner?.openLoops.length ?? 0) > 0 ||
    (partner?.verifiedContext.length ?? 0) > 0 ||
    (partner?.programs.length ?? 0) > 0 ||
    (partner?.initiativeState ?? "quiet") !== "quiet" ||
    Boolean(partner?.contactReason && !/no partner interruption is active right now/i.test(partner.contactReason)) ||
    Boolean(partner?.summary && !/keep this quiet until there is a meaningful brief to deliver/i.test(partner.summary)) ||
    Boolean(partner?.recommendedFocus && !/no partner brief yet/i.test(partner.recommendedFocus));
  const showChipletGrid =
    approvals.length > 0 || goodNextMoves.length > 0 || pinnedItems.length > 0 || recentChanges.length > 0;
  const showBoardSurface = boardRows.length > 0;
  const showExecutionSurface = Boolean(hasActionableRuntime || hosts.length);
  const showNeedsAttentionSurface = needsAttentionItems.length > 0;
  const showRoomsSurface = activeRooms.length > 0;
  const showIncidentsSurface = incidentEvents.length > 0;
  const showChannelsSurface = channels.length > 0;
  const showServicesSurface = services.length > 0;
  const showEventsSurface = timelineEvents.length > 0;
  const quietMode =
    !showBoardSurface &&
    !showExecutionSurface &&
    !showNeedsAttentionSurface &&
    !showRoomsSurface &&
    !showIncidentsSurface &&
    !showChipletGrid &&
    !showChannelsSurface &&
    !showServicesSurface &&
    !showEventsSurface &&
    !partnerHasActionableState &&
    !memoryVerbose;

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
        <section className={`card staff-console-card control-tower-hero${quietMode ? " control-tower-hero-quiet" : ""}`}>
          <div className="control-tower-hero-copy">
            <div className="control-tower-kicker">Studio Brain Control Tower v3</div>
            <h1>{quietMode ? "Quiet control tower" : "30-second operator plane"}</h1>
            <p>
              {quietMode
                ? "No active rooms, approvals, incidents, or host heartbeats are in flight. The surface stays compact until real operator work arrives."
                : "Mission board, approvals, memory brief, and live channels are the first screen now. tmux and logs stay backstage as recovery substrate."}
            </p>
          </div>
          <div className="control-tower-hero-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void loadState()}>
              {loading ? "Refreshing..." : "Refresh"}
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

          {quietMode ? (
            <article className="control-tower-next-card">
              <div className="control-tower-title-row">
                <h3>Quiet right now</h3>
                <span className="pill control-tower-pill-neutral">
                  {streamStatus === "live" ? "Live signal" : streamStatus === "fallback" ? "Fallback signal" : "Connecting"}
                </span>
              </div>
              <p>
                The tower will expand when the first live room, run, incident, approval, or host heartbeat arrives. Until then, this stays as a short readiness summary instead of a wall of empty panels.
              </p>
              <div className="control-tower-next-footer">
                <span>{state?.ops.summary || "Waiting on the first control-plane signal."}</span>
                <span>{state?.generatedAt ? `Updated ${formatTimestamp(state.generatedAt)}` : "No snapshot timestamp yet"}</span>
              </div>
            </article>
          ) : (
            <div className="control-tower-stat-grid">
              <article className="control-tower-stat-card">
                <span>Needs Attention</span>
                <strong>{counts.needsAttention}</strong>
                <p>Human follow-up or operator review is needed now.</p>
              </article>
              <article className="control-tower-stat-card">
                <span>Active Rooms</span>
                <strong>{activeRooms.length}</strong>
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
                <strong>{approvals.length}</strong>
                <p>Pending or in-flight operator approvals from the control plane.</p>
              </article>
            </div>
          )}

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
            {!quietMode ? <span>{state?.ops.summary || "Loading Control Tower status..."}</span> : null}
            {!quietMode && state?.generatedAt ? <span>{`Updated ${formatTimestamp(state.generatedAt)}`}</span> : null}
          </div>

          {hosts.length ? (
            <div className="control-tower-host-strip">
              {hosts.map((host) => (
                <article key={host.hostId} className={`control-tower-host-card control-tower-tone-${host.health === "healthy" ? toneClass("healthy") : host.health === "maintenance" ? "neutral" : host.health === "offline" ? "error" : "warning"}`}>
                  <div className="control-tower-card-top">
                    <div>
                      <span className="control-tower-room-name">{host.label}</span>
                      <span className="control-tower-room-project">{host.role}</span>
                    </div>
                    <div className="control-tower-host-badges">
                      <span className="pill control-tower-pill-neutral">{host.environment}</span>
                      <span className={`pill control-tower-pill-${host.connectivity === "online" ? "ok" : host.connectivity === "stale" ? "warn" : "danger"}`}>
                        {host.connectivity}
                      </span>
                    </div>
                  </div>
                  <p>{host.summary}</p>
                  <div className="control-tower-host-metrics">
                    <span>cpu {formatHostMetric(host.metrics.cpuPct)}</span>
                    <span>memory {formatHostMetric(host.metrics.memoryPct)}</span>
                    <span>load {formatHostMetric(host.metrics.load1, "", 1)}</span>
                    <span>{host.agentCount} agent{host.agentCount === 1 ? "" : "s"}</span>
                  </div>
                  <div className="control-tower-next-footer">
                    <span>{formatRelativeAge(host.ageMinutes)}</span>
                    {host.currentRunId ? (
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void openRun(host.currentRunId as string)}>
                        Open run
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {statusMessage ? <div className="staff-note staff-note-ok">{statusMessage}</div> : null}
        {errorMessage ? <div className="staff-note staff-note-danger">{errorMessage}</div> : null}

        {quietMode ? (
          <div className="control-tower-chiplet-grid">
            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Situation</div>
                  <h2>Tower is standing by</h2>
                  <p>The board stays collapsed until there is real work to supervise.</p>
                </div>
              </div>
              <article className="control-tower-next-card">
                <h3>No live dispatch yet</h3>
                <p>No rooms, runs, approvals, incidents, or host heartbeats are active right now.</p>
                <div className="control-tower-memory-list">
                  <span>needs attention: {counts.needsAttention}</span>
                  <span>active rooms: {activeRooms.length}</span>
                  <span>approvals: {approvals.length}</span>
                  <span>incidents: {incidentEvents.length}</span>
                </div>
              </article>
            </section>

            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Memory</div>
                  <h2>Continuity summary</h2>
                  <p>Quiet continuity stays condensed until drift or a real memory action appears.</p>
                </div>
              </div>
              <article className="control-tower-memory-card">
                <div className="control-tower-title-row">
                  <h3>{state?.memoryBrief?.goal || "Continuity quiet"}</h3>
                  <span className={`pill control-tower-pill-${continuityTone(state?.memoryBrief?.continuityState ?? "missing")}`}>
                    {state?.memoryBrief?.continuityState ?? "missing"}
                  </span>
                </div>
                <p>{state?.memoryBrief?.summary || "Continuity will appear here when the startup brief is ready."}</p>
                <div className="control-tower-next-footer">
                  <span>{state?.memoryBrief?.sourcePath || "live state fallback"}</span>
                  <span>{formatTimestamp(state?.memoryBrief?.generatedAt ?? null)}</span>
                </div>
              </article>
            </section>

            <section ref={partnerRef} className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Partner</div>
                  <h2>Chief of staff</h2>
                  <p>Owner-facing partner state stays compact until there is a real interruption or decision.</p>
                </div>
              </div>
              <article className="control-tower-memory-card">
                <div className="control-tower-title-row">
                  <h3>{partner?.recommendedFocus || "No partner brief yet."}</h3>
                  <span className={`pill control-tower-pill-${partnerInitiativeTone(partner?.initiativeState ?? "quiet")}`}>
                    {partner?.initiativeState || "quiet"}
                  </span>
                </div>
                <p>{partner?.contactReason || partner?.summary || "No owner-facing interruption is active right now."}</p>
                <div className="control-tower-next-footer">
                  <span>{partner?.persona.displayName || "Chief-of-staff partner"}</span>
                  <div className="control-tower-partner-loop-actions">
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("why_this", { successMessage: "Chief-of-staff rationale refreshed." })}>
                      Why this
                    </button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("continue", { successMessage: "Chief-of-staff cadence resumed." })}>
                      Continue
                    </button>
                  </div>
                </div>
              </article>
            </section>
          </div>
        ) : (
          <>
        {showBoardSurface ? (
        <section className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Board</div>
              <h2>30-second operator board</h2>
              <p>Fixed schema across surfaces: owner, task, state, blocker, next, and last update.</p>
            </div>
          </div>
          <div className="control-tower-board-list">
            {boardRows.map((row) => (
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
                {row.contactReason || row.decisionNeeded ? (
                  <div className="control-tower-memory-list">
                    {row.contactReason ? <span>why contacted: {row.contactReason}</span> : null}
                    {row.decisionNeeded ? <span>decision: {row.decisionNeeded}</span> : null}
                  </div>
                ) : null}
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
                ) : row.runId ? (
                  <div className="control-tower-next-footer">
                    <span>{row.runId}</span>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void openRun(row.runId as string)}>
                      Open run
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!boardRows.length ? (
              <div className="staff-note staff-note-muted">The mission board will populate when the first active rooms appear.</div>
            ) : null}
          </div>
        </section>
        ) : null}

        <div className="control-tower-grid">
          <div className="control-tower-main">
            {showExecutionSurface ? (
              <section className="card staff-console-card control-tower-section-card">
                <div className="control-tower-section-header">
                  <div>
                    <div className="control-tower-kicker">Execution</div>
                    <h2>Live run</h2>
                    <p>Intent, execution, and machine truth stay visible together instead of getting buried in logs.</p>
                  </div>
                </div>
                {runtimeSummary ? (
                  <article className={`control-tower-next-card control-tower-tone-${runtimeTone(runtimeSummary.status)}`}>
                    <div className="control-tower-title-row">
                      <h3>{runtimeSummary.title}</h3>
                      <div className="control-tower-host-badges">
                        <span className={`pill control-tower-pill-${runtimeTone(runtimeSummary.status)}`}>{runtimeSummary.status}</span>
                        <span className="pill control-tower-pill-neutral">{runtimeSummary.environment || "server"}</span>
                      </div>
                    </div>
                    <p>{runtimeSummary.goal}</p>
                    <div className="control-tower-board-grid">
                      <div>
                        <span className="control-tower-board-label">Blocker</span>
                        <strong>{runtimeSummary.activeBlockers[0] || "None"}</strong>
                      </div>
                      <div>
                        <span className="control-tower-board-label">Next</span>
                        <strong>{runtimeSummary.boardRow?.next || "No next move"}</strong>
                      </div>
                      <div>
                        <span className="control-tower-board-label">Host</span>
                        <strong>{runtimeSummary.hostId || "unassigned"}</strong>
                      </div>
                    </div>
                    <div className="control-tower-next-footer">
                      <span>{formatTimestamp(runtimeSummary.updatedAt)}</span>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void openRun(runtimeSummary.runId)}>
                        Open run inspector
                      </button>
                    </div>
                  </article>
                ) : (
                  <div className="staff-note staff-note-muted">Host heartbeats are present, but no active run summary is available yet.</div>
                )}
              </section>
            ) : null}

            {showNeedsAttentionSurface ? (
            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Home</div>
                  <h2>Needs Attention</h2>
                  <p>Each item tells you what it is, why it matters, and the next clean move.</p>
                </div>
              </div>
              <div className="control-tower-attention-grid">
                {needsAttentionItems.map((item) => (
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
              </div>
            </section>
            ) : null}

            {showRoomsSurface ? (
            <section className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Rooms</div>
                  <h2>Active Rooms</h2>
                  <p>Rooms group related work lanes so you can inspect, act, and move on.</p>
                </div>
              </div>
              <div className="control-tower-room-grid">
                {activeRooms.map((room) => (
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
                    {room.decisionNeeded ? <p>{`Decision needed: ${room.decisionNeeded}`}</p> : null}
                    <div className="control-tower-room-footer">
                      <span>{formatRelativeAge(room.ageMinutes)}</span>
                      <span>{room.sessionNames.length} lane{room.sessionNames.length === 1 ? "" : "s"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            ) : null}
          </div>

          <aside className="control-tower-rail">
            {showIncidentsSurface ? (
            <section ref={incidentsRef} className="card staff-console-card control-tower-section-card">
              <div className="control-tower-section-header">
                <div>
                  <div className="control-tower-kicker">Incidents</div>
                  <h2>Incident queue</h2>
                  <p>Critical and warning events stay separated from the full timeline so operators can acknowledge them fast.</p>
                </div>
              </div>
              <div className="control-tower-pinned-list">
                {incidentEvents.map((event) => (
                  <article key={event.id} className={`control-tower-pinned-card control-tower-tone-${toneClass(event.severity)}`}>
                    <h3>{event.title}</h3>
                    <p>{event.summary}</p>
                    <span>{event.type || event.kind}</span>
                    <div className="control-tower-partner-loop-actions">
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => handleActionTarget(event.roomId ? { type: "room", roomId: event.roomId } : event.serviceId ? { type: "service", serviceId: event.serviceId } : event.runId ? { type: "ops", action: "agent-runtime" } : { type: "ops", action: "events" })}>
                        Inspect
                      </button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void handleAckIncident(event.runId)}>
                        Acknowledge
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            ) : null}

            {memoryVerbose ? (
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
                  {memoryLayerRows.map(({ label, rows }) => (
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
            ) : (
              <section className="card staff-console-card control-tower-section-card">
                <div className="control-tower-section-header">
                  <div>
                    <div className="control-tower-kicker">Memory</div>
                    <h2>Continuity brief</h2>
                    <p>Quiet continuity stays compact until there is a real action or drift signal.</p>
                  </div>
                </div>
                <article className="control-tower-memory-card">
                  <div className="control-tower-title-row">
                    <h3>{state?.memoryBrief?.goal || "Continuity quiet"}</h3>
                    <span className={`pill control-tower-pill-${continuityTone(state?.memoryBrief?.continuityState ?? "missing")}`}>
                      {state?.memoryBrief?.continuityState ?? "missing"}
                    </span>
                  </div>
                  <p>{state?.memoryBrief?.summary || "Continuity will appear here when the startup brief is ready."}</p>
                  <div className="control-tower-next-footer">
                    <span>{state?.memoryBrief?.sourcePath || "live state fallback"}</span>
                    <span>{formatTimestamp(state?.memoryBrief?.generatedAt ?? null)}</span>
                  </div>
                </article>
              </section>
            )}

            {!partnerHasActionableState ? (
              <section ref={partnerRef} className="card staff-console-card control-tower-section-card">
                <div className="control-tower-section-header">
                  <div>
                    <div className="control-tower-kicker">Partner</div>
                    <h2>Chief of staff</h2>
                    <p>Quiet partner state stays condensed until there is a real owner-facing interruption.</p>
                  </div>
                </div>
                <article className="control-tower-memory-card">
                  <div className="control-tower-title-row">
                    <h3>{partner?.recommendedFocus || "No partner brief yet."}</h3>
                    <span className={`pill control-tower-pill-${partnerInitiativeTone(partner?.initiativeState ?? "quiet")}`}>
                      {partner?.initiativeState || "quiet"}
                    </span>
                  </div>
                  <p>{partner?.contactReason || partner?.summary || "No owner-facing interruption is active right now."}</p>
                  <div className="control-tower-next-footer">
                    <span>{partner?.persona.displayName || "Chief-of-staff partner"}</span>
                    <div className="control-tower-partner-loop-actions">
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("why_this", { successMessage: "Chief-of-staff rationale refreshed." })}>
                        Why this
                      </button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("continue", { successMessage: "Chief-of-staff cadence resumed." })}>
                        Continue
                      </button>
                    </div>
                  </div>
                </article>
              </section>
            ) : null}

          </aside>
          </div>

          {partnerHasActionableState ? (
          <section ref={partnerRef} className="card staff-console-card control-tower-section-card control-tower-partner-panel">
            <div className="control-tower-section-header">
              <div>
                <div className="control-tower-kicker">Partner</div>
                <h2>Chief of staff</h2>
                <p>Codex is the relationship shell; Control Tower stays the source of truth for what was verified, why you were interrupted, and the one decision needed next.</p>
              </div>
            </div>
            <div className="control-tower-memory-stack control-tower-partner-panel-grid">
              <article className="control-tower-next-card control-tower-partner-hero-card">
                <div className="control-tower-title-row">
                  <h3>{partner?.recommendedFocus || "No partner brief yet."}</h3>
                  <span className={`pill control-tower-pill-${partnerInitiativeTone(partner?.initiativeState ?? "quiet")}`}>
                    {partner?.initiativeState || "quiet"}
                  </span>
                </div>
                <p>{partner?.summary || "Studio Brain will keep this quiet until there is a meaningful brief to deliver."}</p>
                <div className="control-tower-next-footer">
                  <span>{partner?.persona.displayName || "Chief-of-staff partner"}</span>
                  <span>{formatTimestamp(partner?.nextCheckInAt ?? null)}</span>
                </div>
              </article>

              <article className="control-tower-memory-card">
                <div className="control-tower-title-row">
                  <h3>Why this contact</h3>
                  <span className={`pill control-tower-pill-${partner?.needsOwnerDecision ? "warn" : "neutral"}`}>
                    {partner?.needsOwnerDecision ? "decision waiting" : "bounded cadence"}
                  </span>
                </div>
                <p>{partner?.contactReason || "No partner interruption is active right now."}</p>
                <div className="control-tower-memory-list">
                  <span>single decision: {partner?.singleDecisionNeeded || "None right now."}</span>
                  <span>last meaningful contact: {formatTimestamp(partner?.lastMeaningfulContactAt ?? null)}</span>
                  <span>next check-in: {formatTimestamp(partner?.nextCheckInAt ?? null)}</span>
                  <span>cooldown: {formatTimestamp(partner?.cooldownUntil ?? null)}</span>
                </div>
              </article>

              <article className="control-tower-memory-card">
                <div className="control-tower-title-row">
                  <h3>Owner commands</h3>
                  <span className="pill control-tower-pill-neutral">Codex thread controls</span>
                </div>
                <p>These commands update the chief-of-staff loop immediately without changing the underlying Control Tower evidence.</p>
                <div className="control-tower-partner-command-row">
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("ack", { successMessage: "Chief-of-staff nudge acknowledged." })}>
                    Acknowledge
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("pause", { successMessage: "Chief-of-staff cadence paused for the current window." })}>
                    Pause
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() =>
                      primaryPartnerLoop
                        ? void handlePartnerOpenLoop(primaryPartnerLoop.id, "delegated", {
                            note: "Redirected from Control Tower.",
                            successMessage: "Primary open loop redirected.",
                          })
                        : void handlePartnerCommand("redirect", {
                            note: "Redirected from Control Tower.",
                            successMessage: "Chief-of-staff direction updated.",
                          })
                    }
                  >
                    Redirect
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("why_this", { successMessage: "Chief-of-staff rationale refreshed." })}>
                    Why this
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("continue", { successMessage: "Chief-of-staff cadence resumed." })}>
                    Continue
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerCommand("snooze", { snoozeMinutes: 120, successMessage: "Chief-of-staff nudges snoozed for 2 hours." })}>
                    Snooze 2h
                  </button>
                </div>
              </article>

              <article className="control-tower-memory-card">
                <h3>Verified context</h3>
                <div className="control-tower-memory-list">
                  {(partner?.verifiedContext ?? []).slice(0, 4).map((row) => (
                    <span key={row}>{row}</span>
                  ))}
                  {!(partner?.verifiedContext ?? []).length ? <span>No verified context has been promoted yet.</span> : null}
                </div>
              </article>

              <article className="control-tower-memory-card control-tower-partner-open-loops-card">
                <div className="control-tower-title-row">
                  <h3>Open loops</h3>
                  <span className="pill control-tower-pill-neutral">{partner?.openLoops.length ?? 0} tracked</span>
                </div>
                <div className="control-tower-partner-loop-list">
                  {(partner?.openLoops ?? []).slice(0, 4).map((loop) => (
                    <article key={loop.id} className="control-tower-partner-loop-card">
                      <div className="control-tower-card-top">
                        <div>
                          <span className="control-tower-room-name">{loop.title}</span>
                          <span className="control-tower-room-project">{loop.source}</span>
                        </div>
                        <span className={`pill control-tower-pill-${openLoopTone(loop.status)}`}>{loop.status}</span>
                      </div>
                      <p>{loop.summary}</p>
                      <div className="control-tower-memory-list">
                        <span>next: {loop.next}</span>
                        <span>decision: {loop.decisionNeeded || "None"}</span>
                        <span>updated: {formatTimestamp(loop.updatedAt)}</span>
                      </div>
                      <div className="control-tower-partner-loop-actions">
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerOpenLoop(loop.id, "delegated", { note: "Redirected from Control Tower.", successMessage: `${loop.title} redirected.` })}>
                          Redirect
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerOpenLoop(loop.id, "paused", { note: "Paused from Control Tower.", successMessage: `${loop.title} paused.` })}>
                          Pause loop
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void handlePartnerOpenLoop(loop.id, "resolved", { note: "Resolved from Control Tower.", successMessage: `${loop.title} resolved.` })}>
                          Resolve
                        </button>
                      </div>
                    </article>
                  ))}
                  {!(partner?.openLoops ?? []).length ? <div className="staff-note staff-note-ok">No owner-facing open loops are active right now.</div> : null}
                </div>
              </article>

              <article className="control-tower-memory-card">
                <div className="control-tower-title-row">
                  <h3>Partner programs</h3>
                  <span className="pill control-tower-pill-neutral">{partner?.programs.length ?? 0} programs</span>
                </div>
                <div className="control-tower-memory-list">
                  {(partner?.programs ?? []).slice(0, 5).map((program) => (
                    <span key={program.id}>
                      <strong>{program.label}:</strong> {program.trigger}
                    </span>
                  ))}
                  {!(partner?.programs ?? []).length ? <span>Partner programs will appear once the latest brief is generated.</span> : null}
                </div>
              </article>
            </div>
          </section>
          ) : null}

          {showChipletGrid ? (
          <div className="control-tower-chiplet-grid">
            {approvals.length ? (
            <section ref={approvalsRef} className="card staff-console-card control-tower-section-card">
            <div className="control-tower-section-header">
              <div>
                <div className="control-tower-kicker">Approvals</div>
                <h2>Approval queue</h2>
                <p>Pending capability reviews stay visible here instead of hiding inside raw audit trails.</p>
              </div>
            </div>
            <div className="control-tower-pinned-list">
              {approvals.map((approval) => (
                <article key={approval.id} className="control-tower-pinned-card">
                  <h3>{approval.capabilityId}</h3>
                  <p>{approval.summary}</p>
                  <span>{approval.owner} · {approval.status} · {approval.risk}</span>
                  {(approval.expectedEffects ?? []).length ? (
                    <div className="control-tower-memory-list">
                      {approval.expectedEffects?.slice(0, 3).map((effect) => (
                        <span key={effect}>{effect}</span>
                      ))}
                    </div>
                  ) : null}
                  {approval.previewInput ? (
                    <details className="control-tower-inline-details">
                      <summary>Preview input</summary>
                      <pre>{JSON.stringify(approval.previewInput, null, 2)}</pre>
                    </details>
                  ) : null}
                  <div className="control-tower-partner-loop-actions">
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void handleApproveProposal(approval)}>
                      Approve
                    </button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => void handleRejectProposal(approval)}>
                      Reject
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
            ) : null}

          {goodNextMoves.length ? (
          <section className="card staff-console-card control-tower-section-card">
            <div className="control-tower-section-header">
              <div>
                <div className="control-tower-kicker">Next</div>
                <h2>Good Next Moves</h2>
              </div>
            </div>
            <div className="control-tower-next-list">
              {goodNextMoves.map((action) => (
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
          ) : null}

          {pinnedItems.length ? (
          <section className="card staff-console-card control-tower-section-card">
            <div className="control-tower-section-header">
              <div>
                <div className="control-tower-kicker">Escalated</div>
                <h2>Pinned blockers</h2>
              </div>
            </div>
            <div className="control-tower-pinned-list">
              {pinnedItems.map((item) => (
                <article key={item.id} className="control-tower-pinned-card">
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  <span>{item.actionHint}</span>
                </article>
              ))}
            </div>
          </section>
          ) : null}

          {recentChanges.length ? (
          <section className="card staff-console-card control-tower-section-card">
            <div className="control-tower-section-header">
              <div>
                <div className="control-tower-kicker">Changes</div>
                <h2>Recent changes</h2>
                <p>Structured event envelopes replace log-first scanning.</p>
              </div>
            </div>
            <div className="control-tower-timeline">
              {recentChanges.map((event) => (
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
            </div>
          </section>
          ) : null}
        </div>
          ) : null}

        {showChannelsSurface ? (
        <section className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Channels</div>
              <h2>Active Codex, Discord, and planning lanes</h2>
              <p>Channel summaries stay compact so the operator can understand live ownership without opening every room.</p>
            </div>
          </div>
          <div className="control-tower-channel-grid">
            {channels.map((channel) => (
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
          </div>
        </section>
        ) : null}

        {showServicesSurface ? (
        <section ref={servicesRef} id="control-tower-services" className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Services</div>
              <h2>Service oversight</h2>
              <p>Healthy, readable cards with bounded actions and confirmation where needed.</p>
            </div>
          </div>
          <div className="control-tower-service-grid">
            {services.map((service) => (
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
        ) : null}

        {showEventsSurface ? (
        <section ref={eventsRef} id="control-tower-events" className="card staff-console-card control-tower-section-card">
          <div className="control-tower-section-header">
            <div>
              <div className="control-tower-kicker">Events</div>
              <h2>Recent events and incidents</h2>
              <p>Curated operator timeline, not raw logs first.</p>
            </div>
          </div>
          <div className="control-tower-timeline">
            {timelineEvents.map((event) => (
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
        ) : null}
          </>
        )}
      </section>

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

      {selectedRunId && runDetail ? (
        <ControlTowerRunDrawer
          key={runDetail.runId}
          open
          detail={runDetail}
          busy={Boolean(busyKey)}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          onClose={closeRun}
          onRefresh={() => {
            void openRun(selectedRunId);
          }}
        />
      ) : null}
    </>
  );
}
