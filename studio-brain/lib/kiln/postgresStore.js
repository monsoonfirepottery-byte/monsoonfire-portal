"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresKilnStore = void 0;
const postgres_1 = require("../db/postgres");
function stringify(value) {
    return JSON.stringify(value);
}
function asRecord(row) {
    return row;
}
class PostgresKilnStore {
    async upsertKiln(kiln) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kilns (
        id, display_name, manufacturer, kiln_model, controller_model, controller_family,
        firmware_version, serial_number, mac_address, zone_count, thermocouple_type,
        output4_role, wifi_configured, last_seen_at, current_run_id, raw_payload
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,$16::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        manufacturer = EXCLUDED.manufacturer,
        kiln_model = EXCLUDED.kiln_model,
        controller_model = EXCLUDED.controller_model,
        controller_family = EXCLUDED.controller_family,
        firmware_version = EXCLUDED.firmware_version,
        serial_number = EXCLUDED.serial_number,
        mac_address = EXCLUDED.mac_address,
        zone_count = EXCLUDED.zone_count,
        thermocouple_type = EXCLUDED.thermocouple_type,
        output4_role = EXCLUDED.output4_role,
        wifi_configured = EXCLUDED.wifi_configured,
        last_seen_at = EXCLUDED.last_seen_at,
        current_run_id = EXCLUDED.current_run_id,
        raw_payload = EXCLUDED.raw_payload
      `, [
            kiln.id,
            kiln.displayName,
            kiln.manufacturer,
            kiln.kilnModel,
            kiln.controllerModel,
            kiln.controllerFamily,
            kiln.firmwareVersion,
            kiln.serialNumber,
            kiln.macAddress,
            kiln.zoneCount,
            kiln.thermocoupleType,
            kiln.output4Role,
            kiln.wifiConfigured,
            kiln.lastSeenAt,
            kiln.currentRunId,
            stringify(kiln),
        ]);
    }
    async getKiln(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kilns WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listKilns() {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kilns ORDER BY display_name ASC");
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async saveCapabilityDocument(document) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_capability_documents (id, kiln_id, fingerprint_hash, generated_at, raw_payload)
      VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        fingerprint_hash = EXCLUDED.fingerprint_hash,
        generated_at = EXCLUDED.generated_at,
        raw_payload = EXCLUDED.raw_payload
      `, [document.id, document.kilnId, document.fingerprintHash, document.generatedAt, stringify(document)]);
    }
    async getLatestCapabilityDocument(kilnId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_capability_documents WHERE kiln_id = $1 ORDER BY generated_at DESC LIMIT 1", [kilnId]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async saveArtifactRecord(record) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_artifacts (
        id, kiln_id, firing_run_id, import_run_id, artifact_kind, source_label,
        filename, content_type, sha256, size_bytes, storage_key, observed_at, raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        firing_run_id = EXCLUDED.firing_run_id,
        import_run_id = EXCLUDED.import_run_id,
        artifact_kind = EXCLUDED.artifact_kind,
        source_label = EXCLUDED.source_label,
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        sha256 = EXCLUDED.sha256,
        size_bytes = EXCLUDED.size_bytes,
        storage_key = EXCLUDED.storage_key,
        observed_at = EXCLUDED.observed_at,
        raw_payload = EXCLUDED.raw_payload
      `, [
            record.id,
            record.kilnId,
            record.firingRunId,
            record.importRunId,
            record.artifactKind,
            record.sourceLabel,
            record.filename,
            record.contentType,
            record.sha256,
            record.sizeBytes,
            record.storageKey,
            record.observedAt,
            stringify(record),
        ]);
    }
    async getArtifactRecord(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_artifacts WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async findArtifactBySha256(sha256) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_artifacts WHERE sha256 = $1 ORDER BY observed_at DESC NULLS LAST LIMIT 1", [sha256]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listArtifactsForKiln(kilnId, limit = 20) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_artifacts WHERE kiln_id = $1 ORDER BY observed_at DESC NULLS LAST LIMIT $2", [kilnId, Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async saveImportRun(run) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_import_runs (
        id, kiln_id, source, parser_kind, parser_version, status, observed_at,
        started_at, completed_at, artifact_id, diagnostics, raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10,$11::jsonb,$12::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        observed_at = EXCLUDED.observed_at,
        completed_at = EXCLUDED.completed_at,
        artifact_id = EXCLUDED.artifact_id,
        diagnostics = EXCLUDED.diagnostics,
        raw_payload = EXCLUDED.raw_payload
      `, [
            run.id,
            run.kilnId,
            run.source,
            run.parserKind,
            run.parserVersion,
            run.status,
            run.observedAt,
            run.startedAt,
            run.completedAt,
            run.artifactId,
            stringify(run.diagnostics),
            stringify(run),
        ]);
    }
    async getImportRun(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_import_runs WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async saveFiringRun(run) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_firing_runs (
        id, kiln_id, run_source, status, queue_state, control_posture, program_name, program_type,
        cone_target, speed, start_time, end_time, duration_sec, current_segment, total_segments,
        max_temp, final_set_point, operator_id, operator_confirmation_at, firmware_version, raw_payload
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17,$18,$19::timestamptz,$20,$21::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        queue_state = EXCLUDED.queue_state,
        control_posture = EXCLUDED.control_posture,
        program_name = EXCLUDED.program_name,
        program_type = EXCLUDED.program_type,
        cone_target = EXCLUDED.cone_target,
        speed = EXCLUDED.speed,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        duration_sec = EXCLUDED.duration_sec,
        current_segment = EXCLUDED.current_segment,
        total_segments = EXCLUDED.total_segments,
        max_temp = EXCLUDED.max_temp,
        final_set_point = EXCLUDED.final_set_point,
        operator_id = EXCLUDED.operator_id,
        operator_confirmation_at = EXCLUDED.operator_confirmation_at,
        firmware_version = EXCLUDED.firmware_version,
        raw_payload = EXCLUDED.raw_payload
      `, [
            run.id,
            run.kilnId,
            run.runSource,
            run.status,
            run.queueState,
            run.controlPosture,
            run.programName,
            run.programType,
            run.coneTarget,
            run.speed,
            run.startTime,
            run.endTime,
            run.durationSec,
            run.currentSegment,
            run.totalSegments,
            run.maxTemp,
            run.finalSetPoint,
            run.operatorId,
            run.operatorConfirmationAt,
            run.firmwareVersion,
            stringify(run),
        ]);
    }
    async getFiringRun(id) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_firing_runs WHERE id = $1 LIMIT 1", [id]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async findCurrentRunForKiln(kilnId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query(`
      SELECT raw_payload
      FROM brain_kiln_firing_runs
      WHERE kiln_id = $1 AND status = ANY($2::text[])
      ORDER BY start_time DESC NULLS LAST, inserted_at DESC
      LIMIT 1
      `, [kilnId, ["queued", "armed", "firing", "cooling"]]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async listFiringRuns(query = {}) {
        const pool = (0, postgres_1.getPgPool)();
        const clauses = [];
        const values = [];
        if (query.kilnId) {
            values.push(query.kilnId);
            clauses.push(`kiln_id = $${values.length}`);
        }
        if (query.statuses?.length) {
            values.push(query.statuses);
            clauses.push(`status = ANY($${values.length}::text[])`);
        }
        if (query.queueStates?.length) {
            values.push(query.queueStates);
            clauses.push(`queue_state = ANY($${values.length}::text[])`);
        }
        values.push(Math.max(1, query.limit ?? 50));
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await pool.query(`
      SELECT raw_payload
      FROM brain_kiln_firing_runs
      ${where}
      ORDER BY start_time DESC NULLS LAST, inserted_at DESC
      LIMIT $${values.length}
      `, values);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendFiringEvents(events) {
        const pool = (0, postgres_1.getPgPool)();
        for (const event of events) {
            await pool.query(`
        INSERT INTO brain_kiln_firing_events (
          id, kiln_id, firing_run_id, ts, event_type, severity, source, confidence, payload_json, raw_payload
        )
        VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          severity = EXCLUDED.severity,
          confidence = EXCLUDED.confidence,
          payload_json = EXCLUDED.payload_json,
          raw_payload = EXCLUDED.raw_payload
        `, [
                event.id,
                event.kilnId,
                event.firingRunId,
                event.ts,
                event.eventType,
                event.severity,
                event.source,
                event.confidence,
                stringify(event.payloadJson),
                stringify(event),
            ]);
        }
    }
    async listFiringEvents(firingRunId, limit = 100) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_firing_events WHERE firing_run_id = $1 ORDER BY ts ASC LIMIT $2", [firingRunId, Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
    async appendTelemetryPoints(points) {
        const pool = (0, postgres_1.getPgPool)();
        for (const point of points) {
            await pool.query(`
        INSERT INTO brain_kiln_telemetry_points (
          kiln_id, firing_run_id, ts, segment, set_point, temp_primary, temp_zone_1, temp_zone_2,
          temp_zone_3, percent_power_1, percent_power_2, percent_power_3, board_temp, raw_payload
        )
        VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        `, [
                point.kilnId,
                point.firingRunId,
                point.ts,
                point.segment,
                point.setPoint,
                point.tempPrimary,
                point.tempZone1,
                point.tempZone2,
                point.tempZone3,
                point.percentPower1,
                point.percentPower2,
                point.percentPower3,
                point.boardTemp,
                stringify(point),
            ]);
        }
    }
    async listTelemetryPoints(firingRunId, limit = 500) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query(`
      SELECT raw_payload
      FROM brain_kiln_telemetry_points
      WHERE firing_run_id = $1
      ORDER BY ts DESC
      LIMIT $2
      `, [firingRunId, Math.max(1, limit)]);
        return result.rows.map((row) => asRecord(row.raw_payload)).reverse();
    }
    async saveHealthSnapshot(snapshot) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_health_snapshots (id, kiln_id, ts, raw_payload)
      VALUES ($1,$2,$3::timestamptz,$4::jsonb)
      ON CONFLICT (id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload, ts = EXCLUDED.ts
      `, [snapshot.id, snapshot.kilnId, snapshot.ts, stringify(snapshot)]);
    }
    async getLatestHealthSnapshot(kilnId) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_payload FROM brain_kiln_health_snapshots WHERE kiln_id = $1 ORDER BY ts DESC LIMIT 1", [kilnId]);
        return result.rowCount ? asRecord(result.rows[0].raw_payload) : null;
    }
    async saveOperatorAction(action) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO brain_kiln_operator_actions (
        id, kiln_id, firing_run_id, action_type, requested_by, confirmed_by, requested_at,
        completed_at, checklist_json, notes, raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::jsonb,$10,$11::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        confirmed_by = EXCLUDED.confirmed_by,
        completed_at = EXCLUDED.completed_at,
        checklist_json = EXCLUDED.checklist_json,
        notes = EXCLUDED.notes,
        raw_payload = EXCLUDED.raw_payload
      `, [
            action.id,
            action.kilnId,
            action.firingRunId,
            action.actionType,
            action.requestedBy,
            action.confirmedBy,
            action.requestedAt,
            action.completedAt,
            stringify(action.checklistJson),
            action.notes,
            stringify(action),
        ]);
    }
    async listOperatorActions(query = {}) {
        const pool = (0, postgres_1.getPgPool)();
        const clauses = [];
        const values = [];
        if (query.kilnId) {
            values.push(query.kilnId);
            clauses.push(`kiln_id = $${values.length}`);
        }
        if (query.firingRunId) {
            values.push(query.firingRunId);
            clauses.push(`firing_run_id = $${values.length}`);
        }
        if (query.incompleteOnly) {
            clauses.push("completed_at IS NULL");
        }
        values.push(Math.max(1, query.limit ?? 50));
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await pool.query(`
      SELECT raw_payload
      FROM brain_kiln_operator_actions
      ${where}
      ORDER BY requested_at DESC
      LIMIT $${values.length}
      `, values);
        return result.rows.map((row) => asRecord(row.raw_payload));
    }
}
exports.PostgresKilnStore = PostgresKilnStore;
