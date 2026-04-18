import { getPgPool } from "../db/postgres";
import type {
  ActionEffectReceipt,
  ApprovalItem,
  GrowthExperiment,
  HumanTaskRecord,
  ImprovementCase,
  MemberActivityRecord,
  OpsAuthReceipt,
  OpsMemberAuditRecord,
  OpsLendingSnapshot,
  OpsCaseNote,
  OpsCaseRecord,
  OpsDegradeMode,
  OpsEventRecord,
  OpsIngestReceipt,
  OverrideReceipt,
  ReservationBundle,
  TaskEscapeRecord,
  OpsSourceFreshness,
  OpsWatchdog,
  OpsWorldEvent,
  StationSession,
  TaskProofRecord,
} from "./contracts";
import { redactMemberAuditPayload } from "./pii";

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function asRecord<T>(row: unknown): T {
  return row as T;
}

type StoredPayload = {
  raw_payload: unknown;
};

export interface OpsStore {
  appendEvent(event: OpsWorldEvent, receipt: OpsIngestReceipt): Promise<void>;
  getIngestReceipt(sourceSystem: string, sourceEventId: string): Promise<OpsIngestReceipt | null>;
  listEvents(limit: number): Promise<OpsWorldEvent[]>;
  saveAuthReceipt(record: OpsAuthReceipt): Promise<void>;
  listAuthReceipts(limit: number): Promise<OpsAuthReceipt[]>;
  upsertCase(record: OpsCaseRecord): Promise<void>;
  getCase(id: string): Promise<OpsCaseRecord | null>;
  listCases(limit: number): Promise<OpsCaseRecord[]>;
  appendCaseNote(note: OpsCaseNote): Promise<void>;
  listCaseNotes(caseId: string, limit: number): Promise<OpsCaseNote[]>;
  upsertTask(record: HumanTaskRecord): Promise<void>;
  getTask(id: string): Promise<HumanTaskRecord | null>;
  listTasks(limit: number): Promise<HumanTaskRecord[]>;
  appendTaskProof(record: TaskProofRecord): Promise<void>;
  upsertTaskProof(record: TaskProofRecord): Promise<void>;
  listTaskProofs(taskId: string): Promise<TaskProofRecord[]>;
  appendTaskEscape(record: TaskEscapeRecord): Promise<void>;
  listTaskEscapes(taskId?: string, limit?: number): Promise<TaskEscapeRecord[]>;
  upsertApproval(record: ApprovalItem): Promise<void>;
  getApproval(id: string): Promise<ApprovalItem | null>;
  listApprovals(limit: number): Promise<ApprovalItem[]>;
  saveActionEffectReceipt(record: ActionEffectReceipt): Promise<void>;
  listActionEffectReceipts(actionId: string): Promise<ActionEffectReceipt[]>;
  upsertGrowthExperiment(record: GrowthExperiment): Promise<void>;
  listGrowthExperiments(limit: number): Promise<GrowthExperiment[]>;
  upsertImprovementCase(record: ImprovementCase): Promise<void>;
  listImprovementCases(limit: number): Promise<ImprovementCase[]>;
  upsertStationSession(record: StationSession): Promise<void>;
  getStationSession(stationId: string): Promise<StationSession | null>;
  listStationSessions(limit: number): Promise<StationSession[]>;
  setDegradeModes(modes: OpsDegradeMode[]): Promise<void>;
  getDegradeModes(): Promise<OpsDegradeMode[]>;
  saveSourceFreshness(rows: OpsSourceFreshness[]): Promise<void>;
  listSourceFreshness(): Promise<OpsSourceFreshness[]>;
  saveWatchdogs(rows: OpsWatchdog[]): Promise<void>;
  listWatchdogs(): Promise<OpsWatchdog[]>;
  upsertReservationBundle(record: ReservationBundle): Promise<void>;
  getReservationBundle(id: string): Promise<ReservationBundle | null>;
  listReservationBundles(limit: number): Promise<ReservationBundle[]>;
  upsertOverride(record: OverrideReceipt): Promise<void>;
  listOverrides(limit: number): Promise<OverrideReceipt[]>;
  appendMemberAudit(record: OpsMemberAuditRecord): Promise<void>;
  listMemberAudits(uid: string, limit: number): Promise<OpsMemberAuditRecord[]>;
}

