import type { ActorType, ApprovalState, ExternalTarget, IntegrityHash, IsoDateString } from "../types/core";

export type StudioStateSnapshot = {
  schemaVersion: "v3.0";
  snapshotDate: IsoDateString;
  generatedAt: IsoDateString;
  cloudSync: {
    firestoreReadAt: IsoDateString;
    stripeReadAt: IsoDateString | null;
  };
  counts: {
    batchesActive: number;
    batchesClosed: number;
    reservationsOpen: number;
    firingsScheduled: number;
    reportsOpen: number;
  };
  ops: {
    agentRequestsPending: number;
    highSeverityReports: number;
  };
  finance: {
    pendingOrders: number;
    unsettledPayments: number;
  };
  sourceHashes: {
    firestore: IntegrityHash;
    stripe: IntegrityHash | null;
  };
  diagnostics?: {
    completeness: "full" | "partial";
    warnings: string[];
    sourceSample?: {
      batchesScanned: number;
      reservationsScanned: number;
      firingsScanned: number;
      reportsScanned: number;
    };
    durationsMs?: {
      firestoreRead: number;
      stripeRead: number;
    };
  };
};

export type StudioStateDiff = {
  fromSnapshotDate: IsoDateString;
  toSnapshotDate: IsoDateString;
  changes: Record<string, { from: number | string | null; to: number | string | null }>;
};

export type JobRunRecord = {
  id: string;
  jobName: string;
  status: "running" | "succeeded" | "failed";
  startedAt: IsoDateString;
  completedAt: IsoDateString | null;
  summary: string | null;
  errorMessage: string | null;
};

export type OverseerStatus = "ok" | "warning" | "critical";
export type OverseerSeverity = "info" | "warning" | "critical";
export type OverseerOpportunityLane = "portal" | "website" | "ops";
export type OverseerActionKind = "swarm_candidate" | "human_task" | "draft_outreach";
export type OverseerPriority = "p0" | "p1" | "p2" | "p3";

export type OverseerEvidence = {
  label: string;
  detail: string;
  path?: string | null;
};

export type OverseerPostureFacet = {
  status: OverseerStatus;
  summary: string;
  checkedAt: IsoDateString;
  evidence: OverseerEvidence[];
  metrics?: Record<string, number | string | boolean | null>;
};

export type OverseerSignalGap = {
  id: string;
  dedupeId: string;
  severity: OverseerSeverity;
  category: "auth" | "credentials" | "artifact" | "telemetry" | "connector" | "coordination" | "memory";
  title: string;
  summary: string;
  recommendation: string;
  evidence: OverseerEvidence[];
};

export type OverseerProductOpportunity = {
  id: string;
  dedupeId: string;
  lane: OverseerOpportunityLane;
  title: string;
  summary: string;
  confidence: number;
  draftOnly: true;
  evidence: OverseerEvidence[];
  sourcePaths: string[];
};

export type OverseerCoordinationAction = {
  id: string;
  dedupeId: string;
  kind: OverseerActionKind;
  priority: OverseerPriority;
  title: string;
  summary: string;
  rationale: string;
  ownerHint: string | null;
  evidence: OverseerEvidence[];
  proposalEligibility: {
    eligible: boolean;
    reason: string;
    capabilityId: string | null;
  };
  proposal?: {
    status: "created" | "existing" | "draft_only" | "ineligible";
    proposalId: string | null;
    capabilityId: string | null;
  };
  draft?: {
    channel: "discord" | "cli" | "email";
    subject: string;
    body: string;
  };
};

