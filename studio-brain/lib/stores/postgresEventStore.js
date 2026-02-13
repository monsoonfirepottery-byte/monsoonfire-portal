"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresEventStore = void 0;
exports.hashAuditPayload = hashAuditPayload;
const node_crypto_1 = __importDefault(require("node:crypto"));
const postgres_1 = require("../db/postgres");
const hash_1 = require("./hash");
function toIso(v) {
    if (v instanceof Date)
        return v.toISOString();
    return String(v ?? new Date().toISOString());
}
class PostgresEventStore {
    async append(event) {
        const pool = (0, postgres_1.getPgPool)();
        const full = {
            id: node_crypto_1.default.randomUUID(),
            at: new Date().toISOString(),
            actorType: event.actorType,
            actorId: event.actorId,
            action: event.action,
            rationale: event.rationale,
            target: event.target,
            approvalState: event.approvalState,
            inputHash: event.inputHash,
            outputHash: event.outputHash,
            metadata: event.metadata,
        };
        await pool.query(`
      INSERT INTO brain_event_log (
        id, at, actor_type, actor_id, action, rationale, target, approval_state, input_hash, output_hash, metadata
      ) VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      `, [
            full.id,
            full.at,
            full.actorType,
            full.actorId,
            full.action,
            full.rationale,
            full.target,
            full.approvalState,
            full.inputHash,
            full.outputHash,
            JSON.stringify(full.metadata),
        ]);
        return full;
    }
    async listRecent(limit) {
        const pool = (0, postgres_1.getPgPool)();
        const bounded = Math.max(1, Math.min(limit, 200));
        const result = await pool.query("SELECT id, at, actor_type, actor_id, action, rationale, target, approval_state, input_hash, output_hash, metadata FROM brain_event_log ORDER BY at DESC LIMIT $1", [bounded]);
        return result.rows.map((row) => ({
            id: String(row.id),
            at: toIso(row.at),
            actorType: String(row.actor_type),
            actorId: String(row.actor_id),
            action: String(row.action),
            rationale: String(row.rationale),
            target: String(row.target),
            approvalState: String(row.approval_state),
            inputHash: String(row.input_hash),
            outputHash: row.output_hash ? String(row.output_hash) : null,
            metadata: row.metadata ?? {},
        }));
    }
}
exports.PostgresEventStore = PostgresEventStore;
function hashAuditPayload(input) {
    return (0, hash_1.stableHashDeep)(input);
}
