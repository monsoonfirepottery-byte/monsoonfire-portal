import type { Logger } from "../config/logger";
import { buildKilnOverview } from "../kiln/services/overview";
import type { KilnStore } from "../kiln/store";
import type { EventStore, StateStore, StudioStateSnapshot } from "../stores/interfaces";
import type { SupportOpsStore } from "../supportOps/store";
import type { SupportCaseSnapshot, SupportQueueSummary } from "../supportOps/types";
import type { ActorType } from "../types/core";
import {
  allowedModesForSurface,
  allowedSurfacesForCapabilities,
  canAccessOpsSurface,
  deriveOpsCapabilities,
  hasOpsCapability,
  clampConfidence,
  makeId,
  nowIso,
  stableOpsHash,
  type ActionEffectReceipt,
  type ApprovalItem,
  type CreateMemberRecord,
  type GrowthExperiment,
  type HumanTaskRecord,
  type ImprovementCase,
  type MemberActivityRecord,
  type MemberOpsRecord,
  type MembershipChangeRecord,
  type OpsCaseNote,
  type OpsCaseRecord,
  type OpsCapability,
  type OpsDegradeMode,
  type OpsEvidenceSummary,
  type OpsEventRecord,
  type OpsHealth,
  type OpsHumanRole,
  type OpsIngestReceipt,
  type OpsLendingSnapshot,
  type OpsMemberAuditRecord,
  type OpsPortalRole,
  type OpsPortalSnapshot,
  type OpsPriority,
  type OpsReportRecord,
  type OpsSessionMe,
  type OpsSourceFreshness,
  type OpsSourceRef,
  type OpsTwinState,
  type OpsTwinZone,
  type OpsWatchdog,
  type OpsWorldEvent,
  type OverrideReceipt,
  type ProofMode,
  type ReservationBundle,
  type RoleChangeRecord,
  type StationDisplayState,
  type StationSession,
  type TaskEscapeRecord,
  type TaskEscapeHatch,
  type TaskProofRecord,
  type VerificationClass,
} from "./contracts";
import { MemoryOpsStore, type OpsStore } from "./store";
import { createOpsStaffDataSource, type OpsStaffDataSource } from "./staffData";

type KilnOverviewSnapshot = Awaited<ReturnType<typeof buildKilnOverview>>;
type AuditEventRecord = Awaited<ReturnType<EventStore["listRecent"]>>[number];

export type AppendWorldEventInput = {
  eventType: string;
  entityKind: string;
  entityId: string;
  sourceSystem: string;
  sourceEventId: string;
  actorKind: string;
  actorId: string;
  payload: Record<string, unknown>;
  caseId?: string | null;
  roomId?: string | null;
  confidence?: number;
  verificationClass?: VerificationClass;
  artifactRefs?: string[];
  authPrincipal: string;
  timestampSkewSeconds: number;
};

export type AddCaseNoteInput = {
  caseId: string;
  actorId: string;
  actorKind?: ActorType | string;
  body: string;
  metadata?: Record<string, unknown>;
};

export type ResolveApprovalInput = {
  approvalId: string;
  status: "approved" | "rejected";
  actorId: string;
  note?: string | null;
};

export type AcceptTaskProofInput = {
  taskId: string;
  proofId: string;
  actorId: string;
  status: "accepted" | "rejected" | "readback_pending";
  note?: string | null;
};

export type EscapeTaskInput = {
  taskId: string;
  actorId: string;
  escapeHatch: TaskEscapeHatch;
  reason?: string | null;
};

export type OverrideRequestInput = {
  actorId: string;
  scope: string;
  reason: string;
  expiresAt?: string | null;
  requiredRole?: OpsHumanRole | string;
  metadata?: Record<string, unknown>;
};

export type OpsActorContext = {
  actorId: string;
  isStaff: boolean;
  portalRole: OpsPortalRole;
  opsRoles: OpsHumanRole[];
  opsCapabilities: OpsCapability[];
};

export type CaseDetail = {
  record: OpsCaseRecord | null;
  notes: OpsCaseNote[];
  tasks: HumanTaskRecord[];
  approvals: ApprovalItem[];
};

export type OpsChatResponse = {
  reply: string;
  note: OpsCaseNote;
  caseId: string;
};

export type HumanTaskSeedInput = {
  id?: string;
  caseId?: string | null;
  title: string;
  status?: HumanTaskRecord["status"];
  priority?: OpsPriority;
  surface: HumanTaskRecord["surface"];
  role: string;
  zone: string;
  dueAt?: string | null;
  etaMinutes?: number | null;
  toolsNeeded?: string[];
  interruptibility?: HumanTaskRecord["interruptibility"];
  whyNow: string;
  whyYou: string;
  evidenceSummary: string;
  consequenceIfDelayed: string;
  instructions: string[];
  checklist?: HumanTaskRecord["checklist"];
  doneDefinition?: string;
  proofModes?: ProofMode[];
  preferredProofMode?: ProofMode;
  fallbackIfSignalMissing?: string;
  verificationClass?: VerificationClass;
  freshestAt?: string | null;
  sources?: OpsSourceRef[];
  confidence?: number;
  degradeReason?: string | null;
  blockerReason?: string | null;
  blockerEscapeHatches?: TaskEscapeHatch[];
  metadata?: Record<string, unknown>;
};

export type OpsServiceOptions = {
  store?: OpsStore;
  logger?: Logger | null;
  kilnStore?: KilnStore | null;
  supportOpsStore?: SupportOpsStore | null;
  stateStore?: StateStore | null;
  eventStore?: EventStore | null;
  staffDataSource?: OpsStaffDataSource | null;
  now?: () => string;
};

type DependencySnapshot = {
  generatedAt: string;
  kilnOverview: KilnOverviewSnapshot | null;
  supportQueue: SupportQueueSummary | null;
  supportCases: SupportCaseSnapshot[];
  studioState: StudioStateSnapshot | null;
  latestAuditEvent: AuditEventRecord | null;
  reservations: ReservationBundle[];
  events: OpsEventRecord[];
  reports: OpsReportRecord[];
  lending: OpsLendingSnapshot | null;
};

type DerivedState = {
  twin: OpsTwinState;
  truth: OpsPortalSnapshot["truth"];
  tasks: HumanTaskRecord[];
  cases: OpsCaseRecord[];
  approvals: ApprovalItem[];
  conversations: OpsPortalSnapshot["conversations"];
  ceo: GrowthExperiment[];
  forge: ImprovementCase[];
  reservations: ReservationBundle[];
  events: OpsEventRecord[];
  reports: OpsReportRecord[];
  lending: OpsLendingSnapshot | null;
  taskEscapes: TaskEscapeRecord[];
  overrides: OverrideReceipt[];
  dependencies: DependencySnapshot;
};

const ACTIVE_TASK_ORDER: HumanTaskRecord["status"][] = [
  "reopened",
  "blocked",
  "in_progress",
  "proof_pending",
  "claimed",
  "queued",
  "proposed",
  "verified",
  "canceled",
];
const ACTIVE_CASE_ORDER: OpsCaseRecord["status"][] = [
  "blocked",
  "awaiting_approval",
  "active",
  "open",
  "resolved",
  "canceled",
];
const APPROVAL_ORDER: ApprovalItem["status"][] = ["pending", "approved", "rejected", "executed", "expired"];
const DEFAULT_ESCAPE_HATCHES: TaskEscapeHatch[] = [
  "need_help",
  "unsafe",
  "missing_tool",
  "not_my_role",
  "already_done",
  "defer_with_reason",
];
const MANAGED_BY = "ops-service";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableString(value: unknown): string | null {
  const normalized = cleanString(value);
  return normalized.length ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function toStringArray(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, limit);
}

function earliest(lhs: string | null, rhs: string | null): string | null {
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  return lhs.localeCompare(rhs) <= 0 ? lhs : rhs;
}

function latest(lhs: string | null, rhs: string | null): string | null {
  if (!lhs) return rhs;
  if (!rhs) return lhs;
  return lhs.localeCompare(rhs) >= 0 ? lhs : rhs;
}

function freshnessMsFrom(timestamp: string | null, currentIso: string): number | null {
  if (!timestamp) return null;
  const then = Date.parse(timestamp);
  const now = Date.parse(currentIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, now - then);
}

function hoursFrom(timestamp: string | null, currentIso: string): number | null {
  const freshnessMs = freshnessMsFrom(timestamp, currentIso);
  if (freshnessMs === null) return null;
  return freshnessMs / 3_600_000;
}

function minutesUntil(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const then = Date.parse(timestamp);
  const now = Date.now();
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.round((then - now) / 60_000);
}

function durationMinutesBetween(timestamp: string | null, currentIso: string): number | null {
  if (!timestamp) return null;
  const then = Date.parse(timestamp);
  const now = Date.parse(currentIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.round((then - now) / 60_000);
}

function statusWeight<T extends string>(order: readonly T[], value: T): number {
  const index = order.indexOf(value);
  return index >= 0 ? index : order.length + 10;
}

function priorityWeight(value: OpsPriority): number {
  switch (value) {
    case "p0":
      return 0;
    case "p1":
      return 1;
    case "p2":
      return 2;
    case "p3":
      return 3;
  }
}

function healthWeight(value: OpsHealth): number {
  switch (value) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "healthy":
      return 2;
  }
}

function managedMetadata(metadata: Record<string, unknown> | undefined, signalOpen = true): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    managedBy: MANAGED_BY,
    sourceOpen: signalOpen,
  };
}

function isManagedByOps(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.managedBy === MANAGED_BY;
}

function buildSourceRef(
  system: string,
  label: string,
  observedAt: string | null,
  currentIso: string,
  extra: Partial<OpsSourceRef> = {},
): OpsSourceRef {
  return {
    id: cleanString(extra.id) || `${system}:${label.toLowerCase().replace(/\s+/g, "-")}`,
    system,
    label,
    kind: extra.kind ?? null,
    href: extra.href ?? null,
    observedAt,
    freshnessMs: freshnessMsFrom(observedAt, currentIso),
  };
}

function buildEvidenceSummary(
  summary: string,
  verificationClass: VerificationClass,
  sources: OpsSourceRef[],
  confidence: number,
  degradeReason: string | null,
): OpsEvidenceSummary {
  return {
    summary,
    sources,
    freshestAt: sources.reduce<string | null>((best, row) => latest(best, row.observedAt), null),
    confidence: clampConfidence(confidence, 0.5),
    degradeReason,
    verificationClass,
  };
}

