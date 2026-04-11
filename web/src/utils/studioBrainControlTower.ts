import type { User } from "firebase/auth";
import { resolveStudioBrainBaseUrlResolution } from "./studioBrain";

export type ControlTowerTheme = {
  name: "desert-night" | "paper-day";
  label: string;
  colorMode: "dark" | "light";
  motionLevel: "calm";
  highContrast: boolean;
  refreshMode: "diff-only";
};

export type ControlTowerHealth = "healthy" | "waiting" | "error" | "neutral";
export type ControlTowerSeverity = "info" | "warning" | "critical";
export type ControlTowerRoomStatus = "working" | "waiting" | "idle" | "parked" | "error" | "blocked" | "quiet";
export type ControlTowerEventType =
  | "run.status"
  | "task.updated"
  | "approval.requested"
  | "incident.raised"
  | "memory.promoted"
  | "channel.bound"
  | "health.changed";
export type ControlTowerContinuityState = "ready" | "continuity_degraded" | "missing";
export type ControlTowerMemoryConsolidationMode = "idle" | "scheduled" | "running" | "repair" | "unavailable";

export type ControlTowerActionTarget =
  | { type: "room"; roomId: string }
  | { type: "session"; sessionName: string }
  | { type: "service"; serviceId: string }
  | { type: "ops"; action: string };

export type ControlTowerNextAction = {
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  actionLabel: string;
  target: ControlTowerActionTarget;
};

export type ControlTowerEvent = {
  id: string;
  at: string;
  kind: "alert" | "service" | "room" | "overseer" | "operator" | "ack" | "session";
  type?: ControlTowerEventType;
  runId?: string | null;
  agentId?: string | null;
  channel?: string | null;
  occurredAt?: string;
  severity: ControlTowerSeverity;
  title: string;
  summary: string;
  actor: string;
  roomId: string | null;
  serviceId: string | null;
  actionLabel: string | null;
  sourceAction: string | null;
  payload?: Record<string, unknown>;
};

export type ControlTowerBoardRow = {
  id: string;
  owner: string;
  task: string;
  state: string;
  blocker: string;
  next: string;
  last_update: string | null;
  roomId: string | null;
  sessionName: string | null;
};

export type ControlTowerChannelSummary = {
  id: string;
  label: string;
  channel: "codex" | "discord" | "planning" | "ops" | "service" | "unknown";
  owner: string;
  state: string;
  objective: string;
  blocker: string;
  next: string;
  lastUpdate: string | null;
  roomId: string | null;
  sessionName: string | null;
};

export type ControlTowerApprovalItem = {
  id: string;
  capabilityId: string;
  summary: string;
  requestedBy: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "executed";
  createdAt: string;
  owner: string;
  approvalMode: "required" | "exempt";
  risk: "low" | "medium" | "high" | "critical";
  target: ControlTowerActionTarget;
};

export type ControlTowerMemoryConsolidation = {
  mode: ControlTowerMemoryConsolidationMode;
  status?: string | null;
  summary: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  focusAreas: string[];
  maintenanceActions: string[];
  outputs: string[];
  counts?: {
    promotions: number;
    archives: number;
    quarantines: number;
    repairedLinks: number;
  };
  mixQuality?: string | null;
  dominanceWarnings?: string[];
  secondPassQueriesUsed?: number | null;
  promotionCandidatesPending?: number | null;
  promotionCandidatesConfirmed?: number | null;
  stalledCandidateCount?: number | null;
  actionabilityStatus?: string | null;
  actionableInsightCount?: number | null;
  suppressedConnectionNoteCount?: number | null;
  suppressedPseudoDecisionCount?: number | null;
  topActions?: string[];
  lastError?: string | null;
};

export type ControlTowerMemoryBrief = {
  schema: "studio-brain.memory-brief.v1";
  generatedAt: string;
  continuityState: ControlTowerContinuityState;
  summary: string;
  goal: string;
  blockers: string[];
  recentDecisions: string[];
  recommendedNextActions: string[];
  fallbackSources: string[];
  sourcePath: string | null;
  layers: {
    coreBlocks: string[];
    workingMemory: string[];
    episodicMemory: string[];
    canonicalMemory: string[];
  };
  consolidation: ControlTowerMemoryConsolidation;
};

export type ControlTowerStartupScorecard = {
  schema: string;
  sourcePath: string | null;
  generatedAtIso: string;
  latest: {
    sample: {
      status: string;
      reasonCode: string;
      continuityState: string;
      latencyMs: number | null;
    };
  };
  metrics: {
    readyRate: number | null;
    groundingReadyRate: number | null;
    blockedContinuityRate: number | null;
    p95LatencyMs: number | null;
  };
  supportingSignals: {
    toolcalls: {
      startupEntries: number;
      startupFailures: number;
      startupFailureRate: number | null;
      groundingObservedEntries: number;
      groundingLineComplianceRate: number | null;
      preStartupRepoReadObservedEntries: number;
      averagePreStartupRepoReads: number | null;
      preStartupRepoReadFreeRate: number | null;
      telemetryCoverageRate: number | null;
      repeatFailureBursts: number;
    };
  };
  coverage: {
    gaps: string[];
  };
  rubric: {
    overallScore: number | null;
    grade: string;
  };
  recommendations: string[];
};

