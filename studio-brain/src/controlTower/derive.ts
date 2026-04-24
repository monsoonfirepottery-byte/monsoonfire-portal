import type { AuditEvent, OverseerCoordinationAction } from "../stores/interfaces";
import type {
  ControlTowerActionTarget,
  ControlTowerApprovalItem,
  ControlTowerAttentionItem,
  ControlTowerBoardRow,
  ControlTowerChannelSummary,
  ControlTowerEvent,
  ControlTowerEventType,
  ControlTowerHealth,
  ControlTowerMemoryBrief,
  ControlTowerNextAction,
  ControlTowerRawRoom,
  ControlTowerRawService,
  ControlTowerRawState,
  ControlTowerRecentAudit,
  ControlTowerRoomDetail,
  ControlTowerRoomSummary,
  ControlTowerServiceCard,
  ControlTowerState,
} from "./types";
import { clipText } from "./collect";

const MAX_EVENTS = 48;
const MAX_ATTENTION = 6;
const MAX_NEXT_ACTIONS = 8;
const MAX_BOARD_ROWS = 8;
const MAX_CHANNELS = 8;

function parseIso(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesSince(value: unknown, nowMs = Date.now()): number | null {
  const parsed = parseIso(value);
  if (parsed === null) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 60_000));
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toolLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized === "codex") return "Codex";
  if (normalized === "claude") return "Claude";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function actionTargetForService(serviceId: string): ControlTowerActionTarget {
  return { type: "service", serviceId };
}

function actionTargetForRoom(roomId: string): ControlTowerActionTarget {
  return { type: "room", roomId };
}

function actionTargetForSession(sessionName: string): ControlTowerActionTarget {
  return { type: "session", sessionName };
}

function toSeverityFromHealth(health: ControlTowerHealth): "info" | "warning" | "critical" {
  if (health === "error") return "critical";
  if (health === "waiting") return "warning";
  return "info";
}

function normalizeChannel(value: string): ControlTowerChannelSummary["channel"] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("discord")) return "discord";
  if (normalized.includes("plan")) return "planning";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("service")) return "service";
  if (normalized.includes("ops") || normalized.includes("operator")) return "ops";
  return "unknown";
}

function classifyChannel(tool: string, ...hints: Array<string | null | undefined>): ControlTowerChannelSummary["channel"] {
  const bag = [tool, ...hints].map((entry) => String(entry || "").trim()).filter(Boolean).join(" ");
  return normalizeChannel(bag);
}

function eventTypeFromInput(input: {
  kind: ControlTowerEvent["kind"];
  sourceAction?: string | null;
  severity: ControlTowerEvent["severity"];
  roomId?: string | null;
  serviceId?: string | null;
}): ControlTowerEventType {
  const sourceAction = String(input.sourceAction || "").toLowerCase();
  if (sourceAction.includes("proposal") || sourceAction.includes("approval")) return "approval.requested";
  if (sourceAction.includes("memory")) return "memory.promoted";
  if (input.serviceId || input.kind === "service") return "health.changed";
  if (input.kind === "session") return "run.status";
  if (input.kind === "alert" || input.kind === "overseer" || input.severity === "critical") return "incident.raised";
  if (input.roomId || input.kind === "room" || input.kind === "ack" || input.kind === "operator") return "task.updated";
  return "task.updated";
}

function createEvent(input: {
  id: string;
  at: string;
  kind: ControlTowerEvent["kind"];
  severity: ControlTowerEvent["severity"];
  title: string;
  summary: string;
  actor: string;
  roomId?: string | null;
  serviceId?: string | null;
  actionLabel?: string | null;
  sourceAction?: string | null;
  runId?: string | null;
  agentId?: string | null;
  channel?: string | null;
  payload?: Record<string, unknown>;
}): ControlTowerEvent {
  const occurredAt = input.at;
  const channel = input.channel ? normalizeChannel(input.channel) : input.serviceId ? "service" : "ops";
  return {
    id: input.id,
    at: occurredAt,
    kind: input.kind,
    type: eventTypeFromInput(input),
    runId: input.runId ?? null,
    agentId: input.agentId ?? null,
    channel,
    occurredAt,
    severity: input.severity,
    title: input.title,
    summary: input.summary,
    actor: input.actor,
    roomId: input.roomId ?? null,
    serviceId: input.serviceId ?? null,
    actionLabel: input.actionLabel ?? null,
    sourceAction: input.sourceAction ?? null,
    payload: {
      roomId: input.roomId ?? null,
      serviceId: input.serviceId ?? null,
      sourceAction: input.sourceAction ?? null,
      ...(input.payload ?? {}),
    },
  };
}