function sortTasks(rows: HumanTaskRecord[]): HumanTaskRecord[] {
  return [...rows].sort((left, right) => {
    const status = statusWeight(ACTIVE_TASK_ORDER, left.status) - statusWeight(ACTIVE_TASK_ORDER, right.status);
    if (status !== 0) return status;
    const priority = priorityWeight(left.priority) - priorityWeight(right.priority);
    if (priority !== 0) return priority;
    const due = String(left.dueAt ?? "9999").localeCompare(String(right.dueAt ?? "9999"));
    if (due !== 0) return due;
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function sortCases(rows: OpsCaseRecord[]): OpsCaseRecord[] {
  return [...rows].sort((left, right) => {
    const status = statusWeight(ACTIVE_CASE_ORDER, left.status) - statusWeight(ACTIVE_CASE_ORDER, right.status);
    if (status !== 0) return status;
    const priority = priorityWeight(left.priority) - priorityWeight(right.priority);
    if (priority !== 0) return priority;
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function sortApprovals(rows: ApprovalItem[]): ApprovalItem[] {
  return [...rows].sort((left, right) => {
    const status = statusWeight(APPROVAL_ORDER, left.status) - statusWeight(APPROVAL_ORDER, right.status);
    if (status !== 0) return status;
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function sourceHealth(freshnessSeconds: number | null, budgetSeconds: number): OpsHealth {
  if (freshnessSeconds === null) return "critical";
  if (freshnessSeconds <= budgetSeconds) return "healthy";
  if (freshnessSeconds <= budgetSeconds * 3) return "warning";
  return "critical";
}

function sourceFreshnessRow(
  currentIso: string,
  source: string,
  label: string,
  observedAt: string | null,
  budgetSeconds: number,
  reason: string | null,
  options?: { missingStatus?: OpsHealth },
): OpsSourceFreshness {
  const freshnessMs = freshnessMsFrom(observedAt, currentIso);
  const freshnessSeconds = freshnessMs === null ? null : Math.round(freshnessMs / 1000);
  return {
    source,
    label,
    freshnessSeconds,
    budgetSeconds,
    status: freshnessSeconds === null ? options?.missingStatus ?? "critical" : sourceHealth(freshnessSeconds, budgetSeconds),
    freshestAt: observedAt,
    reason,
  };
}

function isTerminalReservationStatus(status: string): boolean {
  return [
    "canceled",
    "cancelled",
    "completed",
    "complete",
    "fulfilled",
    "resolved",
    "closed",
    "archived",
    "picked_up",
    "picked-up",
    "done",
  ].includes(status);
}

function isOperationalReservationBundle(bundle: ReservationBundle, currentIso: string): boolean {
  const status = cleanString(bundle.status).toLowerCase();
  if (isTerminalReservationStatus(status)) return false;
  const arrivalStatus = cleanString(bundle.arrival.status).toLowerCase();
  if (isTerminalReservationStatus(arrivalStatus)) return false;

  const dueDeltaMinutes = durationMinutesBetween(bundle.dueAt, currentIso);
  const dueWindowActive = dueDeltaMinutes !== null && dueDeltaMinutes >= -24 * 60 && dueDeltaMinutes <= 7 * 24 * 60;
  const freshestHours = hoursFrom(bundle.freshestAt ?? bundle.arrival.arrivedAt ?? bundle.dueAt, currentIso);
  const recentlyTouched = freshestHours !== null && freshestHours <= 96;
  const arrivedRecently = arrivalStatus === "arrived" && freshestHours !== null && freshestHours <= 24;

  if (bundle.dueAt) {
    return dueWindowActive || arrivedRecently;
  }
  return recentlyTouched || arrivedRecently;
}

function isTerminalEventStatus(status: string): boolean {
  return [
    "canceled",
    "cancelled",
    "completed",
    "complete",
    "closed",
    "archived",
    "resolved",
    "ended",
    "past",
  ].includes(status);
}

function isOperationalEventRecord(record: OpsEventRecord, currentIso: string): boolean {
  const status = cleanString(record.status).toLowerCase();
  if (isTerminalEventStatus(status)) return false;
  const anchor = record.startAt ?? record.lastStatusChangedAt;
  const eventDeltaMinutes = durationMinutesBetween(anchor, currentIso);
  if (eventDeltaMinutes !== null) {
    return eventDeltaMinutes >= -24 * 60 && eventDeltaMinutes <= 30 * 24 * 60;
  }
  return [
    "scheduled",
    "published",
    "review_required",
    "live",
    "open",
    "draft",
  ].includes(status);
}

function isTerminalReportStatus(status: string): boolean {
  return [
    "resolved",
    "closed",
    "dismissed",
    "archived",
    "complete",
    "completed",
  ].includes(status);
}

function isOperationalReportRecord(record: OpsReportRecord, currentIso: string): boolean {
  const status = cleanString(record.status).toLowerCase();
  if (isTerminalReportStatus(status)) return false;
  const ageHours = hoursFrom(record.createdAt, currentIso);
  if (["open", "new", "active", "investigating", "triage", "pending"].includes(status)) {
    return true;
  }
  return ageHours !== null && ageHours <= 24 * 7;
}

function deriveReadiness(modes: OpsDegradeMode[], sourceRows: OpsSourceFreshness[]): OpsPortalSnapshot["truth"]["readiness"] {
  const worstSource = sourceRows.reduce<OpsHealth>((worst: OpsHealth, row: OpsSourceFreshness) => {
    return healthWeight(row.status) < healthWeight(worst) ? row.status : worst;
  }, "healthy");
  if (modes.includes("observe_only") || modes.includes("no_human_tasking") || worstSource === "critical") {
    return "blocked";
  }
  if (modes.length > 0 || worstSource === "warning") {
    return "degraded";
  }
  return "ready";
}

function deriveZoneStatus(
  base: OpsHealth,
  evidence: OpsEvidenceSummary,
  degradeModes: OpsDegradeMode[],
  extraCritical = false,
): OpsHealth {
  if (extraCritical || degradeModes.includes("observe_only")) return "critical";
  if (base === "critical") return "critical";
  if (base === "warning" || evidence.degradeReason) return "warning";
  return "healthy";
}

function defaultTaskProofModes(input: HumanTaskSeedInput): ProofMode[] {
  const proofModes: ProofMode[] = input.proofModes && input.proofModes.length ? [...input.proofModes] : ["manual_confirm"];
  return [...new Set<ProofMode>(proofModes)];
}

export function createHumanTaskSeed(input: HumanTaskSeedInput): HumanTaskRecord {
  const createdAt = nowIso();
  const proofModes = defaultTaskProofModes(input);
  return {
    id: input.id ?? makeId("ops_task"),
    caseId: input.caseId ?? null,
    title: cleanString(input.title) || "Untitled task",
    status: input.status ?? "queued",
    priority: input.priority ?? "p2",
    surface: input.surface,
    role: cleanString(input.role) || "staff",
    zone: cleanString(input.zone) || "Studio",
    dueAt: input.dueAt ?? null,
    etaMinutes: input.etaMinutes ?? null,
    toolsNeeded: toStringArray(input.toolsNeeded, 12),
    interruptibility: input.interruptibility ?? "soon",
    whyNow: cleanString(input.whyNow) || "The studio needs this next.",
    whyYou: cleanString(input.whyYou) || "This role is the best current fit.",
    evidenceSummary: cleanString(input.evidenceSummary) || "Evidence will appear here as signals arrive.",
    consequenceIfDelayed: cleanString(input.consequenceIfDelayed) || "Delay increases operational surprise.",
    instructions: toStringArray(input.instructions, 12),
    checklist: input.checklist ?? [],
    doneDefinition: cleanString(input.doneDefinition) || "Complete the task and verify the result.",
    proofModes,
    preferredProofMode: input.preferredProofMode ?? proofModes[0] ?? "manual_confirm",
    fallbackIfSignalMissing: cleanString(input.fallbackIfSignalMissing) || "Attach a manual note and ask the manager to reconcile the signal path.",
    verificationClass: input.verificationClass ?? "observed",
    freshestAt: input.freshestAt ?? null,
    sources: input.sources ?? [],
    confidence: clampConfidence(input.confidence, 0.7),
    degradeReason: input.degradeReason ?? null,
    claimedBy: null,
    claimedAt: null,
    completedAt: null,
    blockerReason: input.blockerReason ?? null,
    blockerEscapeHatches: input.blockerEscapeHatches ?? DEFAULT_ESCAPE_HATCHES,
    createdAt,
    updatedAt: createdAt,
    metadata: input.metadata ?? {},
  };
}

function mergeTask(existing: HumanTaskRecord | null, seed: HumanTaskRecord, currentIso: string): HumanTaskRecord {
  if (!existing) return seed;
  const shouldReopen = (existing.status === "verified" || existing.status === "canceled") && seed.metadata.sourceOpen === true;
  return {
    ...seed,
    status: shouldReopen ? "reopened" : existing.status,
    claimedBy: shouldReopen ? existing.claimedBy : existing.claimedBy,
    claimedAt: shouldReopen ? existing.claimedAt : existing.claimedAt,
    completedAt: shouldReopen ? null : existing.completedAt,
    blockerReason: existing.blockerReason ?? seed.blockerReason,
    createdAt: existing.createdAt,
    updatedAt: shouldReopen ? currentIso : currentIso,
    metadata: {
      ...seed.metadata,
      reopenedFrom: shouldReopen ? existing.status : undefined,
      previousStatus: existing.status,
    },
  };
}

function mergeCase(existing: OpsCaseRecord | null, seed: OpsCaseRecord, currentIso: string): OpsCaseRecord {
  if (!existing) return seed;
  const terminal = existing.status === "resolved" || existing.status === "canceled";
  return {
    ...seed,
    status: terminal && seed.metadata.sourceOpen === true ? "active" : existing.status,
    createdAt: existing.createdAt,
    updatedAt: currentIso,
    metadata: {
      ...seed.metadata,
      previousStatus: existing.status,
    },
  };
}

function mergeApproval(existing: ApprovalItem | null, seed: ApprovalItem, currentIso: string): ApprovalItem {
  if (!existing) return seed;
  return {
    ...seed,
    status: existing.status === "expired" || existing.status === "executed" ? existing.status : existing.status,
    createdAt: existing.createdAt,
    resolvedAt: existing.resolvedAt,
    resolvedBy: existing.resolvedBy,
    updatedAt: currentIso,
    metadata: {
      ...seed.metadata,
      previousStatus: existing.status,
    },
  };
}

async function safeKilnOverview(logger: Logger | null, kilnStore: KilnStore | null | undefined): Promise<KilnOverviewSnapshot | null> {
  if (!kilnStore) return null;
  try {
    return await buildKilnOverview(kilnStore, { enableSupportedWrites: false });
  } catch (error) {
    logger?.warn("ops-service: failed to load kiln overview", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function safeSupportQueue(logger: Logger | null, supportOpsStore: SupportOpsStore | null | undefined): Promise<{
  queue: SupportQueueSummary | null;
  cases: SupportCaseSnapshot[];
}> {
  if (!supportOpsStore) return { queue: null, cases: [] };
  try {
    const [queue, cases] = await Promise.all([
      supportOpsStore.getQueueSummary(),
      supportOpsStore.listRecentCases(12),
    ]);
    return { queue, cases };
  } catch (error) {
    logger?.warn("ops-service: failed to load support state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { queue: null, cases: [] };
  }
}

async function safeStudioState(logger: Logger | null, stateStore: StateStore | null | undefined): Promise<StudioStateSnapshot | null> {
  if (!stateStore) return null;
  try {
    return await stateStore.getLatestStudioState();
  } catch (error) {
    logger?.warn("ops-service: failed to load studio state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function safeLatestAuditEvent(logger: Logger | null, eventStore: EventStore | null | undefined): Promise<AuditEventRecord | null> {
  if (!eventStore) return null;
  try {
    const rows = await eventStore.listRecent(1);
    return rows[0] ?? null;
  } catch (error) {
    logger?.warn("ops-service: failed to load audit events", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function safeReservations(logger: Logger | null, staffDataSource: OpsStaffDataSource | null | undefined): Promise<ReservationBundle[]> {
  if (!staffDataSource) return [];
  try {
    return await staffDataSource.listReservations(60);
  } catch (error) {
    logger?.warn("ops-service: failed to load reservations", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function safeEvents(logger: Logger | null, staffDataSource: OpsStaffDataSource | null | undefined): Promise<OpsEventRecord[]> {
  if (!staffDataSource) return [];
  try {
    return await staffDataSource.listEvents(120);
  } catch (error) {
    logger?.warn("ops-service: failed to load events", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function safeReports(logger: Logger | null, staffDataSource: OpsStaffDataSource | null | undefined): Promise<OpsReportRecord[]> {
  if (!staffDataSource) return [];
  try {
    return await staffDataSource.listReports(120);
  } catch (error) {
    logger?.warn("ops-service: failed to load reports", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function safeLending(logger: Logger | null, staffDataSource: OpsStaffDataSource | null | undefined): Promise<OpsLendingSnapshot | null> {
  if (!staffDataSource) return null;
  try {
    return await staffDataSource.getLendingSnapshot();
  } catch (error) {
    logger?.warn("ops-service: failed to load lending state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function defaultActorContext(actor?: Partial<OpsActorContext> | null): OpsActorContext {
  const opsRoles = actor?.opsRoles ?? [];
  const opsCapabilities = actor?.opsCapabilities ?? deriveOpsCapabilities(opsRoles);
  return {
    actorId: cleanString(actor?.actorId) || "ops-portal:anonymous",
    isStaff: actor?.isStaff === true || opsRoles.length > 0,
    portalRole: actor?.portalRole ?? "member",
    opsRoles,
    opsCapabilities,
  };
}

function buildSession(actor?: Partial<OpsActorContext> | null): OpsSessionMe | null {
  if (!actor) return null;
  const context = defaultActorContext(actor);
  return {
    actorId: context.actorId,
    portalRole: context.portalRole,
    isStaff: context.isStaff,
    opsRoles: context.opsRoles,
    opsCapabilities: context.opsCapabilities,
    allowedSurfaces: allowedSurfacesForCapabilities(context.opsCapabilities),
    allowedModes: {
      owner: allowedModesForSurface("owner", context.opsCapabilities),
      manager: allowedModesForSurface("manager", context.opsCapabilities),
      hands: allowedModesForSurface("hands", context.opsCapabilities),
      internet: allowedModesForSurface("internet", context.opsCapabilities),
      ceo: allowedModesForSurface("ceo", context.opsCapabilities),
      forge: allowedModesForSurface("forge", context.opsCapabilities),
    },
  };
}

function canActorSeeTask(actor: OpsActorContext, task: HumanTaskRecord): boolean {
  if (task.role === "studio_manager") return hasOpsCapability(actor.opsCapabilities, "surface:manager");
  if (task.role === "owner") return hasOpsCapability(actor.opsCapabilities, "surface:owner");
  if (task.surface === "hands" && !hasOpsCapability(actor.opsCapabilities, "surface:hands")) return false;
  if (task.surface === "internet" && !hasOpsCapability(actor.opsCapabilities, "surface:internet")) return false;
  if (task.surface === "manager" && !hasOpsCapability(actor.opsCapabilities, "surface:manager")) return false;
  if (task.surface === "owner" && !hasOpsCapability(actor.opsCapabilities, "surface:owner")) return false;
  if (task.role === "any_staff") return actor.isStaff;
  return task.role === "owner"
    ? actor.opsRoles.includes("owner")
    : actor.opsRoles.includes(task.role as OpsHumanRole) || hasOpsCapability(actor.opsCapabilities, "tasks:claim:any");
}

function canActorSeeCase(actor: OpsActorContext, record: OpsCaseRecord): boolean {
  return canAccessOpsSurface(actor.opsCapabilities, record.lane);
}

function canActorSeeApproval(actor: OpsActorContext, approval: ApprovalItem): boolean {
  if (!hasOpsCapability(actor.opsCapabilities, "approvals:view")) return false;
  if (approval.requiredRole === "owner") return actor.opsRoles.includes("owner");
  return actor.opsRoles.includes(approval.requiredRole as OpsHumanRole) || actor.opsRoles.includes("owner");
}

function assertActorCanClaimTask(actor: OpsActorContext, task: HumanTaskRecord): void {
  if (!canActorSeeTask(actor, task)) {
    throw new Error("This actor is not allowed to claim that task.");
  }
}

function assertActorCanResolveApproval(actor: OpsActorContext, approval: ApprovalItem): void {
  if (!canActorSeeApproval(actor, approval) || !hasOpsCapability(actor.opsCapabilities, "approvals:manage")) {
    throw new Error("This actor is not allowed to resolve that approval.");
  }
}

function assertActorCapability(actor: OpsActorContext, capability: OpsCapability, message: string): void {
  if (!hasOpsCapability(actor.opsCapabilities, capability)) {
    throw new Error(message);
  }
}

function terminalTaskStatus(status: HumanTaskRecord["status"]): boolean {
  return status === "verified" || status === "canceled";
}

function terminalCaseStatus(status: OpsCaseRecord["status"]): boolean {
  return status === "resolved" || status === "canceled";
}

function terminalApprovalStatus(status: ApprovalItem["status"]): boolean {
  return status === "approved" || status === "rejected" || status === "executed" || status === "expired";
}

function closeMissingManagedTask(existing: HumanTaskRecord, currentIso: string): HumanTaskRecord {
  if (terminalTaskStatus(existing.status)) return existing;
  return {
    ...existing,
    status: existing.completedAt ? "verified" : "canceled",
    degradeReason: "The upstream signal cleared or moved elsewhere.",
    updatedAt: currentIso,
    metadata: {
      ...existing.metadata,
      sourceOpen: false,
    },
  };
}

function closeMissingManagedCase(existing: OpsCaseRecord, currentIso: string): OpsCaseRecord {
  if (terminalCaseStatus(existing.status)) return existing;
  return {
    ...existing,
    status: "resolved",
    updatedAt: currentIso,
    metadata: {
      ...existing.metadata,
      sourceOpen: false,
    },
  };
}

function expireMissingManagedApproval(existing: ApprovalItem, currentIso: string): ApprovalItem {
  if (terminalApprovalStatus(existing.status)) return existing;
  return {
    ...existing,
    status: "expired",
    degradeReason: "The upstream approval condition cleared.",
    updatedAt: currentIso,
  };
}

export function createOpsService(options: OpsServiceOptions = {}) {
  const store = options.store ?? new MemoryOpsStore();
  const logger = options.logger ?? null;
  const kilnStore = options.kilnStore ?? null;
  const supportOpsStore = options.supportOpsStore ?? null;
  const stateStore = options.stateStore ?? null;
  const eventStore = options.eventStore ?? null;
  const staffDataSource = options.staffDataSource ?? createOpsStaffDataSource();
  const clock = options.now ?? nowIso;

  async function loadDependencies(currentIso: string): Promise<DependencySnapshot> {
    const [kilnOverview, supportState, studioState, latestAuditEvent, reservations, events, reports, lending] = await Promise.all([
      safeKilnOverview(logger, kilnStore),
      safeSupportQueue(logger, supportOpsStore),
      safeStudioState(logger, stateStore),
      safeLatestAuditEvent(logger, eventStore),
      safeReservations(logger, staffDataSource),
      safeEvents(logger, staffDataSource),
      safeReports(logger, staffDataSource),
      safeLending(logger, staffDataSource),
    ]);
    return {
      generatedAt: currentIso,
      kilnOverview,
      supportQueue: supportState.queue,
      supportCases: supportState.cases,
      studioState,
      latestAuditEvent,
      reservations,
      events,
      reports,
      lending,
    };
  }

  async function ensureDerivedState(): Promise<DerivedState> {
    const currentIso = clock();
    const dependencies = await loadDependencies(currentIso);
    const [persistedCases, persistedTasks, persistedApprovals, ceo, forge, manualModes, stations, recentEvents, persistedBundles, taskEscapes, overrides] = await Promise.all([
      store.listCases(200),
      store.listTasks(200),
      store.listApprovals(200),
      store.listGrowthExperiments(40),
      store.listImprovementCases(40),
      store.getDegradeModes(),
      store.listStationSessions(30),
      store.listEvents(50),
      store.listReservationBundles(120),
      store.listTaskEscapes(undefined, 120),
      store.listOverrides(120),
    ]);

    const casesById = new Map(persistedCases.map((row) => [row.id, row]));
    const tasksById = new Map(persistedTasks.map((row) => [row.id, row]));
    const approvalsById = new Map(persistedApprovals.map((row) => [row.id, row]));

    const derivedCaseIds = new Set<string>();
    const derivedTaskIds = new Set<string>();
    const derivedApprovalIds = new Set<string>();
    const mergedCases = new Map<string, OpsCaseRecord>();
    const mergedTasks = new Map<string, HumanTaskRecord>();
    const mergedApprovals = new Map<string, ApprovalItem>();
    const conversations: OpsPortalSnapshot["conversations"] = [];

    const stageCase = (seed: OpsCaseRecord) => {
      derivedCaseIds.add(seed.id);
      const merged = mergeCase(casesById.get(seed.id) ?? null, seed, currentIso);
      mergedCases.set(seed.id, merged);
    };
    const stageTask = (seed: HumanTaskRecord) => {
      derivedTaskIds.add(seed.id);
      const merged = mergeTask(tasksById.get(seed.id) ?? null, seed, currentIso);
      mergedTasks.set(seed.id, merged);
    };
    const stageApproval = (seed: ApprovalItem) => {
      derivedApprovalIds.add(seed.id);
      const merged = mergeApproval(approvalsById.get(seed.id) ?? null, seed, currentIso);
      mergedApprovals.set(seed.id, merged);
    };

    const reservationSourceRows = staffDataSource ? dependencies.reservations : (dependencies.reservations.length > 0 ? dependencies.reservations : persistedBundles);
    const reservationBundles = reservationSourceRows.filter((row) => isOperationalReservationBundle(row, currentIso));
    const reservationsOpen = reservationBundles.length;
    const supportOpen = dependencies.supportQueue?.totalOpen ?? dependencies.supportCases.filter((row) => row.queueBucket !== "resolved").length;
    const supportAwaitingApproval = dependencies.supportQueue?.awaitingApproval ?? 0;
    const supportSecurityHold = dependencies.supportQueue?.securityHold ?? 0;
    const kilnAttention = dependencies.kilnOverview?.fleet.attentionCount ?? 0;
    const kilnActiveRuns = dependencies.kilnOverview?.fleet.activeRuns ?? 0;

    if (dependencies.kilnOverview) {
      for (const kiln of dependencies.kilnOverview.kilns) {
        const warnings = [...(kiln.healthWarnings ?? []), ...(kiln.maintenanceFlags ?? [])];
        const verificationClass: VerificationClass = kiln.connectivityState === "online" ? "observed" : "inferred";
        const sources = [
          buildSourceRef("kilnaid", kiln.kilnName, kiln.lastImportTime ?? null, currentIso, { kind: "kiln" }),
        ];
        const caseId = `case_kiln_${kiln.kilnId}`;
        stageCase({
          id: caseId,
          kind: "kiln_run",
          title: `${kiln.kilnName} operating picture`,
          summary:
            warnings.length > 0
              ? `${kiln.kilnName} has ${warnings.length} warning${warnings.length === 1 ? "" : "s"} and needs human attention.`
              : kiln.currentRunId
                ? `${kiln.kilnName} is ${kiln.inferredPhase.toLowerCase()} with ${kiln.currentProgram ?? "an active program"}.`
                : `${kiln.kilnName} is idle and ready for the next commitment.`,
          status: warnings.length > 0 ? "blocked" : kiln.currentRunId ? "active" : "open",
          priority: warnings.length > 0 ? "p1" : kiln.currentRunId ? "p2" : "p3",
          lane: "hands",
          ownerRole: "kiln_lead",
          verificationClass,
          freshestAt: kiln.lastImportTime ?? null,
          sources,
          confidence: kiln.connectivityState === "online" ? 0.92 : 0.58,
          degradeReason: kiln.connectivityState === "stale" ? "Kiln telemetry is stale." : null,
          dueAt: null,
          linkedEntityKind: "kiln",
          linkedEntityId: kiln.kilnId,
          memoryScope: `ops:kilm:${kiln.kilnId}`,
          createdAt: currentIso,
          updatedAt: currentIso,
          metadata: managedMetadata({
            managedLabel: "kiln_case",
            sourceOpen: true,
            kilnName: kiln.kilnName,
            currentRunId: kiln.currentRunId,
            warnings,
          }),
        });
      }

      for (const action of dependencies.kilnOverview.requiredOperatorActions) {
        const kiln = dependencies.kilnOverview.kilns.find((entry) => entry.kilnId === action.kilnId);
        const taskKind = String(action.notes ?? "").toLowerCase();
        const title =
          taskKind.includes("unload")
            ? `Unload ${kiln?.kilnName ?? action.kilnId}`
            : taskKind.includes("press start")
              ? `Start ${kiln?.kilnName ?? action.kilnId}`
              : `Handle ${kiln?.kilnName ?? action.kilnId} operator action`;
        const sources = [
          buildSourceRef("kilnaid", kiln?.kilnName ?? action.kilnId, action.requestedAt ?? kiln?.lastImportTime ?? null, currentIso, {
            kind: "operator_action",
          }),
        ];
        stageTask(
          createHumanTaskSeed({
            id: `task_kiln_${action.id}`,
            caseId: `case_kiln_${action.kilnId}`,
            title,
            priority: taskKind.includes("unload") ? "p0" : "p1",
            surface: "hands",
            role: "kiln_lead",
            zone: kiln?.kilnName ?? action.kilnId,
            dueAt: action.requestedAt,
            etaMinutes: taskKind.includes("unload") ? 15 : 10,
            toolsNeeded: ["heat gloves", "kiln shelf tools"],
            interruptibility: "now",
            whyNow: cleanString(action.notes) || "The kiln queue requires a human step before the next firing can proceed.",
            whyYou: "Kiln leads own physical kiln transitions and safety-sensitive handling.",
            evidenceSummary: cleanString(action.notes) || "The kiln system emitted a required operator action.",
            consequenceIfDelayed: "The kiln queue can drift and the next promised work may slip.",
            instructions:
              taskKind.includes("press start")
                ? ["Verify the kiln load is correct.", "Confirm the controller is ready.", "Press start and watch the first transition."]
                : ["Check the kiln is safe to open.", "Handle ware carefully and clear the chamber.", "Record proof before leaving the zone."],
            checklist: [
              { id: `${action.id}:1`, label: "Safety check", detail: "Confirm the kiln is safe for the requested action.", status: "todo" },
              { id: `${action.id}:2`, label: "Perform the physical action", detail: cleanString(action.notes) || null, status: "todo" },
              { id: `${action.id}:3`, label: "Attach proof", detail: "Use the preferred proof path or a manual fallback.", status: "todo" },
            ],
            doneDefinition: "The kiln action is complete and the new state is externally visible.",
            proofModes: ["qr_scan", "manual_confirm", "camera_snapshot"],
            preferredProofMode: "qr_scan",
            fallbackIfSignalMissing: "Use manual confirmation and leave a reconciliation note for the manager lane.",
            verificationClass: "observed",
            freshestAt: action.requestedAt ?? kiln?.lastImportTime ?? null,
            sources,
            confidence: kiln?.connectivityState === "online" ? 0.9 : 0.62,
            degradeReason: kiln?.connectivityState === "stale" ? "Kiln connectivity is stale." : null,
            metadata: managedMetadata({
              managedLabel: "kiln_task",
              sourceActionId: action.id,
              sourceOpen: true,
            }),
          }),
        );
      }

      for (const maintenance of dependencies.kilnOverview.maintenanceFlags) {
        if (!(maintenance.warnings.length || maintenance.confidenceNotes.length)) continue;
        const kiln = dependencies.kilnOverview.kilns.find((entry) => entry.kilnId === maintenance.kilnId);
        const id = `task_kiln_maintenance_${maintenance.kilnId}`;
        stageTask(
          createHumanTaskSeed({
            id,
            caseId: `case_kiln_${maintenance.kilnId}`,
            title: `Inspect ${kiln?.kilnName ?? maintenance.kilnId} drift`,
            priority: "p1",
            surface: "hands",
            role: "kiln_lead",
            zone: kiln?.kilnName ?? maintenance.kilnId,
            dueAt: currentIso,
            etaMinutes: 20,
            toolsNeeded: ["multimeter", "maintenance log"],
            interruptibility: "soon",
            whyNow: [...maintenance.warnings, ...maintenance.confidenceNotes].join(" ") || "The kiln health snapshot is asking for inspection.",
            whyYou: "Kiln leads own relay, coil, and health checks when firing behavior drifts.",
            evidenceSummary: [...maintenance.warnings, ...maintenance.confidenceNotes].join(" "),
            consequenceIfDelayed: "Equipment degradation can turn into failed firings and surprise delays.",
            instructions: [
              "Inspect the kiln and confirm whether the warning reflects real hardware drift.",
              "Log anything unusual about relays, coils, or the firing pace.",
              "Escalate immediately if the kiln cannot safely continue service.",
            ],
            checklist: [
              { id: `${id}:1`, label: "Inspect physical condition", status: "todo" },
              { id: `${id}:2`, label: "Compare warning to reality", status: "todo" },
              { id: `${id}:3`, label: "Leave a manager note", status: "todo" },
            ],
            doneDefinition: "The kiln health warning has been checked and a clear next action is recorded.",
            proofModes: ["manual_confirm", "camera_snapshot"],
            preferredProofMode: "manual_confirm",
            fallbackIfSignalMissing: "Leave a written note with a photo and flag the task as blocked.",
            verificationClass: "inferred",
            freshestAt: kiln?.lastImportTime ?? currentIso,
            sources: [buildSourceRef("kilnaid", kiln?.kilnName ?? maintenance.kilnId, kiln?.lastImportTime ?? null, currentIso, { kind: "health" })],
            confidence: 0.7,
            degradeReason: kiln?.connectivityState === "stale" ? "Kiln telemetry is stale." : null,
            metadata: managedMetadata({
              managedLabel: "kiln_maintenance",
              sourceOpen: true,
            }),
          }),
        );
      }
    }

    for (const supportCase of dependencies.supportCases) {
      const sources = [
        buildSourceRef(supportCase.provider, (supportCase.senderEmail ?? supportCase.subject) || "support thread", supportCase.updatedAt, currentIso, {
          kind: "conversation",
        }),
      ];
      const caseId = `case_support_${supportCase.supportRequestId}`;
      const requiresApproval =
        supportCase.queueBucket === "awaiting_approval"
        || supportCase.decision === "proposal_required"
        || Boolean(supportCase.proposalId);
      const open = supportCase.queueBucket !== "resolved";
      stageCase({
        id: caseId,
        kind: "support_thread",
        title: supportCase.subject || supportCase.senderEmail || "Support conversation",
        summary:
          supportCase.supportSummary
          || supportCase.nextRecommendedAction
          || `${supportCase.queueBucket.replaceAll("_", " ")} support thread awaiting response.`,
        status:
          !open
            ? "resolved"
            : requiresApproval
              ? "awaiting_approval"
              : supportCase.humanHandoff || supportCase.queueBucket === "staff_review"
                ? "active"
                : "open",
        priority:
          supportCase.riskState === "high_risk"
            ? "p0"
            : requiresApproval || supportCase.unread
              ? "p1"
              : "p2",
        lane: "internet",
        ownerRole: requiresApproval ? "owner" : "support",
        verificationClass: supportCase.senderVerifiedUid ? "confirmed" : "observed",
        freshestAt: supportCase.updatedAt,
        sources,
        confidence: supportCase.senderVerifiedUid ? 0.91 : 0.72,
        degradeReason: supportCase.threadDriftFlag ? "Conversation drift is suspected." : null,
        dueAt: supportCase.lastReceivedAt,
        linkedEntityKind: "support_request",
        linkedEntityId: supportCase.supportRequestId,
        memoryScope: supportCase.emberMemoryScope,
        createdAt: currentIso,
        updatedAt: currentIso,
        metadata: managedMetadata({
          managedLabel: "support_case",
          queueBucket: supportCase.queueBucket,
          sourceOpen: open,
        }, open),
      });

      conversations.push({
        id: `conversation_${supportCase.supportRequestId}`,
        surface: "internet",
        roleMask: supportCase.senderVerifiedUid ? "verified member" : "internet thread",
        senderIdentity: supportCase.senderEmail ?? supportCase.provider,
        latestMessageAt: supportCase.updatedAt,
        unread: supportCase.unread,
        summary: (supportCase.supportSummary ?? supportCase.subject) || "Support thread",
      });

      if (open) {
        stageTask(
          createHumanTaskSeed({
            id: `task_support_${supportCase.supportRequestId}`,
            caseId,
            title: requiresApproval ? `Prepare approval for ${supportCase.subject || "support thread"}` : `Respond to ${supportCase.subject || "support thread"}`,
            priority:
              supportCase.riskState === "high_risk"
                ? "p0"
                : requiresApproval || supportCase.unread
                  ? "p1"
                  : "p2",
            surface: "internet",
            role: requiresApproval ? "owner" : "support",
            zone: supportCase.provider,
            dueAt: supportCase.lastReceivedAt,
            etaMinutes: requiresApproval ? 8 : 12,
            toolsNeeded: ["thread memory", "policy context"],
            interruptibility: supportCase.unread ? "now" : "soon",
            whyNow:
              supportCase.nextRecommendedAction
              || supportCase.replyDraft
              || "A member-facing thread is open and needs a safe next step.",
            whyYou:
              requiresApproval
                ? "This thread crosses a policy or money boundary and needs approval."
                : "Support lane owns external commitments, replies, and thread continuity.",
            evidenceSummary:
              supportCase.supportSummary
              || `${supportCase.queueBucket.replaceAll("_", " ")} · ${supportCase.riskState.replaceAll("_", " ")}`,
            consequenceIfDelayed: "The member may feel ignored and the studio loses operational trust.",
            instructions: [
              "Open the thread context and read the latest message carefully.",
              requiresApproval ? "Resolve the approval or draft the exact exception path." : "Draft or send the next safe reply.",
              "Record the outcome so the next shift does not restart the context.",
            ],
            checklist: [
              { id: `${supportCase.supportRequestId}:1`, label: "Understand the ask", status: "todo" },
              { id: `${supportCase.supportRequestId}:2`, label: requiresApproval ? "Resolve approval" : "Advance the thread", status: "todo" },
              { id: `${supportCase.supportRequestId}:3`, label: "Leave continuity notes", status: "todo" },
            ],
            doneDefinition: requiresApproval ? "The approval state is resolved with rationale." : "The thread has a safe next message or an explicit queued owner.",
            proofModes: ["manual_confirm"],
            preferredProofMode: "manual_confirm",
            fallbackIfSignalMissing: "Add a case note with the intended reply and flag the manager lane.",
            verificationClass: supportCase.senderVerifiedUid ? "confirmed" : "observed",
            freshestAt: supportCase.updatedAt,
            sources,
            confidence: supportCase.senderVerifiedUid ? 0.86 : 0.67,
            degradeReason: supportCase.threadDriftFlag ? "Thread drift is suspected." : null,
            metadata: managedMetadata({
              managedLabel: "support_task",
              queueBucket: supportCase.queueBucket,
              sourceOpen: true,
            }),
          }),
        );
      }

      if (requiresApproval) {
        stageApproval({
          id: `approval_support_${supportCase.supportRequestId}`,
          caseId,
          title: `Approval needed for ${supportCase.subject || "support thread"}`,
          summary:
            supportCase.replyDraft
            || supportCase.supportSummary
            || "A support reply or exception path needs an explicit owner decision.",
          status: "pending",
          actionClass: supportCase.proposalCapabilityId ? "proposal_required" : "support_reply",
          requestedBy: "studio-manager",
          requiredRole: "owner",
          riskSummary:
            supportCase.riskReasons.join(", ")
            || supportCase.confusionReason
            || "This thread touches a boundary the manager will not cross alone.",
          reversibility: supportCase.proposalCapabilityId ? "hard_to_reverse" : "reversible",
          verificationClass: supportCase.senderVerifiedUid ? "confirmed" : "observed",
          freshestAt: supportCase.updatedAt,
          sources,
          confidence: supportCase.senderVerifiedUid ? 0.82 : 0.63,
          degradeReason: supportCase.threadDriftFlag ? "Thread drift is suspected." : null,
          recommendation: supportCase.nextRecommendedAction || "Review the draft, approve the safe response, or reject with guidance.",
          rollbackPlan: "Reject the approval, leave a note, and keep the thread in staff review.",
          createdAt: currentIso,
          updatedAt: currentIso,
          resolvedAt: null,
          resolvedBy: null,
          metadata: managedMetadata({
            managedLabel: "support_approval",
            proposalId: supportCase.proposalId,
            sourceOpen: true,
          }),
        });
      }
    }

    if (supportAwaitingApproval > 0) {
      stageTask(
        createHumanTaskSeed({
          id: "task_owner_approval_queue",
          caseId: null,
          title: `Resolve ${supportAwaitingApproval} approval${supportAwaitingApproval === 1 ? "" : "s"}`,
          priority: supportAwaitingApproval > 2 ? "p0" : "p1",
          surface: "owner",
          role: "owner",
          zone: "Approval queue",
          dueAt: currentIso,
          etaMinutes: 10,
          toolsNeeded: ["approval context"],
          interruptibility: "now",
          whyNow: `${supportAwaitingApproval} conversation${supportAwaitingApproval === 1 ? "" : "s"} cannot advance without owner approval.`,
          whyYou: "Only the owner can approve money, exceptions, or sensitive commitments.",
          evidenceSummary: `${supportAwaitingApproval} approvals are pending in the internet lane.`,
          consequenceIfDelayed: "Replies stall and the studio loses responsiveness.",
          instructions: [
            "Review each approval item and its recommendation.",
            "Approve or reject with a clear note.",
            "Let the manager lane continue execution with the new boundary.",
          ],
          checklist: [
            { id: "owner-approvals:1", label: "Review recommendations", status: "todo" },
            { id: "owner-approvals:2", label: "Decide each approval", status: "todo" },
          ],
          doneDefinition: "Every pending approval has an explicit owner outcome.",
          proofModes: ["manual_confirm"],
          preferredProofMode: "manual_confirm",
          fallbackIfSignalMissing: "Leave a manual note naming which approval needs deeper context.",
          verificationClass: "observed",
          freshestAt: currentIso,
          sources: [buildSourceRef("ops", "Approval queue", currentIso, currentIso, { kind: "approval_queue" })],
          confidence: 0.96,
          metadata: managedMetadata({
            managedLabel: "owner_approval_queue",
            sourceOpen: true,
          }),
        }),
      );
    }

    for (const bundle of reservationBundles) {
      const caseId = `case_reservation_${bundle.reservationId}`;
      const countdown = minutesUntil(bundle.dueAt);
      const priority: OpsPriority =
        bundle.arrival.status === "arrived" || (countdown !== null && countdown <= 30)
          ? "p1"
          : bundle.notes
            ? "p1"
            : "p2";
      stageCase({
        id: caseId,
        kind: "arrival",
        title: bundle.title,
        summary: bundle.arrival.summary,
        status: bundle.arrival.status === "arrived" ? "active" : "open",
        priority,
        lane: "manager",
        ownerRole: "floor_staff",
        verificationClass: bundle.verificationClass,
        freshestAt: bundle.freshestAt,
        sources: bundle.sources,
        confidence: bundle.confidence,
        degradeReason: bundle.degradeReason,
        dueAt: bundle.dueAt,
        linkedEntityKind: "reservation",
        linkedEntityId: bundle.reservationId,
        memoryScope: `ops:reservation:${bundle.reservationId}`,
        createdAt: currentIso,
        updatedAt: currentIso,
        metadata: managedMetadata({
          managedLabel: "reservation_bundle",
          sourceOpen: true,
          ownerUid: bundle.ownerUid,
        }),
      });
      stageTask(
        createHumanTaskSeed({
          id: `task_reservation_prepare_${bundle.reservationId}`,
          caseId,
          title: bundle.arrival.status === "arrived" ? `Check in ${bundle.displayName}` : `Prepare for ${bundle.displayName}`,
          priority,
          surface: "hands",
          role: bundle.prep.assignedRole,
          zone: "Intake / front desk",
          dueAt: bundle.dueAt,
          etaMinutes: countdown !== null ? Math.max(5, Math.min(30, countdown)) : 15,
          toolsNeeded: bundle.prep.toolsNeeded,
          interruptibility: bundle.arrival.status === "arrived" || (countdown !== null && countdown <= 20) ? "now" : "soon",
          whyNow: bundle.arrival.summary,
          whyYou: "This lane owns arrival prep, intake context, and making sure the studio is never surprised by a member.",
          evidenceSummary: bundle.notes || `Reservation status is ${bundle.status}.`,
          consequenceIfDelayed: "The studio can get surprised by an arrival or miss the prep context that makes intake smooth.",
          instructions: bundle.prep.actions,
          checklist: bundle.prep.actions.map((entry, index) => ({
            id: `${bundle.reservationId}:prep:${index + 1}`,
            label: entry,
            status: "todo" as const,
          })),
          doneDefinition: "The arrival prep is ready and the intake lane understands what matters for this reservation.",
          proofModes: ["manual_confirm", "qr_scan"],
          preferredProofMode: "manual_confirm",
          fallbackIfSignalMissing: "Leave a manual note with what you prepared and what still needs confirmation.",
          verificationClass: bundle.verificationClass,
          freshestAt: bundle.freshestAt,
          sources: bundle.sources,
          confidence: bundle.confidence,
          degradeReason: bundle.degradeReason,
          metadata: managedMetadata({
            managedLabel: "reservation_task",
            reservationId: bundle.reservationId,
            sourceOpen: true,
          }),
        }),
      );
    }

    if (kilnAttention > 0 || reservationsOpen > 0 || supportOpen > 0) {
      stageTask(
        createHumanTaskSeed({
          id: "task_manager_operating_brief",
          caseId: null,
          title: "Run the current studio brief",
          priority: kilnAttention > 0 || supportSecurityHold > 0 ? "p0" : "p1",
          surface: "manager",
          role: "studio_manager",
          zone: "Studio twin",
          dueAt: currentIso,
          etaMinutes: 6,
          toolsNeeded: ["studio twin", "approval queue", "live notes"],
          interruptibility: "now",
          whyNow: `The studio currently has ${kilnAttention} kiln attention item${kilnAttention === 1 ? "" : "s"}, ${supportOpen} open internet thread${supportOpen === 1 ? "" : "s"}, and ${reservationsOpen} reservation${reservationsOpen === 1 ? "" : "s"} in flight.`,
          whyYou: "The studio manager is the coordinating intelligence responsible for reducing surprise and sequencing humans.",
          evidenceSummary: "This brief combines commitments, kiln state, and member communication pressure.",
          consequenceIfDelayed: "Humans lose clarity and hidden work debt grows.",
          instructions: [
            "Read the current risk rail and the top queued tasks.",
            "Resolve any blocked approvals or assign hands work cleanly.",
            "Leave continuity notes so the next interaction starts in context.",
          ],
          checklist: [
            { id: "manager-brief:1", label: "Check current risk", status: "todo" },
            { id: "manager-brief:2", label: "Sequence the next human actions", status: "todo" },
            { id: "manager-brief:3", label: "Update continuity notes", status: "todo" },
          ],
          doneDefinition: "The studio has a clear next action and no hidden high-priority surprise.",
          proofModes: ["manual_confirm"],
          preferredProofMode: "manual_confirm",
          fallbackIfSignalMissing: "Flag the truth rail and move to manual dispatch until the signal returns.",
          verificationClass: "observed",
          freshestAt: currentIso,
          sources: [buildSourceRef("ops", "Studio brief", currentIso, currentIso, { kind: "brief" })],
          confidence: 0.95,
          metadata: managedMetadata({
            managedLabel: "manager_brief",
            sourceOpen: true,
          }),
        }),
      );
    }

    for (const [id, record] of tasksById.entries()) {
      if (!isManagedByOps(record.metadata) || derivedTaskIds.has(id)) continue;
      const closed = closeMissingManagedTask(record, currentIso);
      mergedTasks.set(id, closed);
    }
    for (const [id, record] of casesById.entries()) {
      if (!isManagedByOps(record.metadata) || derivedCaseIds.has(id)) continue;
      const closed = closeMissingManagedCase(record, currentIso);
      mergedCases.set(id, closed);
    }
    for (const [id, record] of approvalsById.entries()) {
      if (!isManagedByOps(record.metadata) || derivedApprovalIds.has(id)) continue;
      const closed = expireMissingManagedApproval(record, currentIso);
      mergedApprovals.set(id, closed);
    }

    await Promise.all([
      ...[...mergedCases.values()].map((row) => store.upsertCase(row)),
      ...[...mergedTasks.values()].map((row) => store.upsertTask(row)),
      ...[...mergedApprovals.values()].map((row) => store.upsertApproval(row)),
      ...reservationBundles.map((row) => store.upsertReservationBundle(row)),
    ]);

    const liveEventRows = dependencies.events.filter((row) => isOperationalEventRecord(row, currentIso));
    const liveReportRows = dependencies.reports.filter((row) => isOperationalReportRecord(row, currentIso));

    const latestOpsEventAt = recentEvents[0]?.occurredAt ?? null;
    const latestKilnAt = dependencies.kilnOverview?.kilns.reduce<string | null>((best, row) => latest(best, row.lastImportTime ?? null), null) ?? null;
    const latestSupportAt = dependencies.supportCases.reduce<string | null>((best, row) => latest(best, row.updatedAt), null);
    const latestStateAt = dependencies.studioState?.generatedAt ?? null;
    const latestStationAt = stations.reduce<string | null>((best, row) => latest(best, row.lastSeenAt), null);
    const latestReservationAt = reservationBundles.reduce<string | null>((best, row) => latest(best, row.freshestAt), null);
    const latestEventAt = liveEventRows.reduce<string | null>((best, row) => latest(best, row.lastStatusChangedAt ?? row.startAt), null);
    const latestReportAt = liveReportRows.reduce<string | null>((best, row) => latest(best, row.createdAt), null);
    const latestLendingAt = dependencies.lending?.loans.reduce<string | null>((best, row) => latest(best, row.createdAt ?? row.dueAt), null)
      ?? dependencies.lending?.requests.reduce<string | null>((best, row) => latest(best, row.createdAt), null)
      ?? null;

    const sourceRows: OpsSourceFreshness[] = [
      sourceFreshnessRow(currentIso, "ops_ledger", "Ops ledger", latestOpsEventAt, 600, latestOpsEventAt ? null : "No ops events have been ingested yet.", { missingStatus: "healthy" }),
      sourceFreshnessRow(currentIso, "studio_state", "Studio state", latestStateAt, 3600, latestStateAt ? null : "No studio state snapshot is available.", { missingStatus: "warning" }),
      sourceFreshnessRow(
        currentIso,
        "kilnaid",
        "Kiln telemetry",
        latestKilnAt,
        900,
        dependencies.kilnOverview ? null : "Kiln telemetry is unavailable.",
        { missingStatus: "warning" },
      ),
      sourceFreshnessRow(
        currentIso,
        "support",
        "Inbox and internet threads",
        latestSupportAt,
        900,
        supportOpsStore ? null : "Support lane is not configured.",
        { missingStatus: "warning" },
      ),
      sourceFreshnessRow(currentIso, "stations", "Station heartbeats", latestStationAt, 900, latestStationAt ? null : "No station heartbeats have been seen yet.", { missingStatus: "warning" }),
      sourceFreshnessRow(currentIso, "reservations", "Reservations", latestReservationAt, 1800, reservationBundles.length > 0 ? null : "No live reservation bundles are active right now.", { missingStatus: "healthy" }),
      sourceFreshnessRow(currentIso, "events", "Events", latestEventAt, 3600, liveEventRows.length > 0 ? null : "No live event pressure is visible right now.", { missingStatus: "healthy" }),
      sourceFreshnessRow(currentIso, "reports", "Community reports", latestReportAt, 1800, liveReportRows.length > 0 ? null : "No live community reports are visible.", { missingStatus: "healthy" }),
      sourceFreshnessRow(currentIso, "lending", "Lending", latestLendingAt, 1800, dependencies.lending ? null : "Lending data is unavailable.", { missingStatus: "warning" }),
    ];

    const derivedModes = new Set<OpsDegradeMode>(manualModes);
    if (sourceRows.some((row) => row.source === "ops_ledger" && row.status === "critical")) derivedModes.add("observe_only");
    if (sourceRows.some((row) => row.source === "kilnaid" && row.status === "critical")) derivedModes.add("manual_dispatch_only");
    if (sourceRows.some((row) => row.source === "support" && row.status === "critical")) derivedModes.add("internet_pause");
    if (sourceRows.some((row) => row.status === "critical")) {
      derivedModes.add("growth_pause");
      derivedModes.add("forge_pause");
    }
    if (sourceRows.some((row) => row.status === "critical" && (row.source === "kilnaid" || row.source === "support"))) {
      derivedModes.add("no_human_tasking");
    }

    await store.saveSourceFreshness(sourceRows);

    const activeDerivedTasks = [...mergedTasks.values()].filter((row) => !terminalTaskStatus(row.status));
    const activeDerivedCases = [...mergedCases.values()].filter((row) => !terminalCaseStatus(row.status));
    const pendingApprovals = [...mergedApprovals.values()].filter((row) => row.status === "pending").length;
    const standbyReady = reservationsOpen === 0
      && supportOpen === 0
      && kilnAttention === 0
      && pendingApprovals === 0
      && activeDerivedTasks.length === 0
      && activeDerivedCases.length === 0;
    const hasCriticalSource = sourceRows.some((row) => row.status === "critical");
    const truthReadiness = standbyReady && !hasCriticalSource && manualModes.length === 0
      ? "ready"
      : deriveReadiness([...derivedModes], sourceRows);
    const topTask = sortTasks([...mergedTasks.values()]).find((row) => !terminalTaskStatus(row.status)) ?? null;
    const currentRisk =
      supportSecurityHold > 0
        ? `${supportSecurityHold} support thread${supportSecurityHold === 1 ? "" : "s"} are on security hold.`
        : kilnAttention > 0
          ? `${kilnAttention} kiln signal${kilnAttention === 1 ? "" : "s"} need attention.`
          : pendingApprovals > 0
            ? `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} are blocking forward motion.`
            : truthReadiness === "blocked" && !standbyReady
              ? "Truth readiness is degraded enough that human trust would be misplaced."
              : null;

    const watchdogs: OpsWatchdog[] = [
      {
        id: "watchdog_truth_readiness",
        label: "Truth readiness",
        status: truthReadiness === "ready" ? "healthy" : truthReadiness === "degraded" ? "warning" : "critical",
        summary:
          truthReadiness === "ready"
            ? "Signals are fresh enough to support autonomous coordination."
            : truthReadiness === "degraded"
              ? "Some signals are stale or manual degrade modes are active."
              : "Critical freshness or trust gaps require slower, more explicit operations.",
        recommendation:
          truthReadiness === "ready"
            ? "Keep the manager lane focused on sequencing and approvals."
            : "Use the truth rail to recover stale sources before widening autonomy.",
      },
      {
        id: "watchdog_arrival_surprise",
        label: "Arrival surprise risk",
        status: !dependencies.studioState ? "critical" : reservationsOpen > 0 ? "warning" : "healthy",
        summary:
          !dependencies.studioState
            ? "There is no recent studio state snapshot to ground commitments and arrivals."
            : reservationsOpen > 0
              ? `${reservationsOpen} reservation${reservationsOpen === 1 ? "" : "s"} are open and should be prepared explicitly.`
              : "No open reservation pressure is visible in the current studio snapshot.",
        recommendation:
          reservationsOpen > 0
            ? "Use the manager lane to turn commitments into prep bundles and arrival expectations."
            : "Continue watching the calendar and occupancy integrations for surprise reduction.",
      },
      {
        id: "watchdog_kiln_health",
        label: "Kiln and power posture",
        status: kilnAttention > 0 ? "warning" : dependencies.kilnOverview ? "healthy" : "warning",
        summary:
          dependencies.kilnOverview
            ? `${kilnActiveRuns} active run${kilnActiveRuns === 1 ? "" : "s"} and ${kilnAttention} attention item${kilnAttention === 1 ? "" : "s"} are visible in kiln telemetry.`
            : "Kiln telemetry is unavailable, so the next kiln-dependent move should be confirmed manually.",
        recommendation:
          kilnAttention > 0
            ? "Prioritize the kiln lead tasks before promising new firing capacity."
            : "Reconnect live kiln telemetry before relying on automation for kiln promises.",
      },
      {
        id: "watchdog_approval_pressure",
        label: "Approval pressure",
        status: pendingApprovals > 0 ? "warning" : "healthy",
        summary:
          pendingApprovals > 0
            ? `${pendingApprovals} owner approval${pendingApprovals === 1 ? "" : "s"} are currently gating studio motion.`
            : "No approvals are currently blocking the studio.",
        recommendation:
          pendingApprovals > 0
            ? "Resolve approvals quickly so the manager can continue without impersonating ownership."
            : "Keep approvals narrow, explicit, and well-rationalized.",
      },
    ];

    await store.saveWatchdogs(watchdogs);

    const truthSummary =
      truthReadiness === "ready"
        ? standbyReady
          ? "Studio truth is calm enough for a clean handoff. No live lane is carrying urgent inherited work."
          : "Studio truth is fresh enough for autonomous coordination."
        : truthReadiness === "degraded"
          ? "Studio truth is partially stale; autonomous actions should stay inside tighter boundaries."
          : "Studio truth is blocked by stale or missing signals; prefer manual confirmation and explicit approvals.";

    const truth: OpsPortalSnapshot["truth"] = {
      generatedAt: currentIso,
      readiness: truthReadiness,
      summary: truthSummary,
      degradeModes: [...derivedModes],
      sources: sourceRows,
      watchdogs,
      metrics: {
        open_cases: [...mergedCases.values()].filter((row) => !terminalCaseStatus(row.status)).length,
        open_tasks: [...mergedTasks.values()].filter((row) => !terminalTaskStatus(row.status)).length,
        pending_approvals: pendingApprovals,
        reservations_open: reservationsOpen,
        support_open: supportOpen,
        kiln_attention: kilnAttention,
      },
    };

    const arrivalsEvidence = buildEvidenceSummary(
      reservationsOpen > 0
        ? `${reservationsOpen} reservation${reservationsOpen === 1 ? "" : "s"} are active in the current handoff window.`
        : "No live reservation bundles are active in the current handoff window.",
      reservationsOpen > 0 ? "planned" : dependencies.studioState ? "observed" : "inferred",
      [buildSourceRef("studio_state", "Studio commitments", latestStateAt, currentIso, { kind: "commitment" })],
      reservationsOpen > 0 ? 0.84 : dependencies.studioState ? 0.8 : 0.56,
      dependencies.studioState ? null : "The studio state snapshot is unavailable.",
    );
    const kilnEvidence = buildEvidenceSummary(
      dependencies.kilnOverview
        ? `${kilnActiveRuns} active run${kilnActiveRuns === 1 ? "" : "s"} and ${kilnAttention} attention item${kilnAttention === 1 ? "" : "s"} are visible.`
        : "Kiln telemetry is unavailable.",
      dependencies.kilnOverview ? "observed" : "inferred",
      [buildSourceRef("kilnaid", "Kiln telemetry", latestKilnAt, currentIso, { kind: "kiln" })],
      dependencies.kilnOverview ? 0.87 : 0.28,
      dependencies.kilnOverview ? null : "No kiln telemetry was available.",
    );
    const internetEvidence = buildEvidenceSummary(
      supportOpen > 0
        ? `${supportOpen} open thread${supportOpen === 1 ? "" : "s"} are still active in the internet lane.`
        : "No open support or event threads are visible right now.",
      supportOpsStore ? "observed" : "inferred",
      [buildSourceRef("support", "Internet lane", latestSupportAt, currentIso, { kind: "conversation" })],
      supportOpsStore ? 0.84 : 0.3,
      supportOpsStore ? null : "Support connectors are not configured.",
    );
    const truthEvidence = buildEvidenceSummary(
      truthSummary,
      truthReadiness === "ready" ? "confirmed" : truthReadiness === "degraded" ? "inferred" : "planned",
      sourceRows.map((row) => buildSourceRef(row.source, row.label, row.freshestAt, currentIso, { kind: "source" })),
      sourceRows.length
        ? sourceRows.reduce<number>((sum, row) => sum + (row.status === "healthy" ? 1 : row.status === "warning" ? 0.6 : 0.2), 0) / sourceRows.length
        : 0.2,
      truthReadiness === "ready" ? null : truthSummary,
    );

    const twinZones: OpsTwinZone[] = [
      {
        id: "zone_arrivals",
        label: "Arrivals and commitments",
        status: deriveZoneStatus(reservationsOpen > 0 ? "warning" : "healthy", arrivalsEvidence, [...derivedModes]),
        summary:
          reservationsOpen > 0
            ? `${reservationsOpen} reservation${reservationsOpen === 1 ? "" : "s"} are open, so prep and arrival visibility matter right now.`
            : "No immediate arrival pressure is visible in the current commitments.",
        nextAction: reservationsOpen > 0 ? "Turn open reservations into prep and arrival bundles." : "Continue monitoring the calendar and occupancy signals.",
        evidence: arrivalsEvidence,
      },
      {
        id: "zone_kilns",
        label: "Kilns and physical flow",
        status: deriveZoneStatus(kilnAttention > 0 ? "warning" : dependencies.kilnOverview ? "healthy" : "warning", kilnEvidence, [...derivedModes]),
        summary:
          dependencies.kilnOverview
            ? `${kilnActiveRuns} active run${kilnActiveRuns === 1 ? "" : "s"} and ${kilnAttention} operator attention item${kilnAttention === 1 ? "" : "s"} define the current kiln load.`
            : "Kiln telemetry is currently offline, so any kiln-dependent promise should be confirmed manually before handoff.",
        nextAction: kilnAttention > 0 ? "Work the top kiln tasks before queueing more promises." : "Reconnect kiln telemetry or keep kiln promises manual until it returns.",
        evidence: kilnEvidence,
      },
      {
        id: "zone_internet",
        label: "Internet, support, and promises",
        status: deriveZoneStatus(
          supportSecurityHold > 0 ? "critical" : supportOpen > 0 ? "warning" : supportOpsStore ? "healthy" : "critical",
          internetEvidence,
          [...derivedModes],
          supportSecurityHold > 0,
        ),
        summary:
          supportSecurityHold > 0
            ? `${supportSecurityHold} thread${supportSecurityHold === 1 ? "" : "s"} are on security hold and need careful handling.`
            : supportOpen > 0
              ? `${supportOpen} open thread${supportOpen === 1 ? "" : "s"} need a clear next step in the internet lane.`
              : "No urgent member conversations are currently visible.",
        nextAction:
          supportSecurityHold > 0
            ? "Resolve risky threads through the approval path."
            : supportOpen > 0
              ? "Advance the next safe reply or approval."
              : "Keep watching for new inquiries, complaints, and event work.",
        evidence: internetEvidence,
      },
      {
        id: "zone_truth",
        label: "Truth and watchdog posture",
        status: deriveZoneStatus(
          truthReadiness === "ready" ? "healthy" : truthReadiness === "degraded" ? "warning" : "critical",
          truthEvidence,
          [...derivedModes],
          truthReadiness === "blocked",
        ),
        summary: truthSummary,
        nextAction:
          truthReadiness === "ready"
            ? "Keep the manager focused on sequencing and explanation."
            : "Recover freshness gaps before widening automation.",
        evidence: truthEvidence,
      },
    ];

    const allCases = sortCases([
      ...persistedCases.filter((row) => !mergedCases.has(row.id)),
      ...mergedCases.values(),
    ]);
    const allTasks = sortTasks([
      ...persistedTasks.filter((row) => !mergedTasks.has(row.id)),
      ...mergedTasks.values(),
    ]);
    const allApprovals = sortApprovals([
      ...persistedApprovals.filter((row) => !mergedApprovals.has(row.id)),
      ...mergedApprovals.values(),
    ]);

    const twin: OpsTwinState = {
      generatedAt: currentIso,
      headline:
        currentRisk
          ? `Studio is active: ${currentRisk}`
          : standbyReady
            ? "Studio is ready for handoff."
            : `Studio is steady with ${kilnActiveRuns} active kiln run${kilnActiveRuns === 1 ? "" : "s"} and ${supportOpen} open internet thread${supportOpen === 1 ? "" : "s"}.`,
      narrative:
        standbyReady
          ? "No live hands, internet, or owner-gated work is waiting from the lab snapshot. The next operator can take the baton on a clean board."
          : `The manager should minimize surprise across ${reservationsOpen} open reservation${reservationsOpen === 1 ? "" : "s"}, `
            + `${kilnAttention} kiln attention item${kilnAttention === 1 ? "" : "s"}, and ${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"}.`,
      currentRisk,
      commitmentsDueSoon: reservationsOpen,
      arrivalsExpectedSoon: reservationsOpen,
      zones: twinZones,
      nextActions:
        (topTask ? [topTask.title] : [])
        .concat(allTasks.filter((row) => !terminalTaskStatus(row.status)).slice(1, 4).map((row) => row.title))
        .filter((value, index, array) => array.indexOf(value) === index)
        .slice(0, 4),
    };

    return {
      twin,
      truth,
      tasks: allTasks,
      cases: allCases,
      approvals: allApprovals,
      conversations: conversations.sort((left, right) => right.latestMessageAt.localeCompare(left.latestMessageAt)).slice(0, 10),
      ceo: [...ceo].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      forge: [...forge].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      reservations: reservationBundles,
      events: liveEventRows,
      reports: liveReportRows,
      lending: dependencies.lending,
      taskEscapes,
      overrides,
      dependencies,
    };
  }

  async function recordActionReceipt(
    actionId: string,
    sourceSystem: string,
    effectType: string,
    verificationClass: VerificationClass,
    summary: string,
    payload: Record<string, unknown>,
  ): Promise<ActionEffectReceipt> {
    const receipt: ActionEffectReceipt = {
      id: makeId("ops_effect"),
      actionId,
      sourceSystem,
      effectType,
      verificationClass,
      observedAt: clock(),
      summary,
      payload,
    };
    await store.saveActionEffectReceipt(receipt);
    return receipt;
  }

  async function ensureCaseRecord(caseId: string): Promise<OpsCaseRecord> {
    const existing = await store.getCase(caseId);
    if (existing) return existing;
    const currentIso = clock();
    const record: OpsCaseRecord = {
      id: caseId,
      kind: "general",
      title: caseId === "ops:chat" ? "Ops manager chat" : "General ops case",
      summary: "A durable continuity case created from a direct interaction.",
      status: "open",
      priority: "p2",
      lane: "manager",
      ownerRole: "studio_manager",
      verificationClass: "claimed",
      freshestAt: currentIso,
      sources: [buildSourceRef("ops", "Direct interaction", currentIso, currentIso, { kind: "manual" })],
      confidence: 0.72,
      degradeReason: null,
      dueAt: null,
      linkedEntityKind: null,
      linkedEntityId: null,
      memoryScope: `ops:case:${caseId}`,
      createdAt: currentIso,
      updatedAt: currentIso,
      metadata: { createdBy: MANAGED_BY, sourceOpen: true },
    };
    await store.upsertCase(record);
    return record;
  }

  const service = {
    async ingestWorldEvent(input: AppendWorldEventInput): Promise<{
      accepted: boolean;
      event: OpsWorldEvent;
      receipt: OpsIngestReceipt;
    }> {
      const sourceSystem = cleanString(input.sourceSystem).toLowerCase();
      const sourceEventId = cleanString(input.sourceEventId);
      const existingReceipt = await store.getIngestReceipt(sourceSystem, sourceEventId);
      const payloadHash = stableOpsHash(input.payload);
      const currentIso = clock();
      const receipt: OpsIngestReceipt = existingReceipt ?? {
        id: makeId("ops_ingest"),
        sourceSystem,
        sourceEventId,
        payloadHash,
        authPrincipal: cleanString(input.authPrincipal) || `machine:${sourceSystem}`,
        receivedAt: currentIso,
        timestampSkewSeconds: Math.max(0, Math.trunc(input.timestampSkewSeconds)),
      };
      const event: OpsWorldEvent = {
        id: existingReceipt?.id ? `ops_event_${existingReceipt.id}` : makeId("ops_event"),
        eventType: cleanString(input.eventType) || "ops.event",
        eventVersion: 1,
        entityKind: cleanString(input.entityKind) || "unknown",
        entityId: cleanString(input.entityId) || "unknown",
        caseId: cleanNullableString(input.caseId) ?? null,
        sourceSystem,
        sourceEventId,
        dedupeKey: stableOpsHash([sourceSystem, sourceEventId, payloadHash]),
        roomId: cleanNullableString(input.roomId),
        actorKind: cleanString(input.actorKind) || "machine",
        actorId: cleanString(input.actorId) || `machine:${sourceSystem}`,
        confidence: clampConfidence(input.confidence, 0.8),
        occurredAt: currentIso,
        ingestedAt: currentIso,
        verificationClass: input.verificationClass ?? "observed",
        payload: toRecord(input.payload),
        artifactRefs: toStringArray(input.artifactRefs, 32),
      };
      if (existingReceipt) {
        return { accepted: false, event, receipt: existingReceipt };
      }
      await store.appendEvent(event, receipt);
      if (event.caseId) {
        await ensureCaseRecord(event.caseId);
      }
      logger?.info("ops-service: ingested world event", {
        eventType: event.eventType,
        entityKind: event.entityKind,
        entityId: event.entityId,
        sourceSystem: event.sourceSystem,
      });
      return { accepted: true, event, receipt };
    },

    async upsertTask(task: HumanTaskRecord): Promise<void> {
      await store.upsertTask(task);
    },

    async getTwin(): Promise<OpsTwinState> {
      const derived = await ensureDerivedState();
      return derived.twin;
    },

    async getTruth(): Promise<OpsPortalSnapshot["truth"]> {
      const derived = await ensureDerivedState();
      return derived.truth;
    },

    async getPortalSnapshot(actor?: Partial<OpsActorContext> | null): Promise<OpsPortalSnapshot> {
      const derived = await ensureDerivedState();
      const context = actor ? defaultActorContext(actor) : null;
      const members = context && staffDataSource && hasOpsCapability(context.opsCapabilities, "members:view")
        ? await staffDataSource.listMembers(240).catch(() => [])
        : [];
      return {
        generatedAt: clock(),
        session: buildSession(context),
        twin: derived.twin,
        truth: derived.truth,
        tasks: (context ? derived.tasks.filter((row) => canActorSeeTask(context, row)) : derived.tasks).filter((row) => row.status !== "canceled"),
        cases: (context ? derived.cases.filter((row) => canActorSeeCase(context, row)) : derived.cases).filter((row) => row.status !== "canceled"),
        approvals: context ? derived.approvals.filter((row) => canActorSeeApproval(context, row)) : derived.approvals,
        ceo: derived.ceo,
        forge: derived.forge,
        conversations: context
          ? derived.conversations.filter((row) => canAccessOpsSurface(context.opsCapabilities, row.surface))
          : derived.conversations,
        members,
        reservations: derived.reservations,
        events: derived.events,
        reports: derived.reports,
        lending: derived.lending,
        taskEscapes: derived.taskEscapes,
        overrides: context && context.opsRoles.includes("owner") ? derived.overrides : [],
      };
    },

    async listTasks(actor?: Partial<OpsActorContext> | null): Promise<HumanTaskRecord[]> {
      const derived = await ensureDerivedState();
      if (!actor) return derived.tasks.filter((row) => !terminalTaskStatus(row.status));
      const context = defaultActorContext(actor);
      return derived.tasks.filter((row) => canActorSeeTask(context, row) && !terminalTaskStatus(row.status));
    },

    async claimTask(
      taskId: string,
      actor: Partial<OpsActorContext>,
      options?: { actorType?: ActorType; assignee?: string | null; metadata?: Record<string, unknown> },
    ): Promise<HumanTaskRecord | null> {
      const task = await store.getTask(taskId);
      if (!task) return null;
      const context = defaultActorContext(actor);
      assertActorCanClaimTask(context, task);
      if (task.claimedBy && task.claimedBy !== context.actorId && !terminalTaskStatus(task.status)) {
        return task;
      }
      const currentIso = clock();
      const updated: HumanTaskRecord = {
        ...task,
        status: task.status === "queued" || task.status === "proposed" || task.status === "reopened" ? "claimed" : task.status,
        claimedBy: cleanString(options?.assignee) || context.actorId,
        claimedAt: task.claimedAt ?? currentIso,
        updatedAt: currentIso,
        metadata: {
          ...task.metadata,
          actorType: options?.actorType ?? "staff",
          claimMetadata: options?.metadata ?? {},
        },
      };
      await store.upsertTask(updated);
      await recordActionReceipt(`claim:${taskId}:${currentIso}`, "ops", "task_claimed", "claimed", `Task ${taskId} was claimed by ${context.actorId}.`, {
        taskId,
        actorId: context.actorId,
      });
      return updated;
    },

    async addTaskProof(
      taskId: string,
      actor: Partial<OpsActorContext>,
      mode: ProofMode,
      note: string | null,
      artifactRefs: string[],
    ): Promise<TaskProofRecord | null> {
      const task = await store.getTask(taskId);
      if (!task) return null;
      const context = defaultActorContext(actor);
      assertActorCanClaimTask(context, task);
      assertActorCapability(context, "proof:submit", "This actor is not allowed to submit proof.");
      const currentIso = clock();
      const proof: TaskProofRecord = {
        id: makeId("ops_proof"),
        taskId,
        mode,
        actorId: context.actorId,
        verificationStatus: "submitted",
        note: cleanNullableString(note),
        artifactRefs: toStringArray(artifactRefs, 24),
        createdAt: currentIso,
      };
      await store.upsertTaskProof(proof);
      await store.upsertTask({
        ...task,
        status: "proof_pending",
        claimedBy: task.claimedBy ?? context.actorId,
        claimedAt: task.claimedAt ?? currentIso,
        updatedAt: currentIso,
      });
      await recordActionReceipt(`proof:${taskId}:${currentIso}`, "ops", "task_proof_submitted", "claimed", `Proof was submitted for task ${taskId}.`, {
        taskId,
        actorId: context.actorId,
        mode,
      });
      return proof;
    },

    async acceptTaskProof(input: AcceptTaskProofInput, actor: Partial<OpsActorContext>): Promise<TaskProofRecord | null> {
      const task = await store.getTask(input.taskId);
      if (!task) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "proof:accept", "This actor is not allowed to review task proof.");
      const proofs = await store.listTaskProofs(input.taskId);
      const target = proofs.find((row) => row.id === input.proofId);
      if (!target) return null;
      const updated: TaskProofRecord = {
        ...target,
        verificationStatus: input.status,
        note: cleanNullableString(input.note) ?? target.note,
        verifiedAt: clock(),
        verifiedBy: context.actorId,
      };
      await store.upsertTaskProof(updated);
      if (input.status === "accepted") {
        await store.upsertTask({
          ...task,
          status: "verified",
          completedAt: task.completedAt ?? clock(),
          updatedAt: clock(),
        });
      }
      return updated;
    },

    async completeTask(taskId: string, actor: Partial<OpsActorContext>): Promise<HumanTaskRecord | null> {
      const task = await store.getTask(taskId);
      if (!task) return null;
      const context = defaultActorContext(actor);
      assertActorCanClaimTask(context, task);
      const currentIso = clock();
      const proofs = await store.listTaskProofs(taskId);
      const hasAcceptedProof = proofs.some((row) => row.verificationStatus === "accepted");
      const updated: HumanTaskRecord = {
        ...task,
        status: hasAcceptedProof ? "verified" : "proof_pending",
        claimedBy: task.claimedBy ?? context.actorId,
        claimedAt: task.claimedAt ?? currentIso,
        completedAt: currentIso,
        updatedAt: currentIso,
        degradeReason: hasAcceptedProof ? null : "Completion was requested before proof was accepted.",
      };
      await store.upsertTask(updated);
      await recordActionReceipt(`complete:${taskId}:${currentIso}`, "ops", "task_completed", hasAcceptedProof ? "confirmed" : "claimed", `Task ${taskId} was marked complete by ${context.actorId}.`, {
        taskId,
        actorId: context.actorId,
        hasAcceptedProof,
      });
      return updated;
    },

    async escapeTask(input: EscapeTaskInput, actor: Partial<OpsActorContext>): Promise<TaskEscapeRecord | null> {
      const task = await store.getTask(input.taskId);
      if (!task) return null;
      const context = defaultActorContext(actor);
      assertActorCanClaimTask(context, task);
      const currentIso = clock();
      const escape: TaskEscapeRecord = {
        id: makeId("ops_escape"),
        taskId: task.id,
        caseId: task.caseId,
        actorId: context.actorId,
        escapeHatch: input.escapeHatch,
        reason: cleanNullableString(input.reason),
        status: "open",
        createdAt: currentIso,
        resolvedAt: null,
        resolvedBy: null,
        metadata: {},
      };
      await store.appendTaskEscape(escape);
      await store.upsertTask({
        ...task,
        status: "blocked",
        blockerReason: cleanNullableString(input.reason) || input.escapeHatch,
        updatedAt: currentIso,
      });
      if (task.caseId) {
        await service.addCaseNote({
          caseId: task.caseId,
          actorId: context.actorId,
          body: `Task escape: ${input.escapeHatch}${input.reason ? ` · ${input.reason}` : ""}`,
          metadata: { taskId: task.id, escapeHatch: input.escapeHatch },
        });
      }
      return escape;
    },

    async listCases(actor?: Partial<OpsActorContext> | null): Promise<OpsCaseRecord[]> {
      const derived = await ensureDerivedState();
      if (!actor) return derived.cases;
      const context = defaultActorContext(actor);
      return derived.cases.filter((row) => canActorSeeCase(context, row));
    },

    async getCase(caseId: string, actor?: Partial<OpsActorContext> | null): Promise<CaseDetail> {
      await ensureDerivedState();
      const context = actor ? defaultActorContext(actor) : null;
      const [record, notes, tasks, approvals] = await Promise.all([
        store.getCase(caseId),
        store.listCaseNotes(caseId, 100),
        store.listTasks(200),
        store.listApprovals(200),
      ]);
      return {
        record: record && context && !canActorSeeCase(context, record) ? null : record,
        notes,
        tasks: sortTasks(tasks.filter((row) => row.caseId === caseId && (!context || canActorSeeTask(context, row)))),
        approvals: sortApprovals(approvals.filter((row) => row.caseId === caseId && (!context || canActorSeeApproval(context, row)))),
      };
    },

    async addCaseNote(input: AddCaseNoteInput): Promise<OpsCaseNote> {
      const record = await ensureCaseRecord(cleanString(input.caseId) || "ops:chat");
      const note: OpsCaseNote = {
        id: makeId("ops_note"),
        caseId: record.id,
        actorId: cleanString(input.actorId) || "unknown-actor",
        actorKind: cleanString(input.actorKind) || "staff",
        body: cleanString(input.body) || "No note body supplied.",
        createdAt: clock(),
        metadata: input.metadata ?? {},
      };
      await store.appendCaseNote(note);
      await store.upsertCase({
        ...record,
        freshestAt: note.createdAt,
        updatedAt: note.createdAt,
        metadata: {
          ...record.metadata,
          lastNoteId: note.id,
        },
      });
      return note;
    },

    async listApprovals(actor?: Partial<OpsActorContext> | null): Promise<ApprovalItem[]> {
      const derived = await ensureDerivedState();
      if (!actor) return derived.approvals;
      const context = defaultActorContext(actor);
      return derived.approvals.filter((row) => canActorSeeApproval(context, row));
    },

    async resolveApproval(input: ResolveApprovalInput, actor: Partial<OpsActorContext>): Promise<ApprovalItem | null> {
      const approval = await store.getApproval(input.approvalId);
      if (!approval) return null;
      const context = defaultActorContext(actor);
      assertActorCanResolveApproval(context, approval);
      const currentIso = clock();
      const updated: ApprovalItem = {
        ...approval,
        status: input.status,
        resolvedAt: currentIso,
        resolvedBy: context.actorId,
        updatedAt: currentIso,
        metadata: {
          ...approval.metadata,
          resolutionNote: cleanNullableString(input.note),
        },
      };
      await store.upsertApproval(updated);
      await recordActionReceipt(`approval:${approval.id}:${currentIso}`, "ops", "approval_resolved", "confirmed", `Approval ${approval.id} was ${input.status}.`, {
        approvalId: approval.id,
        actorId: context.actorId,
        status: input.status,
      });
      return updated;
    },

    async getDisplayState(stationId: string): Promise<StationDisplayState> {
      const snapshot = await service.getPortalSnapshot();
      const station = await store.getStationSession(stationId);
      const tasks = snapshot.tasks.filter((row) => row.surface === "hands" && row.status !== "canceled");
      const focusTask = station?.currentTaskId ? tasks.find((row) => row.id === station.currentTaskId) ?? null : tasks[0] ?? null;
      return {
        generatedAt: clock(),
        station,
        truth: snapshot.truth,
        tasks: tasks.slice(0, 8),
        focusTask,
      };
    },

    async sendChat(surface: string, actor: Partial<OpsActorContext>, text: string): Promise<OpsChatResponse> {
      const normalizedSurface = cleanString(surface) || "manager";
      const context = defaultActorContext(actor);
      const snapshot = await service.getPortalSnapshot(context);
      const activeTasks = snapshot.tasks.filter((row) => !terminalTaskStatus(row.status));
      const topTask = activeTasks[0] ?? null;
      const note = await service.addCaseNote({
        caseId: normalizedSurface === "internet" ? "ops:chat:internet" : "ops:chat",
        actorId: context.actorId,
        body: text,
        metadata: { surface: normalizedSurface },
      });
      const reply =
        normalizedSurface === "internet"
          ? snapshot.approvals.filter((row) => row.status === "pending").length > 0
            ? `The internet lane sees ${snapshot.approvals.filter((row) => row.status === "pending").length} approval gate${snapshot.approvals.filter((row) => row.status === "pending").length === 1 ? "" : "s"}. The safest next move is to resolve those before pretending the thread can advance itself.`
            : topTask && topTask.surface === "internet"
              ? `The clearest next internet action is "${topTask.title}" because ${topTask.whyNow}`
              : `The internet lane is currently steady. ${snapshot.truth.summary}`
          : /why/i.test(text) && topTask
            ? `The manager assigned "${topTask.title}" because ${topTask.whyNow} It matters because ${topTask.consequenceIfDelayed}`
            : `Current studio risk: ${snapshot.twin.currentRisk || "none surfaced right now."} Next: ${snapshot.twin.nextActions[0] || "keep the truth rail healthy and continue sequencing work."}`;
      return {
        reply,
        note,
        caseId: note.caseId,
      };
    },

    async getSessionMe(actor: Partial<OpsActorContext>): Promise<OpsSessionMe> {
      const session = buildSession(defaultActorContext(actor));
      if (!session) {
        throw new Error("Unable to derive an ops session.");
      }
      return session;
    },

    async listMembers(actor: Partial<OpsActorContext>): Promise<MemberOpsRecord[]> {
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:view", "This actor is not allowed to view members.");
      return staffDataSource ? staffDataSource.listMembers(240) : [];
    },

    async getMember(uid: string, actor: Partial<OpsActorContext>): Promise<MemberOpsRecord | null> {
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:view", "This actor is not allowed to view members.");
      return staffDataSource ? staffDataSource.getMember(uid) : null;
    },

    async createMember(
      input: {
        email: string;
        displayName: string;
        membershipTier?: string | null;
        portalRole?: OpsPortalRole;
        opsRoles?: OpsHumanRole[];
        kilnPreferences?: string | null;
        staffNotes?: string | null;
        reason?: string | null;
      },
      actor: Partial<OpsActorContext>,
    ): Promise<{ member: MemberOpsRecord | null; audit: OpsMemberAuditRecord; created: CreateMemberRecord } | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:create", "This actor is not allowed to create members.");
      if (!cleanString(input.email) || !cleanString(input.displayName)) {
        throw new Error("New members need at least an email and display name.");
      }
      if ((input.opsRoles ?? []).includes("owner") && !hasOpsCapability(context.opsCapabilities, "members:edit_owner_role")) {
        throw new Error("Only the owner can create another owner-level member.");
      }
      const result = await staffDataSource.createMember({
        actorId: context.actorId,
        email: input.email,
        displayName: input.displayName,
        membershipTier: input.membershipTier,
        portalRole: input.portalRole,
        opsRoles: input.opsRoles,
        kilnPreferences: input.kilnPreferences,
        staffNotes: input.staffNotes,
        reason: input.reason,
      });
      await store.appendMemberAudit(result.audit);
      return result;
    },

    async updateMemberProfile(
      input: {
        uid: string;
        patch: {
          displayName?: string | null;
          membershipTier?: string | null;
          kilnPreferences?: string | null;
          staffNotes?: string | null;
        };
        reason?: string | null;
      },
      actor: Partial<OpsActorContext>,
    ): Promise<{ member: MemberOpsRecord | null; audit: OpsMemberAuditRecord } | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:edit_profile", "This actor is not allowed to edit member profiles.");
      const result = await staffDataSource.updateMemberProfile({
        uid: input.uid,
        actorId: context.actorId,
        patch: input.patch,
        reason: input.reason,
      });
      await store.appendMemberAudit(result.audit);
      return result;
    },

    async updateMemberBilling(
      input: {
        uid: string;
        billing: {
          stripeCustomerId?: string | null;
          defaultPaymentMethodId?: string | null;
          cardBrand?: string | null;
          cardLast4?: string | null;
          expMonth?: string | null;
          expYear?: string | null;
          billingContactName?: string | null;
          billingContactEmail?: string | null;
          billingContactPhone?: string | null;
        };
        reason?: string | null;
      },
      actor: Partial<OpsActorContext>,
    ): Promise<{ member: MemberOpsRecord | null; audit: OpsMemberAuditRecord } | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:edit_billing", "This actor is not allowed to edit member billing profiles.");
      const result = await staffDataSource.updateMemberBilling({
        uid: input.uid,
        actorId: context.actorId,
        billing: input.billing,
        reason: input.reason,
      });
      await store.appendMemberAudit(result.audit);
      return result;
    },

    async updateMemberMembership(
      input: { uid: string; membershipTier: string | null; reason?: string | null },
      actor: Partial<OpsActorContext>,
    ): Promise<{ member: MemberOpsRecord | null; audit: MembershipChangeRecord & { summary: string } } | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:edit_membership", "This actor is not allowed to edit memberships.");
      const result = await staffDataSource.updateMemberMembership({
        uid: input.uid,
        actorId: context.actorId,
        membershipTier: input.membershipTier,
        reason: input.reason,
      });
      await store.appendMemberAudit({
        id: result.audit.id,
        uid: result.audit.uid,
        kind: "membership",
        actorId: context.actorId,
        summary: result.audit.summary,
        reason: result.audit.reason,
        createdAt: result.audit.createdAt,
        payload: result.audit,
      });
      return result;
    },

    async updateMemberRole(
      input: { uid: string; portalRole: OpsPortalRole; opsRoles: OpsHumanRole[]; reason?: string | null },
      actor: Partial<OpsActorContext>,
    ): Promise<{ member: MemberOpsRecord | null; audit: RoleChangeRecord & { summary: string } } | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:edit_role", "This actor is not allowed to change member roles.");
      if (input.uid === context.actorId) {
        throw new Error("Use another authorized session to change your own role.");
      }
      if (input.opsRoles.includes("owner") && !hasOpsCapability(context.opsCapabilities, "members:edit_owner_role")) {
        throw new Error("Only the owner can assign or remove owner access.");
      }
      const result = await staffDataSource.updateMemberRole({
        uid: input.uid,
        actorId: context.actorId,
        portalRole: input.portalRole,
        opsRoles: input.opsRoles,
        reason: input.reason,
      });
      await store.appendMemberAudit({
        id: result.audit.id,
        uid: result.audit.uid,
        kind: "role",
        actorId: context.actorId,
        summary: result.audit.summary,
        reason: result.audit.reason,
        createdAt: result.audit.createdAt,
        payload: result.audit,
      });
      return result;
    },

    async getMemberActivity(uid: string, actor: Partial<OpsActorContext>): Promise<MemberActivityRecord | null> {
      if (!staffDataSource) return null;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "members:view", "This actor is not allowed to view member activity.");
      return staffDataSource.getMemberActivity(uid);
    },

    async listReservations(actor?: Partial<OpsActorContext> | null): Promise<ReservationBundle[]> {
      const derived = await ensureDerivedState();
      if (!actor) return derived.reservations;
      const context = defaultActorContext(actor);
      assertActorCapability(context, "reservations:view", "This actor is not allowed to view reservation bundles.");
      return derived.reservations;
    },

    async getReservationBundle(id: string, actor?: Partial<OpsActorContext> | null): Promise<ReservationBundle | null> {
      const derived = await ensureDerivedState();
      if (actor) {
        const context = defaultActorContext(actor);
        assertActorCapability(context, "reservations:view", "This actor is not allowed to view reservation bundles.");
      }
      return derived.reservations.find((row) => row.reservationId === id || row.id === id) ?? null;
    },

    async prepareReservation(id: string, actor: Partial<OpsActorContext>): Promise<HumanTaskRecord | null> {
      const context = defaultActorContext(actor);
      assertActorCapability(context, "reservations:prepare", "This actor is not allowed to prepare reservations.");
      const bundle = await service.getReservationBundle(id, context);
      if (!bundle) return null;
      return store.getTask(`task_reservation_prepare_${bundle.reservationId}`);
    },

    async listEvents(actor?: Partial<OpsActorContext> | null): Promise<OpsEventRecord[]> {
      const derived = await ensureDerivedState();
      if (actor) {
        const context = defaultActorContext(actor);
        assertActorCapability(context, "events:view", "This actor is not allowed to view events.");
      }
      return derived.events;
    },

    async listReports(actor?: Partial<OpsActorContext> | null): Promise<OpsReportRecord[]> {
      const derived = await ensureDerivedState();
      if (actor) {
        const context = defaultActorContext(actor);
        assertActorCapability(context, "reports:view", "This actor is not allowed to view reports.");
      }
      return derived.reports;
    },

    async getLending(actor?: Partial<OpsActorContext> | null): Promise<OpsLendingSnapshot | null> {
      const derived = await ensureDerivedState();
      if (actor) {
        const context = defaultActorContext(actor);
        assertActorCapability(context, "lending:view", "This actor is not allowed to view lending.");
      }
      return derived.lending;
    },

    async requestOverride(input: OverrideRequestInput, actor: Partial<OpsActorContext>): Promise<OverrideReceipt> {
      const context = defaultActorContext(actor);
      assertActorCapability(context, "overrides:request", "This actor is not allowed to request overrides.");
      const record: OverrideReceipt = {
        id: makeId("ops_override"),
        actorId: context.actorId,
        scope: cleanString(input.scope) || "manual",
        reason: cleanString(input.reason) || "Manual override requested.",
        expiresAt: cleanNullableString(input.expiresAt),
        requiredRole: input.requiredRole ?? "owner",
        metadata: input.metadata ?? {},
        status: "pending",
        createdAt: clock(),
        resolvedAt: null,
        resolvedBy: null,
      };
      await store.upsertOverride(record);
      return record;
    },

    async listOverrides(actor: Partial<OpsActorContext>): Promise<OverrideReceipt[]> {
      const context = defaultActorContext(actor);
      if (!context.opsRoles.includes("owner") && !hasOpsCapability(context.opsCapabilities, "overrides:approve")) {
        return [];
      }
      return store.listOverrides(120);
    },

    async listGrowthExperiments(): Promise<GrowthExperiment[]> {
      return store.listGrowthExperiments(40);
    },

    async createGrowthExperiment(record: GrowthExperiment): Promise<void> {
      await store.upsertGrowthExperiment(record);
    },

    async listImprovementCases(): Promise<ImprovementCase[]> {
      return store.listImprovementCases(40);
    },

    async createImprovementCase(record: ImprovementCase): Promise<void> {
      await store.upsertImprovementCase(record);
    },

    async createStationSession(record: StationSession): Promise<void> {
      await store.upsertStationSession(record);
    },
  };

  return service;
}

export type OpsService = ReturnType<typeof createOpsService>;
