import crypto from "node:crypto";
import { getPgPool } from "../db/postgres";
import type { AuditEvent, EventStore } from "./interfaces";
import { stableHashDeep } from "./hash";

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? new Date().toISOString());
}

export class PostgresEventStore implements EventStore {
  async append(event: Omit<AuditEvent, "id" | "at">): Promise<AuditEvent> {
    const pool = getPgPool();
    const full: AuditEvent = {
      id: crypto.randomUUID(),
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

    await pool.query(
      `
      INSERT INTO brain_event_log (
        id, at, actor_type, actor_id, action, rationale, target, approval_state, input_hash, output_hash, metadata
      ) VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      `,
      [
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
      ]
    );

    return full;
  }

  async listRecent(limit: number): Promise<AuditEvent[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await pool.query(
      "SELECT id, at, actor_type, actor_id, action, rationale, target, approval_state, input_hash, output_hash, metadata FROM brain_event_log ORDER BY at DESC LIMIT $1",
      [bounded]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      at: toIso(row.at),
      actorType: String(row.actor_type) as AuditEvent["actorType"],
      actorId: String(row.actor_id),
      action: String(row.action),
      rationale: String(row.rationale),
      target: String(row.target) as AuditEvent["target"],
      approvalState: String(row.approval_state) as AuditEvent["approvalState"],
      inputHash: String(row.input_hash),
      outputHash: row.output_hash ? String(row.output_hash) : null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));
  }
}

export function hashAuditPayload(input: unknown): string {
  return stableHashDeep(input);
}
