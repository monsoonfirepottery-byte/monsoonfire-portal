import type {
  FiringEvent,
  FiringRun,
  Kiln,
  KilnCapabilityDocument,
  KilnHealthSnapshot,
  KilnImportRun,
  OperatorAction,
  RawArtifactRef,
  TelemetryPoint,
} from "./domain/model";

export type FiringRunQuery = {
  kilnId?: string;
  limit?: number;
  statuses?: string[];
  queueStates?: string[];
};

export type OperatorActionQuery = {
  kilnId?: string;
  firingRunId?: string;
  limit?: number;
  incompleteOnly?: boolean;
};

export interface KilnStore {
  upsertKiln(kiln: Kiln): Promise<void>;
  getKiln(id: string): Promise<Kiln | null>;
  listKilns(): Promise<Kiln[]>;

  saveCapabilityDocument(document: KilnCapabilityDocument): Promise<void>;
  getLatestCapabilityDocument(kilnId: string): Promise<KilnCapabilityDocument | null>;

  saveArtifactRecord(record: RawArtifactRef): Promise<void>;
  getArtifactRecord(id: string): Promise<RawArtifactRef | null>;
  findArtifactBySha256(sha256: string): Promise<RawArtifactRef | null>;
  listArtifactsForKiln(kilnId: string, limit?: number): Promise<RawArtifactRef[]>;

  saveImportRun(run: KilnImportRun): Promise<void>;
  getImportRun(id: string): Promise<KilnImportRun | null>;

  saveFiringRun(run: FiringRun): Promise<void>;
  getFiringRun(id: string): Promise<FiringRun | null>;
  findCurrentRunForKiln(kilnId: string): Promise<FiringRun | null>;
  listFiringRuns(query?: FiringRunQuery): Promise<FiringRun[]>;

  appendFiringEvents(events: FiringEvent[]): Promise<void>;
  listFiringEvents(firingRunId: string, limit?: number): Promise<FiringEvent[]>;

  appendTelemetryPoints(points: TelemetryPoint[]): Promise<void>;
  listTelemetryPoints(firingRunId: string, limit?: number): Promise<TelemetryPoint[]>;

  saveHealthSnapshot(snapshot: KilnHealthSnapshot): Promise<void>;
  getLatestHealthSnapshot(kilnId: string): Promise<KilnHealthSnapshot | null>;

  saveOperatorAction(action: OperatorAction): Promise<void>;
  listOperatorActions(query?: OperatorActionQuery): Promise<OperatorAction[]>;
}
