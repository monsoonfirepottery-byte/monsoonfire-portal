import crypto from "node:crypto";

export const verificationClasses = ["observed", "inferred", "planned", "claimed", "confirmed"] as const;
export type VerificationClass = (typeof verificationClasses)[number];

export const opsDegradeModes = [
  "observe_only",
  "draft_only",
  "no_human_tasking",
  "manual_dispatch_only",
  "internet_pause",
  "growth_pause",
  "forge_pause",
] as const;
export type OpsDegradeMode = (typeof opsDegradeModes)[number];

export const opsSurfaceIds = ["owner", "manager", "hands", "internet", "ceo", "forge"] as const;
export type OpsSurfaceId = (typeof opsSurfaceIds)[number];

export const opsSurfaceModes = {
  owner: ["brief", "approvals", "finance", "identity"],
  manager: ["overview", "live", "truth", "operations", "commitments", "trust"],
  hands: ["now", "queue", "checkins", "production", "firings", "lending", "lending-intake"],
  internet: ["desk", "member-ops", "events", "support", "reputation"],
  ceo: ["portfolio", "community", "campaigns"],
  forge: ["lab", "policy-agent-ops", "telemetry", "migration"],
} as const satisfies Record<OpsSurfaceId, readonly string[]>;
export type OpsSurfaceModeMap = typeof opsSurfaceModes;
export type OpsSurfaceMode = OpsSurfaceModeMap[OpsSurfaceId][number];

export const opsHumanRoles = [
  "owner",
  "member_ops",
  "support_ops",
  "kiln_lead",
  "floor_staff",
  "events_ops",
  "library_ops",
  "finance_ops",
] as const;
export type OpsHumanRole = (typeof opsHumanRoles)[number];

export type OpsAssignableRole = OpsHumanRole | "studio_manager" | "any_staff";

export const opsCapabilities = [
  "surface:owner",
  "surface:manager",
  "surface:hands",
  "surface:internet",
  "surface:ceo",
  "surface:forge",
  "members:view",
  "members:edit_profile",
  "members:edit_membership",
  "members:edit_role",
  "members:edit_owner_role",
  "approvals:view",
  "approvals:manage",
  "tasks:claim:any",
  "tasks:escape",
  "proof:submit",
  "proof:accept",
  "reservations:view",
  "reservations:prepare",
  "events:view",
  "reports:view",
  "lending:view",
  "finance:view",
  "finance:act",
  "overrides:request",
  "overrides:approve",
  "identity:manage",
  "strategy:ceo",
  "forge:manage",
] as const;
export type OpsCapability = (typeof opsCapabilities)[number];

const roleCapabilityMap: Record<OpsHumanRole, readonly OpsCapability[]> = {
  owner: [
    "surface:owner",
    "surface:manager",
    "surface:hands",
    "surface:internet",
    "surface:ceo",
    "surface:forge",
    "members:view",
    "members:edit_profile",
    "members:edit_membership",
    "members:edit_role",
    "members:edit_owner_role",
    "approvals:view",
    "approvals:manage",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "proof:accept",
    "reservations:view",
    "reservations:prepare",
    "events:view",
    "reports:view",
    "lending:view",
    "finance:view",
    "finance:act",
    "overrides:request",
    "overrides:approve",
    "identity:manage",
    "strategy:ceo",
    "forge:manage",
  ],
  member_ops: [
    "surface:internet",
    "members:view",
    "members:edit_profile",
    "members:edit_membership",
    "members:edit_role",
    "approvals:view",
    "tasks:escape",
    "proof:submit",
    "reservations:view",
    "events:view",
    "overrides:request",
  ],
  support_ops: [
    "surface:internet",
    "members:view",
    "members:edit_profile",
    "members:edit_membership",
    "members:edit_role",
    "approvals:view",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "proof:accept",
    "reservations:view",
    "events:view",
    "reports:view",
    "overrides:request",
  ],
  kiln_lead: [
    "surface:hands",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "proof:accept",
    "reservations:view",
    "reservations:prepare",
    "overrides:request",
  ],
  floor_staff: [
    "surface:hands",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "reservations:view",
    "overrides:request",
  ],
  events_ops: [
    "surface:internet",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "reservations:view",
    "events:view",
    "overrides:request",
  ],
  library_ops: [
    "surface:hands",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "lending:view",
    "overrides:request",
  ],
  finance_ops: [
    "surface:owner",
    "approvals:view",
    "finance:view",
    "overrides:request",
  ],
};

