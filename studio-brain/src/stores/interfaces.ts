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
