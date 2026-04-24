"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresOpsStore = exports.MemoryOpsStore = void 0;
const postgres_1 = require("../db/postgres");
const pii_1 = require("./pii");
function stringify(value) {
    return JSON.stringify(value);
}
function asRecord(row) {
    return row;
}
class MemoryOpsStore {
    events = new Map();
    receipts = new Map();
    authReceipts = new Map();
    cases = new Map();
    caseNotes = new Map();
    tasks = new Map();
    taskProofs = new Map();
    taskEscapes = new Map();
    approvals = new Map();
    actionReceipts = new Map();
    growth = new Map();
    improvements = new Map();
    stations = new Map();
    sourceFreshness = new Map();
    watchdogs = new Map();
    reservationBundles = new Map();
    overrides = new Map();
    memberAudits = new Map();
    degradeModes = [];
    async appendEvent(event, receipt) {
        this.events.set(event.id, event);
        this.receipts.set(`${receipt.sourceSystem}:${receipt.sourceEventId}`, receipt);
    }
    async getIngestReceipt(sourceSystem, sourceEventId) {
        return this.receipts.get(`${sourceSystem}:${sourceEventId}`) ?? null;
    }
    async listEvents(limit) {
        return [...this.events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
    }
    async saveAuthReceipt(record) {
        this.authReceipts.set(record.id, record);
    }
    async listAuthReceipts(limit) {
        return [...this.authReceipts.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, limit);
    }
    async upsertCase(record) {
        this.cases.set(record.id, record);
    }
    async getCase(id) {
        return this.cases.get(id) ?? null;
    }
    async listCases(limit) {
        return [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    }
    async appendCaseNote(note) {
        const list = this.caseNotes.get(note.caseId) ?? [];
        list.unshift(note);
        this.caseNotes.set(note.caseId, list);
    }
    async listCaseNotes(caseId, limit) {
        return (this.caseNotes.get(caseId) ?? []).slice(0, limit);
    }
    async upsertTask(record) {
        this.tasks.set(record.id, record);
    }
    async getTask(id) {
        return this.tasks.get(id) ?? null;
    }
    async listTasks(limit) {
        return [...this.tasks.values()].sort((a, b) => {
            const dueCompare = (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
            if (dueCompare !== 0)
                return dueCompare;
            return b.updatedAt.localeCompare(a.updatedAt);
        }).slice(0, limit);
    }
    async appendTaskProof(record) {
        await this.upsertTaskProof(record);
    }
    async upsertTaskProof(record) {
        const list = this.taskProofs.get(record.taskId) ?? [];
        const next = list.filter((entry) => entry.id !== record.id);
        next.unshift(record);
        this.taskProofs.set(record.taskId, next);
    }
    async listTaskProofs(taskId) {
        return this.taskProofs.get(taskId) ?? [];
    }
    async appendTaskEscape(record) {
        this.taskEscapes.set(record.id, record);
    }
    async listTaskEscapes(taskId, limit = 100) {
        return [...this.taskEscapes.values()]
            .filter((entry) => !taskId || entry.taskId === taskId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit);
    }
    async upsertApproval(record) {
        this.approvals.set(record.id, record);
    }
    async getApproval(id) {
        return this.approvals.get(id) ?? null;
    }
    async listApprovals(limit) {
        return [...this.approvals.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    }
    async saveActionEffectReceipt(record) {
        const list = this.actionReceipts.get(record.actionId) ?? [];
        list.unshift(record);
        this.actionReceipts.set(record.actionId, list);
    }
    async listActionEffectReceipts(actionId) {
        return this.actionReceipts.get(actionId) ?? [];
    }
    async upsertGrowthExperiment(record) {
        this.growth.set(record.id, record);
    }
    async listGrowthExperiments(limit) {
        return [...this.growth.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    }
    async upsertImprovementCase(record) {
        this.improvements.set(record.id, record);
    }
    async listImprovementCases(limit) {
        return [...this.improvements.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    }
    async upsertStationSession(record) {
        this.stations.set(record.stationId, record);
    }
    async getStationSession(stationId) {
        return this.stations.get(stationId) ?? null;
    }
    async listStationSessions(limit) {
        return [...this.stations.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit);
    }
    async setDegradeModes(modes) {
        this.degradeModes = [...modes];
    }
    async getDegradeModes() {
        return [...this.degradeModes];
    }
    async saveSourceFreshness(rows) {
        this.sourceFreshness.clear();
        for (const row of rows)
            this.sourceFreshness.set(row.source, row);
    }
    async listSourceFreshness() {
        return [...this.sourceFreshness.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    async saveWatchdogs(rows) {
        this.watchdogs.clear();
        for (const row of rows)
            this.watchdogs.set(row.id, row);
    }
    async listWatchdogs() {
        return [...this.watchdogs.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    async upsertReservationBundle(record) {
        this.reservationBundles.set(record.id, record);
    }
    async getReservationBundle(id) {
        return this.reservationBundles.get(id) ?? null;
    }
    async listReservationBundles(limit) {
        return [...this.reservationBundles.values()]
            .sort((a, b) => String(a.dueAt ?? "9999").localeCompare(String(b.dueAt ?? "9999")))
            .slice(0, limit);
    }
    async upsertOverride(record) {
        this.overrides.set(record.id, record);
    }
    async listOverrides(limit) {
        return [...this.overrides.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    }
    async appendMemberAudit(record) {
        const safeRecord = (0, pii_1.redactMemberAuditPayload)(record);
        const list = this.memberAudits.get(safeRecord.uid) ?? [];
        list.unshift(safeRecord);
        this.memberAudits.set(safeRecord.uid, list);
    }
    async listMemberAudits(uid, limit) {
        return (this.memberAudits.get(uid) ?? []).slice(0, limit).map((record) => (0, pii_1.redactMemberAuditPayload)(record));
    }
}
exports.MemoryOpsStore = MemoryOpsStore;
class PostgresOpsStore {
    async appendEvent(event, receipt) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("BEGIN");
        try {
            await pool.query(`INSERT INTO brain_ops_ingest_receipts
         (id, source_system, source_event_id, payload_hash, auth_principal, received_at, timestamp_skew_seconds, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb)
         ON CONFLICT (source_system, source_event_id) DO NOTHING`, [
                receipt.id,
                receipt.sourceSystem,
                receipt.sourceEventId,
                receipt.payloadHash,
                receipt.authPrincipal,
                receipt.receivedAt,
                receipt.timestampSkewSeconds,
                stringify(receipt),
            ]);
            await pool.query(`INSERT INTO brain_ops_events
         (id, event_type, event_version, entity_kind, entity_id, case_id, source_system, source_event_id, dedupe_key, room_id, actor_kind, actor_id, confidence, occurred_at, ingested_at, verification_class, artifact_refs, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz,$16,$17::jsonb,$18::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           case_id = EXCLUDED.case_id,
           confidence = EXCLUDED.confidence,
           ingested_at = EXCLUDED.ingested_at,
           verification_class = EXCLUDED.verification_class,
           artifact_refs = EXCLUDED.artifact_refs,
           raw_payload = EXCLUDED.raw_payload`, [
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
            ]);
            await pool.query("COMMIT");
        }
        catch (error) {
            await pool.query("ROLLBACK");
            throw error;
        }
    }
    async getIngestReceipt(sourceSystem, sourceEventId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_ingest_receipts WHERE source_system = $1 AND source_event_id = $2 LIMIT 1", [sourceSystem, sourceEventId]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listEvents(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_events ORDER BY occurred_at DESC, ingested_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async saveAuthReceipt(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_auth_receipts
       (id, source_system, actor_id, actor_kind, status, observed_at, expires_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_system = EXCLUDED.source_system,
         actor_id = EXCLUDED.actor_id,
         actor_kind = EXCLUDED.actor_kind,
         status = EXCLUDED.status,
         observed_at = EXCLUDED.observed_at,
         expires_at = EXCLUDED.expires_at,
         raw_payload = EXCLUDED.raw_payload`, [record.id, record.sourceSystem, record.actorId, record.actorKind, record.status, record.observedAt, record.expiresAt, stringify(record)]);
    }
    async listAuthReceipts(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_auth_receipts ORDER BY observed_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertCase(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_cases
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
         raw_payload = EXCLUDED.raw_payload`, [
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
        ]);
    }
    async getCase(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_cases WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listCases(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_cases ORDER BY updated_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendCaseNote(note) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_case_notes (id, case_id, actor_id, actor_kind, body, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb)`, [note.id, note.caseId, note.actorId, note.actorKind, note.body, note.createdAt, stringify(note)]);
    }
    async listCaseNotes(caseId, limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT $2", [caseId, Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertTask(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_tasks
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
         raw_payload = EXCLUDED.raw_payload`, [
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
        ]);
    }
    async getTask(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_tasks WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listTasks(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_tasks ORDER BY COALESCE(due_at, updated_at) ASC, updated_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendTaskProof(record) {
        await this.upsertTaskProof(record);
    }
    async upsertTaskProof(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_task_proofs (id, task_id, mode, actor_id, verification_status, note, artifact_refs, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         verification_status = EXCLUDED.verification_status,
         note = EXCLUDED.note,
         artifact_refs = EXCLUDED.artifact_refs,
         raw_payload = EXCLUDED.raw_payload`, [record.id, record.taskId, record.mode, record.actorId, record.verificationStatus, record.note, stringify(record.artifactRefs), record.createdAt, stringify(record)]);
    }
    async listTaskProofs(taskId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_task_proofs WHERE task_id = $1 ORDER BY created_at DESC", [taskId]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendTaskEscape(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_task_escapes (id, task_id, case_id, actor_id, escape_hatch, status, created_at, resolved_at, resolved_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`, [
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
        ]);
    }
    async listTaskEscapes(taskId, limit = 100) {
        const pool = (0, postgres_1.getPgPool)();
        const result = taskId
            ? await pool.query("SELECT raw_payload FROM brain_ops_task_escapes WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2", [taskId, Math.max(1, limit)])
            : await pool.query("SELECT raw_payload FROM brain_ops_task_escapes ORDER BY created_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertApproval(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_approvals
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
         raw_payload = EXCLUDED.raw_payload`, [
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
        ]);
    }
    async getApproval(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_approvals WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listApprovals(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_approvals ORDER BY updated_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async saveActionEffectReceipt(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_action_effect_receipts
       (id, action_id, source_system, effect_type, verification_class, observed_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`, [record.id, record.actionId, record.sourceSystem, record.effectType, record.verificationClass, record.observedAt, stringify(record)]);
    }
    async listActionEffectReceipts(actionId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_action_effect_receipts WHERE action_id = $1 ORDER BY observed_at DESC", [actionId]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertGrowthExperiment(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_growth_experiments (id, status, owner, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, owner = EXCLUDED.owner, updated_at = EXCLUDED.updated_at, raw_payload = EXCLUDED.raw_payload`, [record.id, record.status, record.owner, record.updatedAt, stringify(record)]);
    }
    async listGrowthExperiments(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_growth_experiments ORDER BY updated_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertImprovementCase(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_improvement_cases (id, status, updated_at, raw_payload)
       VALUES ($1,$2,$3::timestamptz,$4::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, raw_payload = EXCLUDED.raw_payload`, [record.id, record.status, record.updatedAt, stringify(record)]);
    }
    async listImprovementCases(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_improvement_cases ORDER BY updated_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertStationSession(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_station_sessions (id, station_id, room_id, surface_mode, current_task_id, actor_id, last_seen_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb)
       ON CONFLICT (station_id) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         surface_mode = EXCLUDED.surface_mode,
         current_task_id = EXCLUDED.current_task_id,
         actor_id = EXCLUDED.actor_id,
         last_seen_at = EXCLUDED.last_seen_at,
         raw_payload = EXCLUDED.raw_payload`, [record.id, record.stationId, record.roomId, record.surfaceMode, record.currentTaskId, record.actorId, record.lastSeenAt, stringify(record)]);
    }
    async getStationSession(stationId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_station_sessions WHERE station_id = $1 LIMIT 1", [stationId]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listStationSessions(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_station_sessions ORDER BY last_seen_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async setDegradeModes(modes) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("DELETE FROM brain_ops_degraded_modes");
        if (!modes.length)
            return;
        for (const mode of modes) {
            await pool.query("INSERT INTO brain_ops_degraded_modes (mode, updated_at) VALUES ($1, now()) ON CONFLICT (mode) DO UPDATE SET updated_at = now()", [mode]);
        }
    }
    async getDegradeModes() {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT mode FROM brain_ops_degraded_modes ORDER BY mode ASC");
        return result.rows.map((row) => String(row.mode));
    }
    async saveSourceFreshness(rows) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("DELETE FROM brain_ops_source_freshness");
        for (const row of rows) {
            await pool.query(`INSERT INTO brain_ops_source_freshness (source_key, freshest_at, freshness_seconds, budget_seconds, status, reason, raw_payload)
         VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7::jsonb)`, [row.source, row.freshestAt, row.freshnessSeconds, row.budgetSeconds, row.status, row.reason, stringify(row)]);
        }
    }
    async listSourceFreshness() {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_source_freshness ORDER BY source_key ASC");
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async saveWatchdogs(rows) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("DELETE FROM brain_ops_watchdogs");
        for (const row of rows) {
            await pool.query(`INSERT INTO brain_ops_watchdogs (id, status, raw_payload)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw_payload = EXCLUDED.raw_payload`, [row.id, row.status, stringify(row)]);
        }
    }
    async listWatchdogs() {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_watchdogs ORDER BY id ASC");
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertReservationBundle(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_reservation_bundles (id, reservation_id, status, due_at, owner_uid, updated_at, raw_payload)
       VALUES ($1,$2,$3,$4::timestamptz,$5,$6::timestamptz,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         due_at = EXCLUDED.due_at,
         owner_uid = EXCLUDED.owner_uid,
         updated_at = EXCLUDED.updated_at,
         raw_payload = EXCLUDED.raw_payload`, [
            record.id,
            record.reservationId,
            record.status,
            record.dueAt,
            record.ownerUid,
            record.freshestAt ?? record.dueAt ?? record.metadata.updatedAt ?? record.metadata.createdAt ?? new Date().toISOString(),
            stringify(record),
        ]);
    }
    async getReservationBundle(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_reservation_bundles WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listReservationBundles(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_reservation_bundles ORDER BY COALESCE(due_at, updated_at) ASC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async upsertOverride(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`INSERT INTO brain_ops_overrides (id, actor_id, scope, required_role, status, expires_at, created_at, resolved_at, resolved_by, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         expires_at = EXCLUDED.expires_at,
         resolved_at = EXCLUDED.resolved_at,
         resolved_by = EXCLUDED.resolved_by,
         raw_payload = EXCLUDED.raw_payload`, [
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
        ]);
    }
    async listOverrides(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_overrides ORDER BY created_at DESC LIMIT $1", [Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendMemberAudit(record) {
        const pool = (0, postgres_1.getPgPool)();
        const safeRecord = (0, pii_1.redactMemberAuditPayload)(record);
        await pool.query(`INSERT INTO brain_ops_member_audits (id, uid, kind, actor_id, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload`, [safeRecord.id, safeRecord.uid, safeRecord.kind, safeRecord.actorId, safeRecord.createdAt, stringify(safeRecord)]);
    }
    async listMemberAudits(uid, limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_ops_member_audits WHERE uid = $1 ORDER BY created_at DESC LIMIT $2", [uid, Math.max(1, limit)]);
        return result.rows.map((row) => (0, pii_1.redactMemberAuditPayload)(asRecord(row.raw_payload)));
    }
}
exports.PostgresOpsStore = PostgresOpsStore;