export type OverseerRunRecord = {
  runId: string;
  computedAt: IsoDateString;
  overallStatus: OverseerStatus;
  runtimePosture: {
    hostHealth: OverseerPostureFacet;
    schedulerHealth: OverseerPostureFacet;
    backupFreshness: OverseerPostureFacet;
    heartbeatFreshness: OverseerPostureFacet;
    authMintHealth: OverseerPostureFacet;
    connectorCoverage: OverseerPostureFacet;
  };
  signalGaps: OverseerSignalGap[];
  productOpportunities: OverseerProductOpportunity[];
  coordinationActions: OverseerCoordinationAction[];
  createdProposalIds: string[];
  delivery: {
    dedupeKey: string;
    changed: boolean;
    matchedRunId: string | null;
    discord: {
      enabled: boolean;
      shouldNotify: boolean;
      summary: string;
      lines: string[];
      detailPath?: string;
      target?: {
        guildId: string | null;
        channelId: string | null;
        applicationId: string | null;
        configured: boolean;
      };
      mcp?: {
        serverName: string;
        pluginId: string;
        setupDocPath: string;
      };
      sourceOfTruth?: {
        model: "openclaw-discord";
        primaryDocPath: string;
        upstreamDocsUrl: string;
        inspirationSources: string[];
      };
      ingest?: {
        enabled: boolean;
        source: "discord";
        endpointPath: string;
        guildId: string | null;
        channelId: string | null;
        clientRequestIdTemplate: string;
      };
      routing?: {
        dmScope: "main";
        guildSessions: "per_channel";
        threadSessions: "per_thread" | "disabled";
        sessionKeyTemplates: {
          dm: string;
          guildChannel: string;
          thread: string;
        };
        groupPolicy: "allowlist" | "open";
        requireMention: boolean;
        allowBots: "never" | "mentions" | "all";
        responsePrefix: string | null;
        allowlistedGuildIds: string[];
        allowlistedChannelIds: string[];
      };
      threadBindings?: {
        enabled: boolean;
        idleHours: number;
        maxAgeHours: number;
        replyChainFallback: boolean;
      };
      execApprovals?: {
        enabled: boolean;
        mode: "external_writes_only" | "disabled";
      };
      commandContracts?: {
        bot: Array<{
          command: string;
          description: string;
        }>;
        mcp: Array<{
          command: string;
          description: string;
        }>;
      };
      executionQueue?: Array<{
        actionId: string;
        dedupeId: string;
        kind: OverseerActionKind;
        priority: OverseerPriority;
        title: string;
        ownerHint: string | null;
        proposalStatus: "created" | "existing" | "draft_only" | "ineligible" | null;
        proposalId: string | null;
        draftChannel: "discord" | "cli" | "email" | null;
      }>;
      messageDraft?: {
        title: string;
        body: string;
      };
    };
    cli: {
      summary: string;
      detailPath: string;
      hints: string[];
    };
  };
};

export type AuditEvent = {
  id: string;
  at: IsoDateString;
  actorType: ActorType;
  actorId: string;
  action: string;
  rationale: string;
  target: ExternalTarget | "local";
  approvalState: ApprovalState;
  inputHash: IntegrityHash;
  outputHash: IntegrityHash | null;
  metadata: Record<string, unknown>;
};

export interface StateStore {
  saveStudioState(snapshot: StudioStateSnapshot): Promise<void>;
  getLatestStudioState(): Promise<StudioStateSnapshot | null>;
  getPreviousStudioState(beforeDate: IsoDateString): Promise<StudioStateSnapshot | null>;
  saveStudioStateDiff(diff: StudioStateDiff): Promise<void>;
  saveOverseerRun(run: OverseerRunRecord): Promise<void>;
  getLatestOverseerRun(): Promise<OverseerRunRecord | null>;
  listRecentOverseerRuns(limit: number): Promise<OverseerRunRecord[]>;
  listRecentJobRuns(limit: number): Promise<JobRunRecord[]>;

  startJobRun(jobName: string): Promise<JobRunRecord>;
  completeJobRun(id: string, summary: string): Promise<void>;
  failJobRun(id: string, errorMessage: string): Promise<void>;
}

export interface EventStore {
  append(event: Omit<AuditEvent, "id" | "at">): Promise<AuditEvent>;
  listRecent(limit: number): Promise<AuditEvent[]>;
}

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