export type ControlTowerRoomSummary = {
  id: string;
  name: string;
  project: string;
  cwd: string;
  tool: string;
  status: ControlTowerRoomStatus;
  objective: string;
  lastActivityAt: string | null;
  ageMinutes: number | null;
  isEscalated: boolean;
  nextActions: ControlTowerNextAction[];
  sessionNames: string[];
  summary: string;
};

export type ControlTowerServiceCard = {
  id: string;
  label: string;
  health: ControlTowerHealth;
  impact: string;
  recentChanges: string;
  changedAt: string | null;
  summary: string;
  actions: Array<{
    id: string;
    label: string;
    verb: string;
    requiresConfirmation: boolean;
  }>;
};

export type ControlTowerAttentionItem = {
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: ControlTowerSeverity;
  actionLabel: string;
  target: ControlTowerActionTarget;
};

export type ControlTowerOverview = {
  needsAttention: ControlTowerAttentionItem[];
  activeRooms: ControlTowerRoomSummary[];
  goodNextMoves: ControlTowerNextAction[];
  recentEvents: ControlTowerEvent[];
};

export type ControlTowerState = {
  generatedAt: string;
  theme: ControlTowerTheme;
  ops: {
    overallStatus: ControlTowerHealth;
    heartbeatStatus: string;
    postureStatus: string;
    overseerStatus: string;
    summary: string;
    latestRunId: string;
  };
  alerts: Array<{
    id: string;
    level: ControlTowerSeverity;
    title: string;
    summary: string;
    roomId?: string | null;
    serviceId?: string | null;
  }>;
  pinnedItems: Array<{
    id: string;
    title: string;
    detail: string;
    status: "pinned";
    actionHint: string;
  }>;
  services: ControlTowerServiceCard[];
  rooms: ControlTowerRoomSummary[];
  board: ControlTowerBoardRow[];
  channels: ControlTowerChannelSummary[];
  approvals: ControlTowerApprovalItem[];
  memoryBrief: ControlTowerMemoryBrief;
  startupScorecard: ControlTowerStartupScorecard | null;
  events: ControlTowerEvent[];
  recentChanges: ControlTowerEvent[];
  actions: ControlTowerNextAction[];
  overview: ControlTowerOverview;
  eventStream: {
    endpoint: string;
    transport: "sse";
    heartbeatMs: number;
  };
  controlPlanes: {
    mcp: string;
    agentBus: string;
    operatorUi: string;
  };
  counts: {
    needsAttention: number;
    working: number;
    waiting: number;
    blocked: number;
    escalated: number;
  };
  sources: {
    operatorStatePath: string;
    heartbeatPath: string;
    overseerPath: string;
    ackLogPath: string;
  };
};

export type ControlTowerRoomDetail = ControlTowerRoomSummary & {
  room: {
    id: string;
    label: string;
    repo: string;
    mood: "active" | "waiting" | "blocked" | "quiet";
    summary: string;
    sessions: Array<{
      sessionName: string;
      rootSession: boolean;
      attached: boolean;
      lastActivityAt: string | null;
      paneCount: number;
      windowCount: number;
      cwd: string;
      repo: string;
      tool: string;
      room: string;
      status: "working" | "waiting" | "idle" | "parked" | "error";
      statusLabel: string;
      objective: string;
      summary: string;
      panes: Array<{
        windowName: string;
        currentCommand: string;
        cwd: string;
        paneActive: boolean;
      }>;
    }>;
  };
  sessions: Array<{
    sessionName: string;
    rootSession: boolean;
    attached: boolean;
    lastActivityAt: string | null;
    paneCount: number;
    windowCount: number;
    cwd: string;
    repo: string;
    tool: string;
    room: string;
    status: "working" | "waiting" | "idle" | "parked" | "error";
    statusLabel: string;
    objective: string;
    summary: string;
    panes: Array<{
      windowName: string;
      currentCommand: string;
      cwd: string;
      paneActive: boolean;
    }>;
  }>;
  recentEvents: ControlTowerEvent[];
  attach: {
    sessionName: string;
    sshCommand: string;
    remoteCommand: string;
  } | null;
};

type FetchOptions = {
  user: User;
  adminToken: string;
};

type JsonEnvelope = {
  ok?: boolean;
  message?: string;
};

type ControlTowerStreamOptions = FetchOptions & {
  onEvent: (event: ControlTowerEvent) => void;
  onOpen?: () => void;
  onError?: (error: Error) => void;
};

