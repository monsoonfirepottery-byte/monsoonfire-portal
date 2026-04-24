export type PartnerInitiativeState =
  | "quiet"
  | "monitoring"
  | "briefing"
  | "executing"
  | "cooldown"
  | "waiting_on_owner";

export type PartnerProgramId =
  | "daily_brief"
  | "open_loops_follow_up"
  | "exception_escalation"
  | "idle_time_momentum"
  | "weekly_reflection";

export type PartnerOpenLoopStatus = "open" | "delegated" | "paused" | "resolved";
export type PartnerCheckinAction = "ack" | "snooze" | "pause" | "redirect" | "why_this" | "continue";

export type PartnerPersona = {
  id: string;
  displayName: string;
  relationshipModel: "chief_of_staff";
  proactivity: "active";
  primarySurface: "codex_desktop_thread";
  sourceOfTruth: "control_tower";
  toneTraits: string[];
  summary: string;
};

export type PartnerProgram = {
  id: PartnerProgramId;
  label: string;
  trigger: string;
  scope: string;
  approvalGate: string;
  escalationRule: string;
  cooldown: string;
  stopCondition: string;
};

export type PartnerIdleBudget = {
  policy: "one_task_at_a_time";
  maxConcurrentTasks: number;
  maxAttemptsPerLoop: number;
  rankedBacklog: string[];
  verifyBeforeReport: boolean;
  contactOnlyOnMeaningfulChange: boolean;
};

export type PartnerOpenLoop = {
  id: string;
  title: string;
  status: PartnerOpenLoopStatus;
  summary: string;
  next: string;
  source: string;
  updatedAt: string;
  roomId: string | null;
  sessionName: string | null;
  decisionNeeded: string | null;
  verifiedContext: string[];
  evidence: string[];
};

export type PartnerCollaborationCommand = {
  command: "pause" | "redirect" | "why this" | "continue";
  description: string;
};

export type PartnerArtifacts = {
  latestBriefPath: string;
  checkinsPath: string;
  openLoopsPath: string;
};

export type PartnerBrief = {
  schema: "studio-brain.partner-brief.v1";
  generatedAt: string;
  persona: PartnerPersona;
  summary: string;
  initiativeState: PartnerInitiativeState;
  lastMeaningfulContactAt: string | null;
  nextCheckInAt: string | null;
  cooldownUntil: string | null;
  needsOwnerDecision: boolean;
  contactReason: string;
  verifiedContext: string[];
  singleDecisionNeeded: string | null;
  recommendedFocus: string;
  dailyNote: string;
  openLoops: PartnerOpenLoop[];
  idleBudget: PartnerIdleBudget;
  programs: PartnerProgram[];
  collaborationCommands: PartnerCollaborationCommand[];
  artifacts: PartnerArtifacts;
};

export type PartnerCheckinRecord = {
  schema: "studio-brain.partner-checkin.v1";
  id: string;
  action: PartnerCheckinAction;
  occurredAt: string;
  actorId: string;
  note: string | null;
  snoozeUntil: string | null;
};

export type AgentRuntimePartnerContext = {
  initiativeState: PartnerInitiativeState;
  lastMeaningfulContactAt: string | null;
  nextCheckInAt: string | null;
  cooldownUntil: string | null;
  openLoops: PartnerOpenLoop[];
  idleBudget: PartnerIdleBudget;
  needsOwnerDecision: boolean;
  contactReason: string;
  verifiedContext: string[];
  singleDecisionNeeded: string | null;
};