export class MemoryOpsStore implements OpsStore {
  private readonly events = new Map<string, OpsWorldEvent>();
  private readonly receipts = new Map<string, OpsIngestReceipt>();
  private readonly authReceipts = new Map<string, OpsAuthReceipt>();
  private readonly cases = new Map<string, OpsCaseRecord>();
  private readonly caseNotes = new Map<string, OpsCaseNote[]>();
  private readonly tasks = new Map<string, HumanTaskRecord>();
  private readonly taskProofs = new Map<string, TaskProofRecord[]>();
  private readonly taskEscapes = new Map<string, TaskEscapeRecord>();
  private readonly approvals = new Map<string, ApprovalItem>();
  private readonly actionReceipts = new Map<string, ActionEffectReceipt[]>();
  private readonly growth = new Map<string, GrowthExperiment>();
  private readonly improvements = new Map<string, ImprovementCase>();
  private readonly stations = new Map<string, StationSession>();
  private readonly sourceFreshness = new Map<string, OpsSourceFreshness>();
  private readonly watchdogs = new Map<string, OpsWatchdog>();
  private readonly reservationBundles = new Map<string, ReservationBundle>();
  private readonly overrides = new Map<string, OverrideReceipt>();
  private readonly memberAudits = new Map<string, OpsMemberAuditRecord[]>();
  private degradeModes: OpsDegradeMode[] = [];