async function fetchControlTowerJson<T>(
  path: string,
  { user, adminToken }: FetchOptions,
  init?: RequestInit,
): Promise<T> {
  const resolution = resolveStudioBrainBaseUrlResolution();
  if (!resolution.baseUrl) {
    throw new Error(resolution.reason || "Studio Brain is not configured for this browser host.");
  }
  const idToken = await user.getIdToken();
  const headers = new Headers(init?.headers ?? undefined);
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${idToken}`);
  if (adminToken.trim()) {
    headers.set("x-studio-brain-admin-token", adminToken.trim());
  }
  const response = await fetch(`${resolution.baseUrl}${path}`, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as T & JsonEnvelope;
  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status})`);
  }
  return payload;
}

export function getStudioBrainControlTowerResolution() {
  return resolveStudioBrainBaseUrlResolution();
}

export async function fetchControlTowerState(options: FetchOptions): Promise<ControlTowerState> {
  const payload = await fetchControlTowerJson<{ state: ControlTowerState }>("/api/control-tower/state", options, {
    method: "GET",
  });
  return payload.state;
}

function parseSseBuffer(
  buffer: string,
  onEvent: (event: ControlTowerEvent) => void,
): string {
  const chunks = buffer.split("\n\n");
  const remainder = chunks.pop() ?? "";

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    if (!dataLines.length) continue;
    try {
      onEvent(JSON.parse(dataLines.join("\n")) as ControlTowerEvent);
    } catch {
      continue;
    }
  }

  return remainder;
}

export function subscribeControlTowerEvents(options: ControlTowerStreamOptions): () => void {
  const controller = new AbortController();
  let cancelled = false;
  let reconnectTimer: number | null = null;

  const connect = async () => {
    try {
      const resolution = resolveStudioBrainBaseUrlResolution();
      if (!resolution.baseUrl) {
        throw new Error(resolution.reason || "Studio Brain is not configured for this browser host.");
      }
      const idToken = await options.user.getIdToken();
      const headers = new Headers({
        accept: "text/event-stream",
        authorization: `Bearer ${idToken}`,
      });
      if (options.adminToken.trim()) {
        headers.set("x-studio-brain-admin-token", options.adminToken.trim());
      }
      const response = await fetch(`${resolution.baseUrl}/api/control-tower/events?stream=1`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Control Tower stream failed (${response.status})`);
      }
      options.onOpen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!cancelled) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        buffer = parseSseBuffer(buffer, options.onEvent);
      }
    } catch (error) {
      if (cancelled || controller.signal.aborted) return;
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    if (!cancelled) {
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, 2_500);
    }
  };

  void connect();

  return () => {
    cancelled = true;
    controller.abort();
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
  };
}

export async function fetchControlTowerRoom(roomId: string, options: FetchOptions): Promise<ControlTowerRoomDetail> {
  const payload = await fetchControlTowerJson<{ room: ControlTowerRoomDetail }>(
    `/api/control-tower/rooms/${encodeURIComponent(roomId)}`,
    options,
    { method: "GET" },
  );
  return payload.room;
}

export async function fetchControlTowerAttachCommand(
  roomId: string,
  options: FetchOptions,
): Promise<{ sessionName: string; sshCommand: string; remoteCommand: string }> {
  return fetchControlTowerJson(`/api/control-tower/rooms/${encodeURIComponent(roomId)}/attach-command`, options, {
    method: "GET",
  });
}

export async function sendControlTowerInstruction(
  roomId: string,
  text: string,
  options: FetchOptions,
): Promise<{ ok: boolean; sessionName?: string }> {
  return fetchControlTowerJson(`/api/control-tower/rooms/${encodeURIComponent(roomId)}/send`, options, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function setControlTowerRoomPinned(
  roomId: string,
  pinned: boolean,
  rationale: string,
  options: FetchOptions,
): Promise<{ ok: boolean; roomId: string; operation: "pin" | "unpin" }> {
  return fetchControlTowerJson(`/api/control-tower/rooms/${encodeURIComponent(roomId)}/${pinned ? "pin" : "unpin"}`, options, {
    method: "POST",
    body: JSON.stringify({ rationale }),
  });
}

export async function runControlTowerServiceAction(
  serviceId: string,
  action: string,
  options: FetchOptions,
): Promise<{ ok: boolean; message?: string }> {
  return fetchControlTowerJson(`/api/control-tower/services/${encodeURIComponent(serviceId)}/actions`, options, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function ackControlTowerOverseer(note: string, options: FetchOptions): Promise<{ ok: boolean; runId?: string }> {
  return fetchControlTowerJson("/api/control-tower/overseer/ack", options, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function spawnControlTowerRoom(
  payload: {
    name: string;
    cwd?: string;
    command?: string;
    tool?: string;
    group?: string;
    room?: string;
    summary?: string;
    objective?: string;
  },
  options: FetchOptions,
): Promise<{ ok: boolean; sessionName?: string; message?: string }> {
  return fetchControlTowerJson("/api/control-tower/rooms", options, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
