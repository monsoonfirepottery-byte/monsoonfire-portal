"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresStateStore = void 0;
exports.toJobRunRecord = toJobRunRecord;
const node_crypto_1 = __importDefault(require("node:crypto"));
const postgres_1 = require("../db/postgres");
function toIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === "string")
        return value;
    return new Date().toISOString();
}
function makeUuid() {
    return node_crypto_1.default.randomUUID();
}
class PostgresStateStore {
    async saveStudioState(snapshot) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query(`
      INSERT INTO studio_state_daily (
        snapshot_date, schema_version, generated_at, firestore_read_at, stripe_read_at,
        counts, ops, finance, source_hashes, raw_snapshot
      )
      VALUES ($1::date,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        generated_at = EXCLUDED.generated_at,
        firestore_read_at = EXCLUDED.firestore_read_at,
        stripe_read_at = EXCLUDED.stripe_read_at,
        counts = EXCLUDED.counts,
        ops = EXCLUDED.ops,
        finance = EXCLUDED.finance,
        source_hashes = EXCLUDED.source_hashes,
        raw_snapshot = EXCLUDED.raw_snapshot
      `, [
            snapshot.snapshotDate,
            snapshot.schemaVersion,
            snapshot.generatedAt,
            snapshot.cloudSync.firestoreReadAt,
            snapshot.cloudSync.stripeReadAt,
            JSON.stringify(snapshot.counts),
            JSON.stringify(snapshot.ops),
            JSON.stringify(snapshot.finance),
            JSON.stringify(snapshot.sourceHashes),
            JSON.stringify(snapshot),
        ]);
    }
    async getLatestStudioState() {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_snapshot FROM studio_state_daily ORDER BY snapshot_date DESC LIMIT 1");
        if (!result.rowCount)
            return null;
        return result.rows[0].raw_snapshot;
    }
    async getPreviousStudioState(beforeDate) {
        const pool = (0, postgres_1.getPgPool)();
        const result = await pool.query("SELECT raw_snapshot FROM studio_state_daily WHERE snapshot_date < $1::date ORDER BY snapshot_date DESC LIMIT 1", [beforeDate]);
        if (!result.rowCount)
            return null;
        return result.rows[0].raw_snapshot;
    }
    async saveStudioStateDiff(diff) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("INSERT INTO studio_state_diff (from_snapshot_date, to_snapshot_date, changes) VALUES ($1::date, $2::date, $3::jsonb)", [diff.fromSnapshotDate, diff.toSnapshotDate, JSON.stringify(diff.changes)]);
    }
    async listRecentJobRuns(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const bounded = Math.max(1, Math.min(limit, 500));
        const result = await pool.query("SELECT id, job_name, status, started_at, completed_at, summary, error_message FROM brain_job_runs ORDER BY started_at DESC LIMIT $1", [bounded]);
        return result.rows.map((row) => toJobRunRecord(row));
    }
    async startJobRun(jobName) {
        const pool = (0, postgres_1.getPgPool)();
        const id = makeUuid();
        const startedAt = new Date().toISOString();
        await pool.query("INSERT INTO brain_job_runs (id, job_name, status, started_at, completed_at, summary, error_message) VALUES ($1,$2,'running',$3::timestamptz,NULL,NULL,NULL)", [id, jobName, startedAt]);
        return {
            id,
            jobName,
            status: "running",
            startedAt,
            completedAt: null,
            summary: null,
            errorMessage: null,
        };
    }
    async completeJobRun(id, summary) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("UPDATE brain_job_runs SET status='succeeded', completed_at=now(), summary=$2, error_message=NULL WHERE id=$1", [id, summary]);
    }
    async failJobRun(id, errorMessage) {
        const pool = (0, postgres_1.getPgPool)();
        await pool.query("UPDATE brain_job_runs SET status='failed', completed_at=now(), error_message=$2 WHERE id=$1", [id, errorMessage.slice(0, 4000)]);
    }
}
exports.PostgresStateStore = PostgresStateStore;
function toJobRunRecord(row) {
    return {
        id: String(row.id ?? ""),
        jobName: String(row.job_name ?? ""),
        status: String(row.status ?? "failed"),
        startedAt: toIso(row.started_at),
        completedAt: row.completed_at ? toIso(row.completed_at) : null,
        summary: row.summary ? String(row.summary) : null,
        errorMessage: row.error_message ? String(row.error_message) : null,
    };
}