export function normalizeOpsHumanRole(value: unknown): OpsHumanRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return opsHumanRoles.find((entry) => entry === normalized) ?? null;
}

export function normalizeOpsHumanRoles(values: unknown): OpsHumanRole[] {
  const next = new Set<OpsHumanRole>();
  const source = Array.isArray(values) ? values : [values];
  for (const entry of source) {
    const normalized = normalizeOpsHumanRole(entry);
    if (normalized) next.add(normalized);
  }
  return [...next];
}

export function deriveOpsCapabilities(roles: OpsHumanRole[]): OpsCapability[] {
  const next = new Set<OpsCapability>();
  for (const role of roles) {
    for (const capability of roleCapabilityMap[role] ?? []) {
      next.add(capability);
    }
  }
  return [...next];
}

export function allowedSurfacesForCapabilities(capabilities: OpsCapability[]): OpsSurfaceId[] {
  const allowed = new Set<OpsSurfaceId>();
  for (const capability of capabilities) {
    const match = capability.match(/^surface:(.+)$/);
    if (!match?.[1]) continue;
    const surface = opsSurfaceIds.find((entry) => entry === match[1]);
    if (surface) allowed.add(surface);
  }
  return opsSurfaceIds.filter((entry) => allowed.has(entry));
}

export function allowedModesForSurface(surface: OpsSurfaceId, capabilities: OpsCapability[]): string[] {
  if (!allowedSurfacesForCapabilities(capabilities).includes(surface)) return [];
  return [...opsSurfaceModes[surface]];
}

export function hasOpsCapability(capabilities: readonly OpsCapability[], capability: OpsCapability): boolean {
  return capabilities.includes(capability);
}

export function canAccessOpsSurface(capabilities: readonly OpsCapability[], surface: string): surface is OpsSurfaceId {
  const normalized = opsSurfaceIds.find((entry) => entry === surface);
  if (!normalized) return false;
  return hasOpsCapability(capabilities, `surface:${normalized}` as OpsCapability);
}

export function canAccessOpsMode(
  capabilities: readonly OpsCapability[],
  surface: string,
  mode: string,
): boolean {
  if (!canAccessOpsSurface(capabilities, surface)) return false;
  return (opsSurfaceModes[surface] as readonly string[]).includes(mode);
}

export type OpsPortalRole = "member" | "staff" | "admin";
export type OpsReadiness = "ready" | "degraded" | "blocked";
export type OpsHealth = "healthy" | "warning" | "critical";

export type OpsSourceRef = {
  id: string;
  system: string;
  label: string;
  kind?: string | null;
  href?: string | null;
  observedAt: string | null;
  freshnessMs: number | null;
};

export type OpsEvidenceSummary = {
  summary: string;
  sources: OpsSourceRef[];
  freshestAt: string | null;
  confidence: number;
  degradeReason: string | null;
  verificationClass: VerificationClass;
};

export type OpsChecklistItem = {
  id: string;
  label: string;
  detail?: string | null;
  status: "todo" | "done" | "blocked";
};

export type OpsProofRequirement = {
  preferredMode: ProofMode;
  fallbackModes: ProofMode[];
  doneDefinition: string;
  fallbackIfSignalMissing: string;
};

export type OpsSurfacePolicy = {
  surface: OpsSurfaceId;
  modes: string[];
};

export type OpsSessionMe = {
  actorId: string;
  portalRole: OpsPortalRole;
  isStaff: boolean;
  opsRoles: OpsHumanRole[];
  opsCapabilities: OpsCapability[];
  allowedSurfaces: OpsSurfaceId[];
  allowedModes: Record<OpsSurfaceId, string[]>;
};

export type OpsWorldEvent = {
  id: string;
  eventType: string;
  eventVersion: number;
  entityKind: string;
  entityId: string;
  caseId: string | null;
  sourceSystem: string;
  sourceEventId: string;
  dedupeKey: string;
  roomId: string | null;
  actorKind: string;
  actorId: string;
  confidence: number;
  occurredAt: string;
  ingestedAt: string;
  verificationClass: VerificationClass;
  payload: Record<string, unknown>;
  artifactRefs: string[];
};

export type OpsIngestReceipt = {
  id: string;
  sourceSystem: string;
  sourceEventId: string;
  payloadHash: string;
  authPrincipal: string;
  receivedAt: string;
  timestampSkewSeconds: number;
};

