"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresPlanningStore = exports.MemoryPlanningStore = void 0;
const postgres_1 = require("../db/postgres");
function toJson(value) {
    return JSON.stringify(value ?? {});
}
function clean(value) {
    return String(value ?? "").trim();
}
function nullableText(value) {
    const normalized = clean(value);
    return normalized ? normalized : null;
}
function payload(row) {
    return row.payload ?? {};
}
async function withTransaction(task) {
    const pool = (0, postgres_1.getPgPool)();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await task(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
class MemoryPlanningStore {
    roleSources = new Map();
    roleSourceSnapshots = new Map();
    roleCandidates = new Map();
    roleManifests = new Map();
    roleScores = new Map();
    dockets = new Map();
    fingerprints = new Map();
    stakeholders = new Map();
    councils = new Map();
    seats = new Map();
    rounds = new Map();
    reviewItems = new Map();
    ledger = new Map();
    plans = new Map();
    packets = new Map();
    preparations = new Map();
    async seedRoleLibrary(seed) {
        for (const row of seed.sources)
            this.roleSources.set(row.sourceId, row);
        for (const row of seed.snapshots)
            this.roleSourceSnapshots.set(row.snapshotId, row);
        for (const row of seed.candidates)
            this.roleCandidates.set(row.candidateId, row);
        for (const row of seed.curatedRoles)
            this.roleManifests.set(row.roleId, row);
        for (const row of [...seed.curatedScores, ...seed.candidateScores])
            this.roleScores.set(row.scoreId, row);
    }
    async savePreparation(preparation) {
        this.dockets.set(preparation.docket.docketId, preparation.docket);
        this.fingerprints.set(preparation.fingerprint.fingerprintId, preparation.fingerprint);
        this.councils.set(preparation.council.councilId, {
            ...preparation.council,
            status: "prepared",
            swarmRun: preparation.swarmRun,
            preparation,
        });
        for (const row of preparation.seats)
            this.seats.set(row.seatId, row);
        for (const row of preparation.reviewRounds)
            this.rounds.set(row.roundId, row);
        this.preparations.set(preparation.preparedRunId, preparation);
    }
    async getPreparation(preparedRunId) {
        return this.preparations.get(preparedRunId) ?? null;
    }
    async saveRun(bundle) {
        this.dockets.set(bundle.docket.docketId, bundle.docket);
        this.fingerprints.set(bundle.fingerprint.fingerprintId, bundle.fingerprint);
        for (const row of bundle.stakeholders)
            this.stakeholders.set(row.inferenceId, row);
        this.councils.set(bundle.council.councilId, bundle.council);
        for (const row of bundle.councilSeats)
            this.seats.set(row.seatId, row);
        for (const row of bundle.reviewRounds)
            this.rounds.set(row.roundId, row);
        for (const row of bundle.reviewItems)
            this.reviewItems.set(row.itemId, row);
        for (const row of bundle.objectionLedger)
            this.ledger.set(row.ledgerId, row);
        this.plans.set(bundle.synthesizedPlan.planId, bundle.synthesizedPlan);
        this.packets.set(bundle.packet.packetId, bundle.packet);
    }
    async getPacket(packetId) {
        return this.packets.get(packetId) ?? null;
    }
    async getPackets(packetIds) {
        return packetIds.map((packetId) => this.packets.get(packetId)).filter(Boolean);
    }
    async listPackets(limit) {
        return [...this.packets.values()]
            .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
            .slice(0, Math.max(1, limit));
    }
    async getCouncil(councilId) {
        const council = this.councils.get(councilId);
        if (!council)
            return null;
        return {
            council,
            seats: [...this.seats.values()].filter((row) => row.councilId === councilId),
            reviewRounds: [...this.rounds.values()].filter((row) => row.councilId === councilId).sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0)),
            reviewItems: [...this.reviewItems.values()].filter((row) => row.councilId === councilId),
            objectionLedger: [...this.ledger.values()].filter((row) => row.councilId === councilId),
            swarmRun: council.swarmRun ?? null,
            agentRuns: Array.isArray(council.agentRuns) ? council.agentRuns : [],
            roundSummaries: Array.isArray(council.roundSummaries) ? council.roundSummaries : [],
            memoryRefs: Array.isArray(council.memoryRefs) ? council.memoryRefs : [],
            roleFindings: Array.isArray(council.roleFindings) ? council.roleFindings : [],
            roleNotes: Array.isArray(council.roleNotes) ? council.roleNotes : [],
            planRevisions: Array.isArray(council.planRevisions) ? council.planRevisions : [],
            addressMatrix: Array.isArray(council.addressMatrix) ? council.addressMatrix : [],
            synthesizedPlan: [...this.plans.values()].find((row) => row.councilId === councilId) ?? null,
            packets: [...this.packets.values()].filter((row) => row.councilId === councilId),
        };
    }
    async listRoleManifests(limit) {
        return [...this.roleManifests.values()]
            .sort((left, right) => left.roleName.localeCompare(right.roleName))
            .slice(0, Math.max(1, limit));
    }
}
exports.MemoryPlanningStore = MemoryPlanningStore;
class PostgresPlanningStore {
    async seedRoleLibrary(seed) {
        await withTransaction(async (client) => {
            for (const row of seed.sources) {
                await client.query(`INSERT INTO role_sources (source_id, source_kind, status, payload)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (source_id) DO UPDATE SET source_kind = EXCLUDED.source_kind, status = EXCLUDED.status, payload = EXCLUDED.payload`, [row.sourceId, String(row.kind ?? ""), String(row.status ?? ""), toJson(row)]);
            }
            for (const row of seed.snapshots) {
                await client.query(`INSERT INTO role_source_snapshots (snapshot_id, source_id, captured_at, payload)
           VALUES ($1, $2, $3::timestamptz, $4::jsonb)
           ON CONFLICT (snapshot_id) DO UPDATE SET source_id = EXCLUDED.source_id, captured_at = EXCLUDED.captured_at, payload = EXCLUDED.payload`, [row.snapshotId, row.sourceId, String(row.capturedAt ?? new Date().toISOString()), toJson(row)]);
            }
            for (const row of seed.candidates) {
                await client.query(`INSERT INTO role_candidates (candidate_id, snapshot_id, source_id, role_name, status, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (candidate_id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id, source_id = EXCLUDED.source_id, role_name = EXCLUDED.role_name, status = EXCLUDED.status, payload = EXCLUDED.payload`, [row.candidateId, nullableText(row.snapshotId), row.sourceId, String(row.roleName ?? ""), String(row.status ?? ""), toJson(row)]);
            }
            for (const row of seed.curatedRoles) {
                await client.query(`INSERT INTO role_manifests (role_id, role_name, status, payload)
           VALUES ($1, $2, 'curated', $3::jsonb)
           ON CONFLICT (role_id) DO UPDATE SET role_name = EXCLUDED.role_name, status = EXCLUDED.status, payload = EXCLUDED.payload`, [row.roleId, row.roleName, toJson(row)]);
            }
            for (const row of [...seed.curatedScores, ...seed.candidateScores]) {
                await client.query(`INSERT INTO role_quality_scores (score_id, subject_type, role_id, candidate_id, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (score_id) DO UPDATE SET subject_type = EXCLUDED.subject_type, role_id = EXCLUDED.role_id, candidate_id = EXCLUDED.candidate_id, payload = EXCLUDED.payload`, [row.scoreId, row.subjectType, nullableText(row.roleId), nullableText(row.candidateId), toJson(row)]);
            }
        });
    }
    async savePreparation(preparation) {
        await withTransaction(async (client) => {
            await client.query(`INSERT INTO planning_dockets (docket_id, created_at, requested_by, tenant_id, objective, domain, reversibility, payload)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (docket_id) DO UPDATE SET payload = EXCLUDED.payload, objective = EXCLUDED.objective, domain = EXCLUDED.domain, reversibility = EXCLUDED.reversibility`, [preparation.docket.docketId, String(preparation.docket.createdAt ?? new Date().toISOString()), preparation.docket.requestedBy, preparation.docket.tenantId, preparation.docket.objective, String(preparation.docket.domain ?? ""), String(preparation.docket.reversibility ?? ""), toJson(preparation.docket)]);
            await client.query(`INSERT INTO plan_fingerprints (fingerprint_id, docket_id, created_at, plan_type, domain, stakes, payload)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::jsonb)
         ON CONFLICT (fingerprint_id) DO UPDATE SET payload = EXCLUDED.payload, stakes = EXCLUDED.stakes`, [preparation.fingerprint.fingerprintId, preparation.fingerprint.docketId, String(preparation.fingerprint.createdAt ?? new Date().toISOString()), String(preparation.fingerprint.planType ?? ""), String(preparation.fingerprint.domain ?? ""), preparation.fingerprint.stakes, toJson(preparation.fingerprint)]);
            await client.query(`INSERT INTO council_instances (council_id, docket_id, fingerprint_id, created_at, status, payload)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb)
         ON CONFLICT (council_id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`, [preparation.council.councilId, preparation.council.docketId, preparation.council.fingerprintId, String(preparation.council.createdAt ?? new Date().toISOString()), "prepared", toJson({ ...preparation.council, status: "prepared", swarmRun: preparation.swarmRun, preparation })]);
            for (const row of preparation.seats) {
                await client.query(`INSERT INTO council_seats (seat_id, council_id, seat_name, selected_role_id, stakeholder_represented, mandatory_or_conditional, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (seat_id) DO UPDATE SET payload = EXCLUDED.payload, selected_role_id = EXCLUDED.selected_role_id`, [row.seatId, row.councilId, row.seatName, row.selectedRoleId, String(row.stakeholderRepresented ?? ""), String(row.mandatoryOrConditional ?? ""), toJson(row)]);
            }
            for (const row of preparation.reviewRounds) {
                await client.query(`INSERT INTO review_rounds (round_id, council_id, ordinal, round_type, status, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (round_id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`, [row.roundId, row.councilId, Number(row.ordinal ?? 0), String(row.roundType ?? ""), String(row.status ?? "pending"), toJson(row)]);
            }
        });
    }
    async getPreparation(preparedRunId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT payload FROM council_instances WHERE council_id = $1", [preparedRunId]);
        if (!result.rowCount)
            return null;
        const council = payload(result.rows[0]);
        const preparation = council.preparation ?? null;
        if (!preparation)
            return null;
        return preparation;
    }
    async saveRun(bundle) {
        await withTransaction(async (client) => {
            await client.query(`INSERT INTO planning_dockets (docket_id, created_at, requested_by, tenant_id, objective, domain, reversibility, payload)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (docket_id) DO UPDATE SET payload = EXCLUDED.payload, objective = EXCLUDED.objective, domain = EXCLUDED.domain, reversibility = EXCLUDED.reversibility`, [bundle.docket.docketId, String(bundle.docket.createdAt ?? new Date().toISOString()), bundle.docket.requestedBy, bundle.docket.tenantId, bundle.docket.objective, String(bundle.docket.domain ?? ""), String(bundle.docket.reversibility ?? ""), toJson(bundle.docket)]);
            await client.query(`INSERT INTO plan_fingerprints (fingerprint_id, docket_id, created_at, plan_type, domain, stakes, payload)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::jsonb)
         ON CONFLICT (fingerprint_id) DO UPDATE SET payload = EXCLUDED.payload, stakes = EXCLUDED.stakes`, [bundle.fingerprint.fingerprintId, bundle.fingerprint.docketId, String(bundle.fingerprint.createdAt ?? new Date().toISOString()), String(bundle.fingerprint.planType ?? ""), String(bundle.fingerprint.domain ?? ""), bundle.fingerprint.stakes, toJson(bundle.fingerprint)]);
            for (const row of bundle.stakeholders) {
                await client.query(`INSERT INTO stakeholder_inferences (inference_id, docket_id, fingerprint_id, stakeholder_class, mandatory_or_conditional, confidence_score, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (inference_id) DO UPDATE SET payload = EXCLUDED.payload, confidence_score = EXCLUDED.confidence_score`, [row.inferenceId, row.docketId, String(row.fingerprintId ?? ""), row.stakeholderClass, String(row.mandatoryOrConditional ?? ""), Number(row.confidenceScore ?? 0), toJson(row)]);
            }
            await client.query(`INSERT INTO council_instances (council_id, docket_id, fingerprint_id, created_at, status, payload)
         VALUES ($1, $2, $3, $4::timestamptz, $5, $6::jsonb)
         ON CONFLICT (council_id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`, [bundle.council.councilId, bundle.council.docketId, bundle.council.fingerprintId, String(bundle.council.createdAt ?? new Date().toISOString()), String(bundle.council.status ?? "under_review"), toJson(bundle.council)]);
            for (const row of bundle.councilSeats) {
                await client.query(`INSERT INTO council_seats (seat_id, council_id, seat_name, selected_role_id, stakeholder_represented, mandatory_or_conditional, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (seat_id) DO UPDATE SET payload = EXCLUDED.payload, selected_role_id = EXCLUDED.selected_role_id`, [row.seatId, row.councilId, row.seatName, row.selectedRoleId, String(row.stakeholderRepresented ?? ""), String(row.mandatoryOrConditional ?? ""), toJson(row)]);
            }
            for (const row of bundle.reviewRounds) {
                await client.query(`INSERT INTO review_rounds (round_id, council_id, ordinal, round_type, status, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (round_id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`, [row.roundId, row.councilId, Number(row.ordinal ?? 0), String(row.roundType ?? ""), String(row.status ?? ""), toJson(row)]);
            }
            for (const row of bundle.reviewItems) {
                await client.query(`INSERT INTO review_items (item_id, council_id, round_id, seat_id, item_type, severity, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (item_id) DO UPDATE SET payload = EXCLUDED.payload, severity = EXCLUDED.severity`, [row.itemId, row.councilId, row.roundId, row.seatId, row.type, row.severity, toJson(row)]);
            }
            for (const row of bundle.objectionLedger) {
                await client.query(`INSERT INTO objection_ledger (ledger_id, council_id, item_id, resolution_state, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (ledger_id) DO UPDATE SET payload = EXCLUDED.payload, resolution_state = EXCLUDED.resolution_state`, [row.ledgerId, row.councilId, row.itemId, row.resolutionState, toJson(row)]);
            }
            await client.query(`INSERT INTO synthesized_plans (plan_id, council_id, docket_id, version, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (plan_id) DO UPDATE SET payload = EXCLUDED.payload, version = EXCLUDED.version`, [bundle.synthesizedPlan.planId, bundle.synthesizedPlan.councilId, bundle.synthesizedPlan.docketId, Number(bundle.synthesizedPlan.version ?? 1), toJson(bundle.synthesizedPlan)]);
            await client.query(`INSERT INTO human_arbitration_packets (packet_id, council_id, docket_id, synthesized_plan_id, status, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (packet_id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`, [bundle.packet.packetId, bundle.packet.councilId, bundle.packet.docketId, String(bundle.packet.synthesizedPlanId ?? ""), String(bundle.packet.status ?? "ready_for_human"), toJson(bundle.packet)]);
        });
    }
    async getPacket(packetId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT payload FROM human_arbitration_packets WHERE packet_id = $1", [packetId]);
        if (!result.rowCount)
            return null;
        return payload(result.rows[0]);
    }
    async getPackets(packetIds) {
        if (!packetIds.length)
            return [];
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT payload FROM human_arbitration_packets WHERE packet_id = ANY($1::text[])", [packetIds]);
        return result.rows.map((row) => payload(row));
    }
    async listPackets(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT payload FROM human_arbitration_packets ORDER BY created_at DESC LIMIT $1", [Math.max(1, Math.min(limit, 200))]);
        return result.rows.map((row) => payload(row));
    }
    async getCouncil(councilId) {
        const pool = (0, postgres_1.getPgPool)();
        const councilResult = await pool.query("SELECT payload FROM council_instances WHERE council_id = $1", [councilId]);
        if (!councilResult.rowCount)
            return null;
        const council = payload(councilResult.rows[0]);
        const [seats, reviewRounds, reviewItems, objectionLedger, synthesizedPlans, packets] = await Promise.all([
            pool.query("SELECT payload FROM council_seats WHERE council_id = $1 ORDER BY seat_name ASC", [councilId]),
            pool.query("SELECT payload FROM review_rounds WHERE council_id = $1 ORDER BY ordinal ASC", [councilId]),
            pool.query("SELECT payload FROM review_items WHERE council_id = $1 ORDER BY created_at ASC NULLS LAST, item_id ASC", [councilId]),
            pool.query("SELECT payload FROM objection_ledger WHERE council_id = $1 ORDER BY updated_at DESC NULLS LAST, ledger_id ASC", [councilId]),
            pool.query("SELECT payload FROM synthesized_plans WHERE council_id = $1 ORDER BY version DESC LIMIT 1", [councilId]),
            pool.query("SELECT payload FROM human_arbitration_packets WHERE council_id = $1 ORDER BY created_at DESC", [councilId]),
        ]);
        return {
            council,
            seats: seats.rows.map((row) => payload(row)),
            reviewRounds: reviewRounds.rows.map((row) => payload(row)),
            reviewItems: reviewItems.rows.map((row) => payload(row)),
            objectionLedger: objectionLedger.rows.map((row) => payload(row)),
            swarmRun: council.swarmRun ?? null,
            agentRuns: Array.isArray(council.agentRuns) ? council.agentRuns : [],
            roundSummaries: Array.isArray(council.roundSummaries) ? council.roundSummaries : [],
            memoryRefs: Array.isArray(council.memoryRefs) ? council.memoryRefs : [],
            roleFindings: Array.isArray(council.roleFindings) ? council.roleFindings : [],
            roleNotes: Array.isArray(council.roleNotes) ? council.roleNotes : [],
            planRevisions: Array.isArray(council.planRevisions) ? council.planRevisions : [],
            addressMatrix: Array.isArray(council.addressMatrix) ? council.addressMatrix : [],
            synthesizedPlan: synthesizedPlans.rowCount ? payload(synthesizedPlans.rows[0]) : null,
            packets: packets.rows.map((row) => payload(row)),
        };
    }
    async listRoleManifests(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT payload FROM role_manifests ORDER BY role_name ASC LIMIT $1", [Math.max(1, Math.min(limit, 200))]);
        return result.rows.map((row) => payload(row));
    }
}
exports.PostgresPlanningStore = PostgresPlanningStore;