function summarizeRoom(room: ControlTowerRawRoom): string {
  if (room.summary) return room.summary;
  if (!room.sessions.length) return "No active sessions in this room.";
  return `${room.sessions.length} lane${room.sessions.length === 1 ? "" : "s"} in ${room.label}.`;
}

function buildRoomNextActions(room: ControlTowerRawRoom, isEscalated: boolean, nowMs: number): ControlTowerNextAction[] {
  const primarySession = room.sessions[0];
  const roomAge = minutesSince(primarySession?.lastActivityAt, nowMs);
  const actions: ControlTowerNextAction[] = [];

  if (room.mood === "blocked") {
    actions.push({
      id: `room:${room.id}:inspect`,
      title: `Inspect ${room.label}`,
      why: "A lane in this room is blocked or reporting an error state.",
      ageMinutes: roomAge,
      actionLabel: "Inspect room",
      target: actionTargetForRoom(room.id),
    });
  }

  if (primarySession) {
    actions.push({
      id: `session:${primarySession.sessionName}:attach`,
      title: `Attach to ${primarySession.sessionName}`,
      why:
        room.mood === "active"
          ? "This lane is actively moving and is the fastest way to understand current work."
          : "Open the live lane if you need shell-level recovery or deeper context.",
      ageMinutes: roomAge,
      actionLabel: "Attach",
      target: actionTargetForSession(primarySession.sessionName),
    });
  }

  if (room.mood === "waiting" || room.mood === "quiet") {
    actions.push({
      id: `room:${room.id}:nudge`,
      title: `Send direction to ${room.label}`,
      why: room.mood === "waiting" ? "This room looks ready for an operator nudge." : "This room is quiet and may need a new objective.",
      ageMinutes: roomAge,
      actionLabel: "Send instruction",
      target: actionTargetForRoom(room.id),
    });
  }

  if (isEscalated) {
    actions.unshift({
      id: `room:${room.id}:escalated`,
      title: `Resolve escalation in ${room.label}`,
      why: "This room was pinned by an operator and should stay visible until resolved.",
      ageMinutes: roomAge,
      actionLabel: "Review escalation",
      target: actionTargetForRoom(room.id),
    });
  }

  return actions.slice(0, 3);
}

function toRoomSummary(room: ControlTowerRawRoom, escalatedRoomIds: Set<string>, nowMs: number): ControlTowerRoomSummary {
  const primarySession = room.sessions[0] ?? null;
  const newestActivity = room.sessions
    .map((entry) => parseIso(entry.lastActivityAt))
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left)[0];
  const lastActivityAt = newestActivity ? new Date(newestActivity).toISOString() : primarySession?.lastActivityAt ?? null;
  const ageMinutes = minutesSince(lastActivityAt, nowMs);
  const isEscalated = escalatedRoomIds.has(room.id);
  const status =
    room.mood === "blocked"
      ? "blocked"
      : room.mood === "quiet"
        ? "quiet"
        : primarySession?.status ?? "quiet";

  return {
    id: room.id,
    name: room.label,
    project: primarySession?.repo || room.repo || room.label,
    cwd: primarySession?.cwd || "",
    tool: toolLabel(primarySession?.tool || ""),
    status,
    objective: clipText(primarySession?.objective || primarySession?.summary || summarizeRoom(room), 180),
    lastActivityAt,
    ageMinutes,
    isEscalated,
    nextActions: buildRoomNextActions(room, isEscalated, nowMs),
    sessionNames: room.sessions.map((entry) => entry.sessionName),
    summary: summarizeRoom(room),
  };
}