export const opsCaseKinds = [
  "kiln_run",
  "arrival",
  "support_thread",
  "event",
  "anomaly",
  "complaint",
  "growth_experiment",
  "improvement_case",
  "station_session",
  "general",
] as const;
export type OpsCaseKind = (typeof opsCaseKinds)[number];

export const opsPriorityLevels = ["p0", "p1", "p2", "p3"] as const;
export type OpsPriority = (typeof opsPriorityLevels)[number];

export const opsCaseStatuses = [
  "open",
  "active",
  "blocked",
  "awaiting_approval",
  "resolved",
  "canceled",
] as const;
export type OpsCaseStatus = (typeof opsCaseStatuses)[number];

export type OpsCaseRecord = {
  id: string;
  kind: OpsCaseKind;
  title: string;
  summary: string;
  status: OpsCaseStatus;
  priority: OpsPriority;
  lane: OpsSurfaceId;
  ownerRole: string | null;
  verificationClass: VerificationClass;
  freshestAt: string | null;
  sources: OpsSourceRef[];
  confidence: number;
  degradeReason: string | null;
  dueAt: string | null;
  linkedEntityKind: string | null;
  linkedEntityId: string | null;
  memoryScope: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type OpsCaseNote = {
  id: string;
  caseId: string;
  actorId: string;
  actorKind: string;
  body: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export const humanTaskStatuses = [
  "proposed",
  "queued",
  "claimed",
  "in_progress",
  "blocked",
  "proof_pending",
  "verified",
  "reopened",
  "canceled",
] as const;
export type HumanTaskStatus = (typeof humanTaskStatuses)[number];

export const proofModes = [
  "manual_confirm",
  "qr_scan",
  "camera_snapshot",
  "sensor_transition",
  "dual_confirm",
] as const;
export type ProofMode = (typeof proofModes)[number];

export const approvalStatuses = ["pending", "approved", "rejected", "executed", "expired"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const taskEscapeHatches = [
  "need_help",
  "unsafe",
  "missing_tool",
  "not_my_role",
  "already_done",
  "defer_with_reason",
] as const;
export type TaskEscapeHatch = (typeof taskEscapeHatches)[number];

export type HumanTaskRecord = {
  id: string;
  caseId: string | null;
  title: string;
  status: HumanTaskStatus;
  priority: OpsPriority;
  surface: Extract<OpsSurfaceId, "hands" | "internet" | "manager" | "owner">;
  role: OpsAssignableRole | string;
  zone: string;
  dueAt: string | null;
  etaMinutes: number | null;
  toolsNeeded: string[];
  interruptibility: "now" | "soon" | "queue";
  whyNow: string;
  whyYou: string;
  evidenceSummary: string;
  consequenceIfDelayed: string;
  instructions: string[];
  checklist: OpsChecklistItem[];
  doneDefinition: string;
  proofModes: ProofMode[];
  preferredProofMode: ProofMode;
  fallbackIfSignalMissing: string;
  verificationClass: VerificationClass;
  freshestAt: string | null;
  sources: OpsSourceRef[];
  confidence: number;
  degradeReason: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  blockerReason: string | null;
  blockerEscapeHatches: TaskEscapeHatch[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type TaskProofRecord = {
  id: string;
  taskId: string;
  mode: ProofMode;
  actorId: string;
  verificationStatus: "submitted" | "accepted" | "rejected" | "readback_pending";
  note: string | null;
  artifactRefs: string[];
  createdAt: string;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  readbackReceiptId?: string | null;
};

export type ProofVerificationRecord = {
  id: string;
  taskId: string;
  proofId: string;
  actorId: string;
  status: TaskProofRecord["verificationStatus"];
  note: string | null;
  createdAt: string;
  readbackReceiptId: string | null;
};

export type ReadbackReceipt = {
  id: string;
  taskId: string | null;
  actionId: string | null;
  sourceSystem: string;
  verificationClass: VerificationClass;
  observedAt: string;
  summary: string;
  payload: Record<string, unknown>;
};

export type ApprovalItem = {
  id: string;
  caseId: string | null;
  title: string;
  summary: string;
  status: ApprovalStatus;
  actionClass: string;
  requestedBy: string;
  requiredRole: OpsHumanRole | string;
  riskSummary: string;
  reversibility: "reversible" | "hard_to_reverse" | "irreversible";
  verificationClass: VerificationClass;
  freshestAt: string | null;
  sources: OpsSourceRef[];
  confidence: number;
  degradeReason: string | null;
  recommendation: string;
  rollbackPlan: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  metadata: Record<string, unknown>;
};

export type ActionEffectReceipt = {
  id: string;
  actionId: string;
  sourceSystem: string;
  effectType: string;
  verificationClass: VerificationClass;
  observedAt: string;
  summary: string;
  payload: Record<string, unknown>;
};

export type GrowthExperiment = {
  id: string;
  title: string;
  hypothesis: string;
  status: "proposed" | "running" | "paused" | "completed";
  summary: string;
  safetyBoundaries: string[];
  owner: string;
  createdAt: string;
  updatedAt: string;
  metrics: Record<string, number | string | null>;
};

export type ImprovementCase = {
  id: string;
  title: string;
  problem: string;
  status: "open" | "evaluating" | "approved" | "shadow" | "rejected" | "shipped";
  summary: string;
  requiredEvaluations: string[];
  rollbackPlan: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type StationSession = {
  id: string;
  stationId: string;
  roomId: string;
  surfaceMode: "ambient_board" | "focus_task" | "proof_station";
  capabilities: string[];
  currentTaskId: string | null;
  actorId: string | null;
  lastSeenAt: string;
};

export type MemberOpsRecord = {
  uid: string;
  email: string | null;
  displayName: string;
  membershipTier: string | null;
  kilnPreferences: string | null;
  staffNotes: string | null;
  portalRole: OpsPortalRole;
  opsRoles: OpsHumanRole[];
  opsCapabilities: OpsCapability[];
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
  metadata: Record<string, unknown>;
};

export type MembershipChangeRecord = {
  id: string;
  uid: string;
  editedByUid: string;
  beforeTier: string | null;
  afterTier: string | null;
  reason: string | null;
  createdAt: string;
};

export type RoleChangeRecord = {
  id: string;
  uid: string;
  editedByUid: string;
  beforePortalRole: OpsPortalRole;
  afterPortalRole: OpsPortalRole;
  beforeOpsRoles: OpsHumanRole[];
  afterOpsRoles: OpsHumanRole[];
  reason: string | null;
  createdAt: string;
};

export type MemberActivityRecord = {
  uid: string;
  reservations: number;
  libraryLoans: number;
  supportThreads: number;
  events: number;
  lastReservationAt: string | null;
  lastLoanAt: string | null;
  lastEventAt: string | null;
};

export type OpsMemberAuditRecord = {
  id: string;
  uid: string;
  kind: "profile" | "membership" | "role";
  actorId: string;
  summary: string;
  reason: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ArrivalBundle = {
  status: string;
  dueAt: string | null;
  arrivedAt: string | null;
  summary: string;
  confidence: number;
  verificationClass: VerificationClass;
};

export type PrepBundle = {
  summary: string;
  actions: string[];
  toolsNeeded: string[];
  assignedRole: OpsAssignableRole | string;
};

export type ReservationBundle = {
  id: string;
  reservationId: string;
  title: string;
  status: string;
  ownerUid: string | null;
  displayName: string;
  firingType: string;
  dueAt: string | null;
  itemCount: number;
  shelfEquivalent: number;
  notes: string | null;
  arrival: ArrivalBundle;
  prep: PrepBundle;
  linkedTaskIds: string[];
  verificationClass: VerificationClass;
  freshestAt: string | null;
  sources: OpsSourceRef[];
  confidence: number;
  degradeReason: string | null;
  metadata: Record<string, unknown>;
};

export type OpsEventRecord = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  remainingCapacity: number | null;
  capacity: number | null;
  waitlistCount: number | null;
  location: string | null;
  priceCents: number | null;
  lastStatusReason: string | null;
  lastStatusChangedAt: string | null;
};

export type OpsReportRecord = {
  id: string;
  status: string;
  severity: string;
  summary: string;
  createdAt: string | null;
  ownerUid: string | null;
};

export type OpsLendingRequestRecord = {
  id: string;
  status: string;
  requesterUid: string | null;
  requesterName: string | null;
  title: string;
  createdAt: string | null;
};

export type OpsLendingLoanRecord = {
  id: string;
  status: string;
  borrowerUid: string | null;
  borrowerName: string | null;
  title: string;
  createdAt: string | null;
  dueAt: string | null;
};

export type OpsLendingSnapshot = {
  requests: OpsLendingRequestRecord[];
  loans: OpsLendingLoanRecord[];
  recommendationCount: number;
  tagSubmissionCount: number;
  coverReviewCount: number;
};

export type TaskEscapeRecord = {
  id: string;
  taskId: string;
  caseId: string | null;
  actorId: string;
  escapeHatch: TaskEscapeHatch;
  reason: string | null;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  metadata: Record<string, unknown>;
};

export type OverrideRequest = {
  id: string;
  actorId: string;
  scope: string;
  reason: string;
  expiresAt: string | null;
  requiredRole: OpsHumanRole | string;
  metadata: Record<string, unknown>;
};

export type OverrideReceipt = OverrideRequest & {
  status: "pending" | "active" | "expired" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type OpsSourceFreshness = {
  source: string;
  label: string;
  freshnessSeconds: number | null;
  budgetSeconds: number;
  status: OpsHealth;
  freshestAt: string | null;
  reason: string | null;
};

export type OpsWatchdog = {
  id: string;
  label: string;
  status: OpsHealth;
  summary: string;
  recommendation: string;
};

export type OpsTruthState = {
  generatedAt: string;
  readiness: OpsReadiness;
  summary: string;
  degradeModes: OpsDegradeMode[];
  sources: OpsSourceFreshness[];
  watchdogs: OpsWatchdog[];
  metrics: Record<string, number | string | boolean | null>;
};

export type OpsTwinZone = {
  id: string;
  label: string;
  status: OpsHealth;
  summary: string;
  nextAction: string | null;
  evidence: OpsEvidenceSummary;
};

export type OpsTwinState = {
  generatedAt: string;
  headline: string;
  narrative: string;
  currentRisk: string | null;
  commitmentsDueSoon: number;
  arrivalsExpectedSoon: number;
  zones: OpsTwinZone[];
  nextActions: string[];
};

export type OpsConversationThreadRecord = {
  id: string;
  surface: OpsSurfaceId;
  roleMask: string;
  senderIdentity: string;
  latestMessageAt: string;
  unread: boolean;
  summary: string;
};

export type OpsPortalSnapshot = {
  generatedAt: string;
  session: OpsSessionMe | null;
  twin: OpsTwinState;
  truth: OpsTruthState;
  tasks: HumanTaskRecord[];
  cases: OpsCaseRecord[];
  approvals: ApprovalItem[];
  ceo: GrowthExperiment[];
  forge: ImprovementCase[];
  conversations: OpsConversationThreadRecord[];
  members: MemberOpsRecord[];
  reservations: ReservationBundle[];
  events: OpsEventRecord[];
  reports: OpsReportRecord[];
  lending: OpsLendingSnapshot | null;
  taskEscapes: TaskEscapeRecord[];
  overrides: OverrideReceipt[];
};

export type StationDisplayState = {
  generatedAt: string;
  station: StationSession | null;
  truth: OpsTruthState;
  tasks: HumanTaskRecord[];
  focusTask: HumanTaskRecord | null;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableOpsHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function clampConfidence(value: unknown, fallback = 0.5): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const opsAuthStatuses = ["authorized", "denied", "degraded"] as const;
export type OpsAuthStatus = (typeof opsAuthStatuses)[number];

export type OpsAuthReceipt = {
  id: string;
  sourceSystem: string;
  actorId: string;
  actorKind: string;
  status: OpsAuthStatus;
  scopes: string[];
  summary: string;
  observedAt: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
};

export type OpsCase = OpsCaseRecord;
export type HumanTask = HumanTaskRecord;
export type IngestReceipt = OpsIngestReceipt;
export type AuthReceipt = OpsAuthReceipt;
export type OpsTwinSnapshot = OpsTwinState;
export type OpsTruthSnapshot = OpsTruthState;
export type OpsTaskView = {
  generatedAt: string;
  session: OpsSessionMe | null;
  twin: OpsTwinState;
  truth: OpsTruthState;
  tasks: HumanTaskRecord[];
  cases: OpsCaseRecord[];
  approvals: ApprovalItem[];
  growthExperiments: GrowthExperiment[];
  improvementCases: ImprovementCase[];
  stations: StationSession[];
  reservations: ReservationBundle[];
  events: OpsEventRecord[];
  reports: OpsReportRecord[];
  lending: OpsLendingSnapshot | null;
};