  async appendEvent(event: OpsWorldEvent, receipt: OpsIngestReceipt): Promise<void> {
    this.events.set(event.id, event);
    this.receipts.set(`${receipt.sourceSystem}:${receipt.sourceEventId}`, receipt);
  }
  async getIngestReceipt(sourceSystem: string, sourceEventId: string): Promise<OpsIngestReceipt | null> {
    return this.receipts.get(`${sourceSystem}:${sourceEventId}`) ?? null;
  }
  async listEvents(limit: number): Promise<OpsWorldEvent[]> {
    return [...this.events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }
  async saveAuthReceipt(record: OpsAuthReceipt): Promise<void> {
    this.authReceipts.set(record.id, record);
  }
  async listAuthReceipts(limit: number): Promise<OpsAuthReceipt[]> {
    return [...this.authReceipts.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, limit);
  }
  async upsertCase(record: OpsCaseRecord): Promise<void> {
    this.cases.set(record.id, record);
  }
  async getCase(id: string): Promise<OpsCaseRecord | null> {
    return this.cases.get(id) ?? null;
  }
  async listCases(limit: number): Promise<OpsCaseRecord[]> {
    return [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  async appendCaseNote(note: OpsCaseNote): Promise<void> {
    const list = this.caseNotes.get(note.caseId) ?? [];
    list.unshift(note);
    this.caseNotes.set(note.caseId, list);
  }
  async listCaseNotes(caseId: string, limit: number): Promise<OpsCaseNote[]> {
    return (this.caseNotes.get(caseId) ?? []).slice(0, limit);
  }
  async upsertTask(record: HumanTaskRecord): Promise<void> {
    this.tasks.set(record.id, record);
  }
  async getTask(id: string): Promise<HumanTaskRecord | null> {
    return this.tasks.get(id) ?? null;
  }
  async listTasks(limit: number): Promise<HumanTaskRecord[]> {
    return [...this.tasks.values()].sort((a, b) => {
      const dueCompare = (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
      if (dueCompare !== 0) return dueCompare;
      return b.updatedAt.localeCompare(a.updatedAt);
    }).slice(0, limit);
  }
  async appendTaskProof(record: TaskProofRecord): Promise<void> {
    await this.upsertTaskProof(record);
  }
  async upsertTaskProof(record: TaskProofRecord): Promise<void> {
    const list = this.taskProofs.get(record.taskId) ?? [];
    const next = list.filter((entry) => entry.id !== record.id);
    next.unshift(record);
    this.taskProofs.set(record.taskId, next);
  }
  async listTaskProofs(taskId: string): Promise<TaskProofRecord[]> {
    return this.taskProofs.get(taskId) ?? [];
  }
  async appendTaskEscape(record: TaskEscapeRecord): Promise<void> {
    this.taskEscapes.set(record.id, record);
  }
  async listTaskEscapes(taskId?: string, limit = 100): Promise<TaskEscapeRecord[]> {
    return [...this.taskEscapes.values()]
      .filter((entry) => !taskId || entry.taskId === taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async upsertApproval(record: ApprovalItem): Promise<void> {
    this.approvals.set(record.id, record);
  }
  async getApproval(id: string): Promise<ApprovalItem | null> {
    return this.approvals.get(id) ?? null;
  }
  async listApprovals(limit: number): Promise<ApprovalItem[]> {
    return [...this.approvals.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  async saveActionEffectReceipt(record: ActionEffectReceipt): Promise<void> {
    const list = this.actionReceipts.get(record.actionId) ?? [];
    list.unshift(record);
    this.actionReceipts.set(record.actionId, list);
  }
  async listActionEffectReceipts(actionId: string): Promise<ActionEffectReceipt[]> {
    return this.actionReceipts.get(actionId) ?? [];
  }
  async upsertGrowthExperiment(record: GrowthExperiment): Promise<void> {
    this.growth.set(record.id, record);
  }
  async listGrowthExperiments(limit: number): Promise<GrowthExperiment[]> {
    return [...this.growth.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  async upsertImprovementCase(record: ImprovementCase): Promise<void> {
    this.improvements.set(record.id, record);
  }
  async listImprovementCases(limit: number): Promise<ImprovementCase[]> {
    return [...this.improvements.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  async upsertStationSession(record: StationSession): Promise<void> {
    this.stations.set(record.stationId, record);
  }
  async getStationSession(stationId: string): Promise<StationSession | null> {
    return this.stations.get(stationId) ?? null;
  }
  async listStationSessions(limit: number): Promise<StationSession[]> {
    return [...this.stations.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit);
  }
  async setDegradeModes(modes: OpsDegradeMode[]): Promise<void> {
    this.degradeModes = [...modes];
  }
  async getDegradeModes(): Promise<OpsDegradeMode[]> {
    return [...this.degradeModes];
  }
  async saveSourceFreshness(rows: OpsSourceFreshness[]): Promise<void> {
    this.sourceFreshness.clear();
    for (const row of rows) this.sourceFreshness.set(row.source, row);
  }
  async listSourceFreshness(): Promise<OpsSourceFreshness[]> {
    return [...this.sourceFreshness.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  async saveWatchdogs(rows: OpsWatchdog[]): Promise<void> {
    this.watchdogs.clear();
    for (const row of rows) this.watchdogs.set(row.id, row);
  }
  async listWatchdogs(): Promise<OpsWatchdog[]> {
    return [...this.watchdogs.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  async upsertReservationBundle(record: ReservationBundle): Promise<void> {
    this.reservationBundles.set(record.id, record);
  }
  async getReservationBundle(id: string): Promise<ReservationBundle | null> {
    return this.reservationBundles.get(id) ?? null;
  }
  async listReservationBundles(limit: number): Promise<ReservationBundle[]> {
    return [...this.reservationBundles.values()]
      .sort((a, b) => String(a.dueAt ?? "9999").localeCompare(String(b.dueAt ?? "9999")))
      .slice(0, limit);
  }
  async upsertOverride(record: OverrideReceipt): Promise<void> {
    this.overrides.set(record.id, record);
  }
  async listOverrides(limit: number): Promise<OverrideReceipt[]> {
    return [...this.overrides.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async appendMemberAudit(record: OpsMemberAuditRecord): Promise<void> {
    const safeRecord = redactMemberAuditPayload(record);
    const list = this.memberAudits.get(safeRecord.uid) ?? [];
    list.unshift(safeRecord);
    this.memberAudits.set(safeRecord.uid, list);
  }
  async listMemberAudits(uid: string, limit: number): Promise<OpsMemberAuditRecord[]> {
    return (this.memberAudits.get(uid) ?? []).slice(0, limit).map((record) => redactMemberAuditPayload(record));
  }
}

export class PostgresOpsStore implements OpsStore {
  async appendEvent(event: OpsWorldEvent, receipt: OpsIngestReceipt): Promise<void> {
    const pool = getPgPool();
    await pool.query("BEGIN");
    try {
      await pool.query(
        `INSERT INTO brain_ops_ingest_receipts
         (id, source_system, source_event_id, payload_hash, auth_principal, received_at, timestamp_skew_seconds, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb)
         ON CONFLICT (source_system, source_event_id) DO NOTHING`,
        [
          receipt.id,
          receipt.sourceSystem,
          receipt.sourceEventId,
          receipt.payloadHash,
          receipt.authPrincipal,
          receipt.receivedAt,
          receipt.timestampSkewSeconds,
          stringify(receipt),
        ],
      );
      await pool.query(
        `INSERT INTO brain_ops_events
         (id, event_type, event_version, entity_kind, entity_id, case_id, source_system, source_event_id, dedupe_key, room_id, actor_kind, actor_id, confidence, occurred_at, ingested_at, verification_class, artifact_refs, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz,$16,$17::jsonb,$18::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           case_id = EXCLUDED.case_id,
           confidence = EXCLUDED.confidence,
           ingested_at = EXCLUDED.ingested_at,
           verification_class = EXCLUDED.verification_class,
           artifact_refs = EXCLUDED.artifact_refs,
           raw_payload = EXCLUDED.raw_payload`,
        [
          event.id,
          event.eventType,
          event.eventVersion,
          event.entityKind,
          event.entityId,
          event.caseId,
          event.sourceSystem,
          event.sourceEventId,
          event.dedupeKey,
          event.roomId,
          event.actorKind,
          event.actorId,
          event.confidence,
          event.occurredAt,
          event.ingestedAt,
          event.verificationClass,
          stringify(event.artifactRefs),
          stringify(event),
        ],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  async getIngestReceipt(sourceSystem: string, sourceEventId: string): Promise<OpsIngestReceipt | null> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_ingest_receipts WHERE source_system = $1 AND source_event_id = $2 LIMIT 1",
      [sourceSystem, sourceEventId],
    );
    return result.rowCount ? asRecord<OpsIngestReceipt>(result.rows[0].raw_payload) : null;
  }

  async listEvents(limit: number): Promise<OpsWorldEvent[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_events ORDER BY occurred_at DESC, ingested_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<OpsWorldEvent>((row as StoredPayload).raw_payload));
  }

  async saveAuthReceipt(record: OpsAuthReceipt): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_auth_receipts
       (id, source_system, actor_id, actor_kind, status, observed_at, expires_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_system = EXCLUDED.source_system,
         actor_id = EXCLUDED.actor_id,
         actor_kind = EXCLUDED.actor_kind,
         status = EXCLUDED.status,
         observed_at = EXCLUDED.observed_at,
         expires_at = EXCLUDED.expires_at,
         raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.sourceSystem, record.actorId, record.actorKind, record.status, record.observedAt, record.expiresAt, stringify(record)],
    );
  }

  async listAuthReceipts(limit: number): Promise<OpsAuthReceipt[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_auth_receipts ORDER BY observed_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<OpsAuthReceipt>((row as StoredPayload).raw_payload));
  }

  async upsertCase(record: OpsCaseRecord): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_cases
       (id, kind, title, status, priority, lane, owner_role, verification_class, freshest_at, confidence, degrade_reason, due_at, linked_entity_kind, linked_entity_id, memory_scope, created_at, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12::timestamptz,$13,$14,$15,$16::timestamptz,$17::timestamptz,$18::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         lane = EXCLUDED.lane,
         owner_role = EXCLUDED.owner_role,
         verification_class = EXCLUDED.verification_class,
         freshest_at = EXCLUDED.freshest_at,
         confidence = EXCLUDED.confidence,
         degrade_reason = EXCLUDED.degrade_reason,
         due_at = EXCLUDED.due_at,
         linked_entity_kind = EXCLUDED.linked_entity_kind,
         linked_entity_id = EXCLUDED.linked_entity_id,
         memory_scope = EXCLUDED.memory_scope,
         updated_at = EXCLUDED.updated_at,
         raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.kind,
        record.title,
        record.status,
        record.priority,
        record.lane,
        record.ownerRole,
        record.verificationClass,
        record.freshestAt,
        record.confidence,
        record.degradeReason,
        record.dueAt,
        record.linkedEntityKind,
        record.linkedEntityId,
        record.memoryScope,
        record.createdAt,
        record.updatedAt,
        stringify(record),
      ],
    );
  }

  async getCase(id: string): Promise<OpsCaseRecord | null> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_cases WHERE id = $1 LIMIT 1", [id]);
    return result.rowCount ? asRecord<OpsCaseRecord>(result.rows[0].raw_payload) : null;
  }

  async listCases(limit: number): Promise<OpsCaseRecord[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_cases ORDER BY updated_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<OpsCaseRecord>((row as StoredPayload).raw_payload));
  }

  async appendCaseNote(note: OpsCaseNote): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_case_notes (id, case_id, actor_id, actor_kind, body, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb)`,
      [note.id, note.caseId, note.actorId, note.actorKind, note.body, note.createdAt, stringify(note)],
    );
  }

  async listCaseNotes(caseId: string, limit: number): Promise<OpsCaseNote[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT $2",
      [caseId, Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<OpsCaseNote>((row as StoredPayload).raw_payload));
  }

  async upsertTask(record: HumanTaskRecord): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_tasks
       (id, case_id, title, status, priority, surface, role, zone, due_at, eta_minutes, interruptibility, verification_class, freshest_at, confidence, degrade_reason, claimed_by, claimed_at, completed_at, blocker_reason, created_at, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13::timestamptz,$14,$15,$16,$17::timestamptz,$18::timestamptz,$19,$20::timestamptz,$21::timestamptz,$22::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         case_id = EXCLUDED.case_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         surface = EXCLUDED.surface,
         role = EXCLUDED.role,
         zone = EXCLUDED.zone,
         due_at = EXCLUDED.due_at,
         eta_minutes = EXCLUDED.eta_minutes,
         interruptibility = EXCLUDED.interruptibility,
         verification_class = EXCLUDED.verification_class,
         freshest_at = EXCLUDED.freshest_at,
         confidence = EXCLUDED.confidence,
         degrade_reason = EXCLUDED.degrade_reason,
         claimed_by = EXCLUDED.claimed_by,
         claimed_at = EXCLUDED.claimed_at,
         completed_at = EXCLUDED.completed_at,
         blocker_reason = EXCLUDED.blocker_reason,
         updated_at = EXCLUDED.updated_at,
         raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.caseId,
        record.title,
        record.status,
        record.priority,
        record.surface,
        record.role,
        record.zone,
        record.dueAt,
        record.etaMinutes,
        record.interruptibility,
        record.verificationClass,
        record.freshestAt,
        record.confidence,
        record.degradeReason,
        record.claimedBy,
        record.claimedAt,
        record.completedAt,
        record.blockerReason,
        record.createdAt,
        record.updatedAt,
        stringify(record),
      ],
    );
  }

  async getTask(id: string): Promise<HumanTaskRecord | null> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_tasks WHERE id = $1 LIMIT 1", [id]);
    return result.rowCount ? asRecord<HumanTaskRecord>(result.rows[0].raw_payload) : null;
  }

  async listTasks(limit: number): Promise<HumanTaskRecord[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_tasks ORDER BY COALESCE(due_at, updated_at) ASC, updated_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<HumanTaskRecord>((row as StoredPayload).raw_payload));
  }

  async appendTaskProof(record: TaskProofRecord): Promise<void> {
    await this.upsertTaskProof(record);
  }

  async upsertTaskProof(record: TaskProofRecord): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_task_proofs (id, task_id, mode, actor_id, verification_status, note, artifact_refs, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         verification_status = EXCLUDED.verification_status,
         note = EXCLUDED.note,
         artifact_refs = EXCLUDED.artifact_refs,
         raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.taskId, record.mode, record.actorId, record.verificationStatus, record.note, stringify(record.artifactRefs), record.createdAt, stringify(record)],
    );
  }

  async listTaskProofs(taskId: string): Promise<TaskProofRecord[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_task_proofs WHERE task_id = $1 ORDER BY created_at DESC",
      [taskId],
    );
    return result.rows.map((row) => asRecord<TaskProofRecord>((row as StoredPayload).raw_payload));
  }

  async appendTaskEscape(record: TaskEscapeRecord): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_task_escapes (id, task_id, case_id, actor_id, escape_hatch, status, created_at, resolved_at, resolved_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.taskId,
        record.caseId,
        record.actorId,
        record.escapeHatch,
        record.status,
        record.createdAt,
        record.resolvedAt,
        record.resolvedBy,
        stringify(record),
      ],
    );
  }

  async listTaskEscapes(taskId?: string, limit = 100): Promise<TaskEscapeRecord[]> {
    const pool = getPgPool();
    const result = taskId
      ? await pool.query(
          "SELECT raw_payload FROM brain_ops_task_escapes WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2",
          [taskId, Math.max(1, limit)],
        )
      : await pool.query(
          "SELECT raw_payload FROM brain_ops_task_escapes ORDER BY created_at DESC LIMIT $1",
          [Math.max(1, limit)],
        );
    return result.rows.map((row) => asRecord<TaskEscapeRecord>((row as StoredPayload).raw_payload));
  }

  async upsertApproval(record: ApprovalItem): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_approvals
       (id, case_id, title, status, action_class, requested_by, required_role, verification_class, freshest_at, confidence, degrade_reason, created_at, updated_at, resolved_at, resolved_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15,$16::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         case_id = EXCLUDED.case_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         action_class = EXCLUDED.action_class,
         requested_by = EXCLUDED.requested_by,
         required_role = EXCLUDED.required_role,
         verification_class = EXCLUDED.verification_class,
         freshest_at = EXCLUDED.freshest_at,
         confidence = EXCLUDED.confidence,
         degrade_reason = EXCLUDED.degrade_reason,
         updated_at = EXCLUDED.updated_at,
         resolved_at = EXCLUDED.resolved_at,
         resolved_by = EXCLUDED.resolved_by,
         raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.caseId,
        record.title,
        record.status,
        record.actionClass,
        record.requestedBy,
        record.requiredRole,
        record.verificationClass,
        record.freshestAt,
        record.confidence,
        record.degradeReason,
        record.createdAt,
        record.updatedAt,
        record.resolvedAt,
        record.resolvedBy,
        stringify(record),
      ],
    );
  }

  async getApproval(id: string): Promise<ApprovalItem | null> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_approvals WHERE id = $1 LIMIT 1", [id]);
    return result.rowCount ? asRecord<ApprovalItem>(result.rows[0].raw_payload) : null;
  }

  async listApprovals(limit: number): Promise<ApprovalItem[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_approvals ORDER BY updated_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<ApprovalItem>((row as StoredPayload).raw_payload));
  }

  async saveActionEffectReceipt(record: ActionEffectReceipt): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_action_effect_receipts
       (id, action_id, source_system, effect_type, verification_class, observed_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.actionId, record.sourceSystem, record.effectType, record.verificationClass, record.observedAt, stringify(record)],
    );
  }

  async listActionEffectReceipts(actionId: string): Promise<ActionEffectReceipt[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_action_effect_receipts WHERE action_id = $1 ORDER BY observed_at DESC",
      [actionId],
    );
    return result.rows.map((row) => asRecord<ActionEffectReceipt>((row as StoredPayload).raw_payload));
  }

  async upsertGrowthExperiment(record: GrowthExperiment): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_growth_experiments (id, status, owner, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, owner = EXCLUDED.owner, updated_at = EXCLUDED.updated_at, raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.status, record.owner, record.updatedAt, stringify(record)],
    );
  }

  async listGrowthExperiments(limit: number): Promise<GrowthExperiment[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_growth_experiments ORDER BY updated_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<GrowthExperiment>((row as StoredPayload).raw_payload));
  }

  async upsertImprovementCase(record: ImprovementCase): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_improvement_cases (id, status, updated_at, raw_payload)
       VALUES ($1,$2,$3::timestamptz,$4::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.status, record.updatedAt, stringify(record)],
    );
  }

  async listImprovementCases(limit: number): Promise<ImprovementCase[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_improvement_cases ORDER BY updated_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<ImprovementCase>((row as StoredPayload).raw_payload));
  }

  async upsertStationSession(record: StationSession): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_station_sessions (id, station_id, room_id, surface_mode, current_task_id, actor_id, last_seen_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb)
       ON CONFLICT (station_id) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         surface_mode = EXCLUDED.surface_mode,
         current_task_id = EXCLUDED.current_task_id,
         actor_id = EXCLUDED.actor_id,
         last_seen_at = EXCLUDED.last_seen_at,
         raw_payload = EXCLUDED.raw_payload`,
      [record.id, record.stationId, record.roomId, record.surfaceMode, record.currentTaskId, record.actorId, record.lastSeenAt, stringify(record)],
    );
  }

  async getStationSession(stationId: string): Promise<StationSession | null> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_station_sessions WHERE station_id = $1 LIMIT 1", [stationId]);
    return result.rowCount ? asRecord<StationSession>(result.rows[0].raw_payload) : null;
  }

  async listStationSessions(limit: number): Promise<StationSession[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_station_sessions ORDER BY last_seen_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<StationSession>((row as StoredPayload).raw_payload));
  }

  async setDegradeModes(modes: OpsDegradeMode[]): Promise<void> {
    const pool = getPgPool();
    await pool.query("DELETE FROM brain_ops_degraded_modes");
    if (!modes.length) return;
    for (const mode of modes) {
      await pool.query(
        "INSERT INTO brain_ops_degraded_modes (mode, updated_at) VALUES ($1, now()) ON CONFLICT (mode) DO UPDATE SET updated_at = now()",
        [mode],
      );
    }
  }

  async getDegradeModes(): Promise<OpsDegradeMode[]> {
    const pool = getPgPool();
    const result = await pool.query("SELECT mode FROM brain_ops_degraded_modes ORDER BY mode ASC");
    return result.rows.map((row) => String(row.mode) as OpsDegradeMode);
  }

  async saveSourceFreshness(rows: OpsSourceFreshness[]): Promise<void> {
    const pool = getPgPool();
    await pool.query("DELETE FROM brain_ops_source_freshness");
    for (const row of rows) {
      await pool.query(
        `INSERT INTO brain_ops_source_freshness (source_key, freshest_at, freshness_seconds, budget_seconds, status, reason, raw_payload)
         VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7::jsonb)`,
        [row.source, row.freshestAt, row.freshnessSeconds, row.budgetSeconds, row.status, row.reason, stringify(row)],
      );
    }
  }

  async listSourceFreshness(): Promise<OpsSourceFreshness[]> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_source_freshness ORDER BY source_key ASC");
    return result.rows.map((row) => asRecord<OpsSourceFreshness>((row as StoredPayload).raw_payload));
  }

  async saveWatchdogs(rows: OpsWatchdog[]): Promise<void> {
    const pool = getPgPool();
    await pool.query("DELETE FROM brain_ops_watchdogs");
    for (const row of rows) {
      await pool.query(
        `INSERT INTO brain_ops_watchdogs (id, status, raw_payload)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw_payload = EXCLUDED.raw_payload`,
        [row.id, row.status, stringify(row)],
      );
    }
  }

  async listWatchdogs(): Promise<OpsWatchdog[]> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_watchdogs ORDER BY id ASC");
    return result.rows.map((row) => asRecord<OpsWatchdog>((row as StoredPayload).raw_payload));
  }

  async upsertReservationBundle(record: ReservationBundle): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_reservation_bundles (id, reservation_id, status, due_at, owner_uid, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4::timestamptz,$5,$6::timestamptz,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         due_at = EXCLUDED.due_at,
         owner_uid = EXCLUDED.owner_uid,
         updated_at = EXCLUDED.updated_at,
         raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.reservationId,
        record.status,
        record.dueAt,
        record.ownerUid,
        record.freshestAt ?? record.dueAt ?? record.metadata.updatedAt ?? record.metadata.createdAt ?? new Date().toISOString(),
        stringify(record),
      ],
    );
  }

  async getReservationBundle(id: string): Promise<ReservationBundle | null> {
    const pool = getPgPool();
    const result = await pool.query("SELECT raw_payload FROM brain_ops_reservation_bundles WHERE id = $1 LIMIT 1", [id]);
    return result.rowCount ? asRecord<ReservationBundle>(result.rows[0].raw_payload) : null;
  }

  async listReservationBundles(limit: number): Promise<ReservationBundle[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_reservation_bundles ORDER BY COALESCE(due_at, updated_at) ASC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<ReservationBundle>((row as StoredPayload).raw_payload));
  }

  async upsertOverride(record: OverrideReceipt): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_ops_overrides (id, actor_id, scope, required_role, status, expires_at, created_at, resolved_at, resolved_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         expires_at = EXCLUDED.expires_at,
         resolved_at = EXCLUDED.resolved_at,
         resolved_by = EXCLUDED.resolved_by,
         raw_payload = EXCLUDED.raw_payload`,
      [
        record.id,
        record.actorId,
        record.scope,
        record.requiredRole,
        record.status,
        record.expiresAt,
        record.createdAt,
        record.resolvedAt,
        record.resolvedBy,
        stringify(record),
      ],
    );
  }

  async listOverrides(limit: number): Promise<OverrideReceipt[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_overrides ORDER BY created_at DESC LIMIT $1",
      [Math.max(1, limit)],
    );
    return result.rows.map((row) => asRecord<OverrideReceipt>((row as StoredPayload).raw_payload));
  }

  async appendMemberAudit(record: OpsMemberAuditRecord): Promise<void> {
    const pool = getPgPool();
    const safeRecord = redactMemberAuditPayload(record);
    await pool.query(
      `INSERT INTO brain_ops_member_audits (id, uid, kind, actor_id, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`,
      [safeRecord.id, safeRecord.uid, safeRecord.kind, safeRecord.actorId, safeRecord.createdAt, stringify(safeRecord)],
    );
  }

  async listMemberAudits(uid: string, limit: number): Promise<OpsMemberAuditRecord[]> {
    const pool = getPgPool();
    const result = await pool.query(
      "SELECT raw_payload FROM brain_ops_member_audits WHERE uid = $1 ORDER BY created_at DESC LIMIT $2",
      [uid, Math.max(1, limit)],
    );
    return result.rows.map((row) => redactMemberAuditPayload(asRecord<OpsMemberAuditRecord>((row as StoredPayload).raw_payload)));
  }
}