function toServiceCard(service: ControlTowerRawService, events: ControlTowerEvent[]): ControlTowerServiceCard {
  const serviceEvents = events.filter((entry) => entry.serviceId === service.id).sort((left, right) => right.at.localeCompare(left.at));
  const latestEvent = serviceEvents[0] ?? null;
  const impact =
    service.status === "error"
      ? "Operator actions that depend on this service may fail until it recovers."
      : service.status === "waiting"
        ? "This service is installed but not fully ready."
        : "No immediate operator impact is reported.";

  return {
    id: service.id,
    label: service.label,
    health: service.status,
    impact,
    recentChanges: latestEvent?.summary || service.summary,
    changedAt: latestEvent?.at || service.changedAt,
    summary: service.summary,
    actions: service.allowedActions.map((verb) => ({
      id: `${service.id}:${verb}`,
      label: verb === "status" ? "Refresh status" : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} service`,
      verb,
      requiresConfirmation: verb !== "status",
    })),
  };
}

function toEventFromAck(entry: Record<string, unknown>, index: number): ControlTowerEvent | null {
  const at = coerceString(entry.recordedAt);
  if (!at) return null;
  const runId = coerceString(entry.runId) || "latest";
  const note = clipText(entry.note || "Overseer acknowledgement recorded.", 220);
  return createEvent({
    id: `ack:${runId}:${index}`,
    at,
    kind: "ack",
    severity: "info",
    title: "Overseer ack recorded",
    summary: note,
    actor: coerceString(entry.actor) || "operator",
    actionLabel: "View events",
    sourceAction: "control_tower.overseer_ack",
    runId,
    channel: "ops",
    payload: entry,
  });
}

function toEventFromAlert(state: ControlTowerRawState, index: number): ControlTowerEvent {
  const alert = state.alerts[index];
  return createEvent({
    id: `alert:${alert.id}`,
    at: state.generatedAt,
    kind: alert.serviceId ? "service" : "alert",
    severity: alert.level,
    title: alert.title,
    summary: alert.summary,
    actor: "studio-brain",
    roomId: alert.roomId ?? null,
    serviceId: alert.serviceId ?? null,
    actionLabel: alert.roomId ? "Inspect room" : alert.serviceId ? "Inspect service" : null,
    sourceAction: "control_tower.synthetic_alert",
    runId: state.ops.latestRunId || null,
    channel: alert.serviceId ? "service" : "ops",
    payload: alert,
  });
}

function eventKindFromAction(action: string): ControlTowerEvent["kind"] {
  if (action.includes("service")) return "service";
  if (action.includes("ack")) return "ack";
  if (action.includes("session") || action.includes("room")) return "room";
  return "operator";
}

function severityFromAudit(event: AuditEvent): ControlTowerEvent["severity"] {
  const action = String(event.action || "").toLowerCase();
  if (action.includes("restart") || action.includes("stop") || action.includes("blocked")) return "warning";
  return event.approvalState === "required" ? "warning" : "info";
}

function titleFromAudit(event: AuditEvent): string {
  const action = String(event.action || "");
  if (action === "studio_ops.control_tower.room_pinned") return "Room escalated";
  if (action === "studio_ops.control_tower.room_unpinned") return "Room de-escalated";
  if (action === "studio_ops.control_tower.session_spawned") return "Room session created";
  if (action === "studio_ops.control_tower.session_instruction_sent") return "Instruction sent";
  if (action === "studio_ops.control_tower.service_action") return "Service action run";
  if (action === "studio_ops.control_tower.overseer_ack") return "Overseer ack recorded";
  return clipText(action.replaceAll(".", " "), 72) || "Operator action";
}

function toEventFromAudit(event: AuditEvent): ControlTowerEvent {
  const metadata = event.metadata || {};
  return createEvent({
    id: `audit:${event.id}`,
    at: event.at,
    kind: eventKindFromAction(event.action),
    severity: severityFromAudit(event),
    title: titleFromAudit(event),
    summary: clipText(event.rationale || JSON.stringify(metadata), 220),
    actor: event.actorId,
    roomId: coerceString(metadata.roomId) || null,
    serviceId: coerceString(metadata.serviceId) || null,
    actionLabel:
      coerceString(metadata.roomId)
        ? "Inspect room"
        : coerceString(metadata.serviceId)
          ? "Inspect service"
          : null,
    sourceAction: event.action,
    runId: coerceString(metadata.runId) || null,
    agentId: event.actorId,
    channel: coerceString(metadata.channel) || coerceString(metadata.tool) || "ops",
    payload: metadata,
  });
}

function toEventFromOverseerAction(action: OverseerCoordinationAction, computedAt: string, index: number): ControlTowerEvent {
  return createEvent({
    id: `overseer:${action.id || index}`,
    at: computedAt,
    kind: "overseer",
    severity: action.priority === "p0" ? "critical" : action.priority === "p1" ? "warning" : "info",
    title: clipText(action.title || "Overseer recommendation", 96),
    summary: clipText(action.summary || action.rationale || "", 220),
    actor: "overseer",
    actionLabel: "Review recommendation",
    sourceAction: "control_tower.overseer_action",
    runId: action.proposal?.proposalId || null,
    channel: action.draft?.channel || action.ownerHint || "ops",
    payload: {
      ownerHint: action.ownerHint || null,
      proposalEligibility: action.proposalEligibility,
      proposal: action.proposal ?? null,
      draft: action.draft ?? null,
    },
  });
}

export function resolveEscalatedRoomIds(events: ControlTowerRecentAudit[]): Set<string> {
  const roomEvents = events
    .filter((event) => event.action === "studio_ops.control_tower.room_pinned" || event.action === "studio_ops.control_tower.room_unpinned")
    .sort((left, right) => left.at.localeCompare(right.at));
  const output = new Set<string>();
  for (const event of roomEvents) {
    const roomId = coerceString(event.metadata?.roomId);
    if (!roomId) continue;
    if (event.action === "studio_ops.control_tower.room_pinned") output.add(roomId);
    else output.delete(roomId);
  }
  return output;
}

export function buildControlTowerEvents(raw: ControlTowerRawState, audits: ControlTowerRecentAudit[]): ControlTowerEvent[] {
  const events: ControlTowerEvent[] = [];

  raw.ops.ackEntries.forEach((entry, index) => {
    const event = toEventFromAck(entry, index);
    if (event) events.push(event);
  });

  raw.alerts.forEach((_, index) => {
    events.push(toEventFromAlert(raw, index));
  });

  audits.forEach((event) => {
    events.push(toEventFromAudit(event));
  });

  const overseerActions = Array.isArray(raw.ops.overseer?.coordinationActions) ? raw.ops.overseer.coordinationActions : [];
  overseerActions.slice(0, 6).forEach((entry, index) => {
    events.push(toEventFromOverseerAction(entry, raw.ops.overseer?.computedAt || raw.generatedAt, index));
  });

  return events
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, MAX_EVENTS);
}

function buildNeedsAttention(
  raw: ControlTowerRawState,
  rooms: ControlTowerRoomSummary[],
  services: ControlTowerServiceCard[],
  events: ControlTowerEvent[],
): ControlTowerAttentionItem[] {
  const items: ControlTowerAttentionItem[] = [];

  for (const alert of raw.alerts) {
    items.push({
      id: `attention:${alert.id}`,
      title: alert.title,
      why: alert.summary,
      ageMinutes: minutesSince(raw.generatedAt),
      severity: alert.level,
      actionLabel: alert.roomId ? "Inspect room" : alert.serviceId ? "Inspect service" : "Review",
      target: alert.roomId ? actionTargetForRoom(alert.roomId) : alert.serviceId ? actionTargetForService(alert.serviceId) : { type: "ops", action: "refresh" },
    });
  }

  for (const room of rooms.filter((entry) => entry.status === "blocked" || entry.isEscalated)) {
    items.push({
      id: `attention:room:${room.id}`,
      title: room.isEscalated ? `${room.name} is escalated` : `${room.name} is blocked`,
      why: room.summary,
      ageMinutes: room.ageMinutes,
      severity: room.isEscalated ? "warning" : "critical",
      actionLabel: "Inspect room",
      target: actionTargetForRoom(room.id),
    });
  }

  for (const service of services.filter((entry) => entry.health !== "healthy")) {
    items.push({
      id: `attention:service:${service.id}`,
      title: `${service.label} needs attention`,
      why: service.summary,
      ageMinutes: minutesSince(service.changedAt ?? raw.generatedAt),
      severity: toSeverityFromHealth(service.health),
      actionLabel: "Inspect service",
      target: actionTargetForService(service.id),
    });
  }

  const recentCriticalEvents = events.filter((entry) => entry.severity === "critical").slice(0, 2);
  for (const event of recentCriticalEvents) {
    items.push({
      id: `attention:event:${event.id}`,
      title: event.title,
      why: event.summary,
      ageMinutes: minutesSince(event.at),
      severity: event.severity,
      actionLabel: event.actionLabel || "Review",
      target: event.roomId ? actionTargetForRoom(event.roomId) : event.serviceId ? actionTargetForService(event.serviceId) : { type: "ops", action: "events" },
    });
  }

  return items
    .sort((left, right) => {
      const severityWeight = { critical: 0, warning: 1, info: 2 };
      const bySeverity = severityWeight[left.severity] - severityWeight[right.severity];
      if (bySeverity !== 0) return bySeverity;
      return (left.ageMinutes ?? 9_999) - (right.ageMinutes ?? 9_999);
    })
    .slice(0, MAX_ATTENTION);
}

function buildOverseerNextActions(raw: ControlTowerRawState): ControlTowerNextAction[] {
  const actions = Array.isArray(raw.ops.overseer?.coordinationActions) ? raw.ops.overseer.coordinationActions : [];
  return actions.slice(0, 3).map((entry, index) => ({
    id: `overseer-next:${entry.id || index}`,
    title: clipText(entry.title || "Review overseer recommendation", 96),
    why: clipText(entry.rationale || entry.summary || "", 180),
    ageMinutes: minutesSince(raw.ops.overseer?.computedAt),
    actionLabel: "Review recommendation",
    target: { type: "ops", action: "overseer" },
  }));
}

function buildGoodNextMoves(raw: ControlTowerRawState, rooms: ControlTowerRoomSummary[]): ControlTowerNextAction[] {
  const actions: ControlTowerNextAction[] = [];

  raw.pinnedItems.forEach((item) => {
    const serviceMatch = raw.services.find((service) => item.title.toLowerCase().includes(service.label.toLowerCase()) || item.id === service.id);
    actions.push({
      id: `pinned:${item.id}`,
      title: item.title,
      why: item.actionHint || item.detail,
      ageMinutes: minutesSince(raw.generatedAt),
      actionLabel: serviceMatch ? "Inspect service" : "Review blocker",
      target: serviceMatch ? actionTargetForService(serviceMatch.id) : { type: "ops", action: "pinned" },
    });
  });

  rooms
    .filter((room) => room.status === "waiting" || room.status === "blocked")
    .slice(0, 4)
    .forEach((room) => {
      actions.push(...room.nextActions);
    });

  actions.push(...buildOverseerNextActions(raw));

  const deduped = new Map<string, ControlTowerNextAction>();
  for (const action of actions) {
    if (!deduped.has(action.id)) deduped.set(action.id, action);
  }
  return Array.from(deduped.values()).slice(0, MAX_NEXT_ACTIONS);
}

function buildMissionBoard(rows: ControlTowerRoomSummary[]): ControlTowerBoardRow[] {
  return rows
    .map((room) => ({
      id: `board:${room.id}`,
      owner: room.tool || room.name,
      task: clipText(room.objective || room.summary || room.name, 120),
      state: room.isEscalated ? `escalated:${room.status}` : room.status,
      blocker:
        room.status === "blocked"
          ? clipText(room.summary || "Blocked lane.", 140)
          : room.isEscalated
            ? "Operator escalation is still open."
            : "",
      next: clipText(room.nextActions[0]?.title || "Inspect room", 120),
      last_update: room.lastActivityAt,
      roomId: room.id,
      sessionName: room.sessionNames[0] ?? null,
    }))
    .sort((left, right) => {
      const leftState = left.state.startsWith("escalated") ? 0 : left.state === "blocked" ? 1 : left.state === "waiting" ? 2 : 3;
      const rightState =
        right.state.startsWith("escalated") ? 0 : right.state === "blocked" ? 1 : right.state === "waiting" ? 2 : 3;
      if (leftState !== rightState) return leftState - rightState;
      return (parseIso(right.last_update) ?? 0) - (parseIso(left.last_update) ?? 0);
    })
    .slice(0, MAX_BOARD_ROWS);
}

function buildMemoryMaintenanceRow(memoryBrief: ControlTowerMemoryBrief): ControlTowerBoardRow {
  const status = memoryBrief.consolidation.status || memoryBrief.consolidation.mode;
  return {
    id: "board:memory-maintenance",
    owner: "Memory maintenance",
    task: clipText(memoryBrief.consolidation.summary || "Dream-cycle maintenance is waiting for the next quiet window.", 120),
    state: status || "idle",
    blocker: memoryBrief.consolidation.lastError || memoryBrief.blockers[0] || "",
    next:
      memoryBrief.consolidation.mode === "repair" || memoryBrief.consolidation.status === "failed"
        ? "Repair continuity"
        : "Review dream-cycle outputs",
    last_update: memoryBrief.consolidation.lastRunAt || memoryBrief.generatedAt,
    roomId: null,
    sessionName: null,
  };
}

function buildChannelSummaries(raw: ControlTowerRawState): ControlTowerChannelSummary[] {
  return raw.agents
    .map((session) => ({
      id: `channel:${session.sessionName}`,
      label: session.room || session.sessionName,
      channel: classifyChannel(session.tool, session.room, session.objective, session.summary),
      owner: toolLabel(session.tool),
      state: session.status,
      objective: clipText(session.objective || session.summary || session.sessionName, 140),
      blocker: session.status === "error" ? clipText(session.summary || "Lane is blocked.", 120) : "",
      next:
        session.status === "error"
          ? "Recover lane"
          : session.status === "waiting" || session.status === "idle" || session.status === "parked"
            ? "Provide operator direction"
            : "Monitor progress",
      lastUpdate: session.lastActivityAt,
      roomId: session.room || null,
      sessionName: session.sessionName,
    }))
    .sort((left, right) => {
      const leftRank = left.state === "error" ? 0 : left.state === "waiting" ? 1 : left.state === "working" ? 2 : 3;
      const rightRank = right.state === "error" ? 0 : right.state === "waiting" ? 1 : right.state === "working" ? 2 : 3;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (parseIso(right.lastUpdate) ?? 0) - (parseIso(left.lastUpdate) ?? 0);
    })
    .slice(0, MAX_CHANNELS);
}

function buildFallbackMemoryBrief(
  raw: ControlTowerRawState,
  rooms: ControlTowerRoomSummary[],
  needsAttention: ControlTowerAttentionItem[],
  actions: ControlTowerNextAction[],
  events: ControlTowerEvent[],
): ControlTowerMemoryBrief {
  const goal = clipText(rooms[0]?.objective || "Rehydrate operator continuity and identify the next safe move.", 160);
  const blockers = needsAttention.slice(0, 3).map((item) => clipText(item.title, 120));
  const recentDecisions = events
    .filter((event) => event.kind === "operator" || event.kind === "ack" || event.kind === "service")
    .slice(0, 3)
    .map((event) => clipText(`${event.title}: ${event.summary}`, 140));
  const recommendedNextActions = actions.slice(0, 3).map((action) => clipText(action.title, 120));
  const summary = blockers.length
    ? `${goal} Primary blocker: ${blockers[0]}.`
    : `${goal} Startup continuity brief is waiting on the latest memory promotion.`;
  const focusAreas = [
    goal,
    ...blockers.slice(0, 2),
    ...recentDecisions.slice(0, 2),
  ]
    .filter(Boolean)
    .slice(0, 4);

  return {
    schema: "studio-brain.memory-brief.v1",
    generatedAt: raw.generatedAt,
    continuityState: "missing",
    summary,
    goal,
    blockers,
    recentDecisions,
    recommendedNextActions,
    fallbackSources: [raw.sources.operatorStatePath, raw.sources.overseerPath].filter(Boolean),
    sourcePath: null,
    layers: {
      coreBlocks: [goal, clipText(raw.ops.summary || "Control Tower continuity is pending.", 140)],
      workingMemory: actions.slice(0, 2).map((action) => clipText(action.why, 140)),
      episodicMemory: recentDecisions,
      canonicalMemory: ["accepted corpus artifacts", "promoted JSONL", "SQLite materialization"],
    },
    consolidation: {
      mode: "repair",
      status: "unavailable",
      summary: "Offline consolidation is queued behind the next successful continuity refresh so memory links can be rebuilt safely.",
      lastRunAt: null,
      nextRunAt: null,
      focusAreas,
      maintenanceActions: [
        "Rehydrate startup context before broad repo reads.",
        "Dedupe overlapping episodic memory rows once continuity is restored.",
        "Reconnect recent incidents and handoffs to canonical artifacts.",
      ],
      outputs: [
        "output/studio-brain/memory-brief/latest.json",
        "output/studio-brain/memory-consolidation/latest.json",
        "output/memory/<overnight-run>/overnight-status.json",
        "output/memory/<overnight-run>/overnight-events.jsonl",
      ],
      counts: {
        promotions: 0,
        archives: 0,
        quarantines: 0,
        repairedLinks: 0,
      },
      actionabilityStatus: "repair",
      actionableInsightCount: 0,
      suppressedConnectionNoteCount: 0,
      suppressedPseudoDecisionCount: 0,
      topActions: recommendedNextActions.slice(0, 3),
      lastError: null,
    },
  };
}

type DeriveControlTowerOptions = {
  approvals?: ControlTowerApprovalItem[];
  memoryBrief?: ControlTowerMemoryBrief | null;
};

export function deriveControlTowerState(
  raw: ControlTowerRawState,
  audits: ControlTowerRecentAudit[] = [],
  options: DeriveControlTowerOptions = {},
): ControlTowerState {
  const nowMs = Date.now();
  const escalatedRoomIds = resolveEscalatedRoomIds(audits);
  const rooms = raw.rooms.map((room) => toRoomSummary(room, escalatedRoomIds, nowMs));
  const events = buildControlTowerEvents(raw, audits);
  const services = raw.services.map((service) => toServiceCard(service, events));
  const actions = buildGoodNextMoves(raw, rooms);
  const needsAttention = buildNeedsAttention(raw, rooms, services, events);
  const channels = buildChannelSummaries(raw);
  const memoryBrief = options.memoryBrief ?? buildFallbackMemoryBrief(raw, rooms, needsAttention, actions, events);
  const board = [buildMemoryMaintenanceRow(memoryBrief), ...buildMissionBoard(rooms)].slice(0, MAX_BOARD_ROWS);
  const activeRooms = rooms
    .filter((room) => room.status !== "quiet" || room.isEscalated)
    .sort((left, right) => {
      const leftScore = left.status === "blocked" ? 0 : left.isEscalated ? 1 : left.status === "waiting" ? 2 : 3;
      const rightScore = right.status === "blocked" ? 0 : right.isEscalated ? 1 : right.status === "waiting" ? 2 : 3;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return (left.ageMinutes ?? 9_999) - (right.ageMinutes ?? 9_999);
    })
    .slice(0, 8);

  return {
    generatedAt: raw.generatedAt,
    theme: raw.theme,
    ops: raw.ops,
    alerts: raw.alerts,
    pinnedItems: raw.pinnedItems,
    services,
    rooms,
    board,
    channels,
    approvals: options.approvals ?? [],
    memoryBrief,
    startupScorecard: null,
    memoryHealth: null,
    agentRuntime: null,
    hosts: [],
    partner: null,
    events,
    recentChanges: events.slice(0, 6),
    actions,
    overview: {
      needsAttention,
      activeRooms,
      goodNextMoves: actions.slice(0, 6),
      recentEvents: events.slice(0, 8),
    },
    eventStream: {
      endpoint: "/api/control-tower/events",
      transport: "sse",
      heartbeatMs: 15_000,
    },
    controlPlanes: {
      mcp: "Profile-gated tool and data plane.",
      agentBus: "Redis Streams handoff/event plane.",
      operatorUi: "Control Tower snapshot plus SSE operator plane.",
    },
    counts: raw.counts,
    sources: raw.sources,
  };
}

export function deriveRoomDetail(
  raw: ControlTowerRawState,
  state: ControlTowerState,
  roomId: string,
  attach: ControlTowerRoomDetail["attach"],
): ControlTowerRoomDetail | null {
  const summary = state.rooms.find((entry) => entry.id === roomId);
  const room = raw.rooms.find((entry) => entry.id === roomId);
  if (!summary || !room) return null;
  return {
    ...summary,
    room,
    sessions: room.sessions,
    recentEvents: state.events.filter((entry) => entry.roomId === roomId).slice(0, 10),
    attach,
  };
}
