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
import type { FiringRunQuery, KilnStore, OperatorActionQuery } from "./store";

function sortByIsoDescending<T>(items: T[], readIso: (item: T) => string | null): T[] {
  return [...items].sort((left, right) => {
    const leftIso = readIso(left) ?? "";
    const rightIso = readIso(right) ?? "";
    return rightIso.localeCompare(leftIso);
  });
}

export class MemoryKilnStore implements KilnStore {
  private kilns = new Map<string, Kiln>();
  private capabilityDocs = new Map<string, KilnCapabilityDocument[]>();
  private artifacts = new Map<string, RawArtifactRef>();
  private importRuns = new Map<string, KilnImportRun>();
  private firingRuns = new Map<string, FiringRun>();
  private firingEvents = new Map<string, FiringEvent[]>();
  private telemetry = new Map<string, TelemetryPoint[]>();
  private healthSnapshots = new Map<string, KilnHealthSnapshot[]>();
  private operatorActions = new Map<string, OperatorAction>();

  async upsertKiln(kiln: Kiln): Promise<void> {
    this.kilns.set(kiln.id, { ...kiln });
  }

  async getKiln(id: string): Promise<Kiln | null> {
    return this.kilns.get(id) ?? null;
  }

  async listKilns(): Promise<Kiln[]> {
    return [...this.kilns.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async saveCapabilityDocument(document: KilnCapabilityDocument): Promise<void> {
    const current = this.capabilityDocs.get(document.kilnId) ?? [];
    const next = current.filter((entry) => entry.id !== document.id);
    next.push({ ...document });
    this.capabilityDocs.set(document.kilnId, sortByIsoDescending(next, (entry) => entry.generatedAt));
  }

  async getLatestCapabilityDocument(kilnId: string): Promise<KilnCapabilityDocument | null> {
    return this.capabilityDocs.get(kilnId)?.[0] ?? null;
  }

  async saveArtifactRecord(record: RawArtifactRef): Promise<void> {
    this.artifacts.set(record.id, { ...record, metadata: { ...record.metadata } });
  }

  async getArtifactRecord(id: string): Promise<RawArtifactRef | null> {
    return this.artifacts.get(id) ?? null;
  }

  async findArtifactBySha256(sha256: string): Promise<RawArtifactRef | null> {
    return [...this.artifacts.values()].find((entry) => entry.sha256 === sha256) ?? null;
  }

  async listArtifactsForKiln(kilnId: string, limit = 20): Promise<RawArtifactRef[]> {
    return sortByIsoDescending(
      [...this.artifacts.values()].filter((entry) => entry.kilnId === kilnId),
      (entry) => entry.observedAt,
    ).slice(0, Math.max(1, limit));
  }

  async saveImportRun(run: KilnImportRun): Promise<void> {
    this.importRuns.set(run.id, { ...run, diagnostics: { ...run.diagnostics } });
  }

  async getImportRun(id: string): Promise<KilnImportRun | null> {
    return this.importRuns.get(id) ?? null;
  }

  async saveFiringRun(run: FiringRun): Promise<void> {
    this.firingRuns.set(run.id, {
      ...run,
      rawArtifactRefs: [...run.rawArtifactRefs],
      linkedPortalRefs: {
        batchIds: [...run.linkedPortalRefs.batchIds],
        pieceIds: [...run.linkedPortalRefs.pieceIds],
        reservationIds: [...run.linkedPortalRefs.reservationIds],
        portalFiringId: run.linkedPortalRefs.portalFiringId,
      },
    });
  }

  async getFiringRun(id: string): Promise<FiringRun | null> {
    return this.firingRuns.get(id) ?? null;
  }

  async findCurrentRunForKiln(kilnId: string): Promise<FiringRun | null> {
    const openStatuses = new Set(["queued", "armed", "firing", "cooling"]);
    const matches = [...this.firingRuns.values()].filter(
      (entry) => entry.kilnId === kilnId && openStatuses.has(entry.status),
    );
    return sortByIsoDescending(matches, (entry) => entry.startTime ?? entry.operatorConfirmationAt ?? null)[0] ?? null;
  }

  async listFiringRuns(query: FiringRunQuery = {}): Promise<FiringRun[]> {
    let items = [...this.firingRuns.values()];
    if (query.kilnId) {
      items = items.filter((entry) => entry.kilnId === query.kilnId);
    }
    if (query.statuses?.length) {
      const allowed = new Set(query.statuses);
      items = items.filter((entry) => allowed.has(entry.status));
    }
    if (query.queueStates?.length) {
      const allowed = new Set(query.queueStates);
      items = items.filter((entry) => allowed.has(entry.queueState));
    }
    return sortByIsoDescending(items, (entry) => entry.startTime ?? entry.operatorConfirmationAt ?? null).slice(
      0,
      Math.max(1, query.limit ?? 50),
    );
  }

  async appendFiringEvents(events: FiringEvent[]): Promise<void> {
    for (const event of events) {
      const current = this.firingEvents.get(event.firingRunId) ?? [];
      current.push({ ...event, payloadJson: { ...event.payloadJson } });
      this.firingEvents.set(event.firingRunId, sortByIsoDescending(current, (entry) => entry.ts));
    }
  }

  async listFiringEvents(firingRunId: string, limit = 100): Promise<FiringEvent[]> {
    return sortByIsoDescending(this.firingEvents.get(firingRunId) ?? [], (entry) => entry.ts)
      .slice(0, Math.max(1, limit))
      .reverse();
  }

  async appendTelemetryPoints(points: TelemetryPoint[]): Promise<void> {
    for (const point of points) {
      const current = this.telemetry.get(point.firingRunId) ?? [];
      current.push({ ...point, rawPayload: { ...point.rawPayload } });
      current.sort((left, right) => left.ts.localeCompare(right.ts));
      this.telemetry.set(point.firingRunId, current);
    }
  }

  async listTelemetryPoints(firingRunId: string, limit = 500): Promise<TelemetryPoint[]> {
    const points = this.telemetry.get(firingRunId) ?? [];
    return points.slice(Math.max(0, points.length - Math.max(1, limit)));
  }

  async saveHealthSnapshot(snapshot: KilnHealthSnapshot): Promise<void> {
    const current = this.healthSnapshots.get(snapshot.kilnId) ?? [];
    const next = current.filter((entry) => entry.id !== snapshot.id);
    next.push({ ...snapshot, warnings: [...snapshot.warnings], confidenceNotes: [...snapshot.confidenceNotes] });
    this.healthSnapshots.set(snapshot.kilnId, sortByIsoDescending(next, (entry) => entry.ts));
  }

  async getLatestHealthSnapshot(kilnId: string): Promise<KilnHealthSnapshot | null> {
    return this.healthSnapshots.get(kilnId)?.[0] ?? null;
  }

  async saveOperatorAction(action: OperatorAction): Promise<void> {
    this.operatorActions.set(action.id, {
      ...action,
      checklistJson: { ...action.checklistJson },
    });
  }

  async listOperatorActions(query: OperatorActionQuery = {}): Promise<OperatorAction[]> {
    let items = [...this.operatorActions.values()];
    if (query.kilnId) {
      items = items.filter((entry) => entry.kilnId === query.kilnId);
    }
    if (query.firingRunId) {
      items = items.filter((entry) => entry.firingRunId === query.firingRunId);
    }
    if (query.incompleteOnly) {
      items = items.filter((entry) => !entry.completedAt);
    }
    return sortByIsoDescending(items, (entry) => entry.requestedAt).slice(0, Math.max(1, query.limit ?? 50));
  }
}
