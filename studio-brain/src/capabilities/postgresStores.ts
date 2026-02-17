import type { ActionProposal, KillSwitchState, PolicyExemption } from "./model";
import type { PolicyStore, ProposalStore } from "./runtime";
import { getPgPool } from "../db/postgres";
import type { QuotaAdminStore, QuotaBucketRecord, QuotaResult } from "./policy";

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? new Date().toISOString());
}

export class PostgresProposalStore implements ProposalStore {
  async get(id: string): Promise<ActionProposal | null> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT id, created_at, requested_by, capability_id, rationale, input_hash, preview, status, approved_by, approved_at
       FROM brain_capability_proposals WHERE id = $1`,
      [id]
    );
    if (!result.rowCount) return null;
    return rowToProposal(result.rows[0] as Record<string, unknown>);
  }

  async save(proposal: ActionProposal): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_capability_proposals
       (id, created_at, requested_by, capability_id, rationale, input_hash, preview, status, approved_by, approved_at)
       VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         requested_by = EXCLUDED.requested_by,
         capability_id = EXCLUDED.capability_id,
         rationale = EXCLUDED.rationale,
         input_hash = EXCLUDED.input_hash,
         preview = EXCLUDED.preview,
         status = EXCLUDED.status,
         approved_by = EXCLUDED.approved_by,
         approved_at = EXCLUDED.approved_at`,
      [
        proposal.id,
        proposal.createdAt,
        proposal.requestedBy,
        proposal.capabilityId,
        proposal.rationale,
        proposal.inputHash,
        JSON.stringify(proposal.preview),
        proposal.status,
        proposal.approvedBy ?? null,
        proposal.approvedAt ?? null,
      ]
    );
  }

  async listRecent(limit: number): Promise<ActionProposal[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await pool.query(
      `SELECT id, created_at, requested_by, capability_id, rationale, input_hash, preview, status, approved_by, approved_at
       FROM brain_capability_proposals ORDER BY created_at DESC LIMIT $1`,
      [bounded]
    );
    return result.rows.map((row) => rowToProposal(row as Record<string, unknown>));
  }
}

export class PostgresPolicyStore implements PolicyStore {
  async getKillSwitchState(): Promise<KillSwitchState> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT enabled, changed_by, rationale, created_at
       FROM brain_capability_kill_switch_events
       ORDER BY created_at DESC
       LIMIT 1`
    );
    if (!result.rowCount) {
      return {
        enabled: false,
        updatedAt: null,
        updatedBy: null,
        rationale: null,
      };
    }
    const row = result.rows[0] as Record<string, unknown>;
    return {
      enabled: Boolean(row.enabled),
      updatedAt: toIso(row.created_at),
      updatedBy: row.changed_by ? String(row.changed_by) : null,
      rationale: row.rationale ? String(row.rationale) : null,
    };
  }

  async setKillSwitch(input: {
    enabled: boolean;
    changedBy: string;
    rationale: string;
    at: Date;
  }): Promise<KillSwitchState> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_capability_kill_switch_events
       (enabled, changed_by, rationale, created_at)
       VALUES ($1, $2, $3, $4::timestamptz)`,
      [input.enabled, input.changedBy, input.rationale, input.at.toISOString()]
    );
    return {
      enabled: input.enabled,
      updatedAt: input.at.toISOString(),
      updatedBy: input.changedBy,
      rationale: input.rationale,
    };
  }

  async listExemptions(limit: number, now: Date = new Date()): Promise<PolicyExemption[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await pool.query(
      `SELECT id, exemption_id, event_type, capability_id, owner_uid, justification, actor_id, expires_at, created_at
       FROM brain_capability_exemption_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.max(500, bounded * 5)]
    );

    const createdById = new Map<string, Record<string, unknown>>();
    const revokedById = new Map<string, Record<string, unknown>>();

    for (const raw of result.rows as Record<string, unknown>[]) {
      const eventType = String(raw.event_type ?? "");
      const exemptionId = String(raw.exemption_id ?? "");
      if (!exemptionId) continue;
      if (eventType === "created" && !createdById.has(exemptionId)) {
        createdById.set(exemptionId, raw);
      } else if (eventType === "revoked" && !revokedById.has(exemptionId)) {
        revokedById.set(exemptionId, raw);
      }
    }

    return [...createdById.values()]
      .map((created): PolicyExemption => {
        const id = String(created.exemption_id ?? "");
        const revoked = revokedById.get(id);
        const expiresAt = created.expires_at ? toIso(created.expires_at) : undefined;
        const expiresMs = expiresAt ? Date.parse(expiresAt) : null;
        const expired = expiresMs !== null && Number.isFinite(expiresMs) && expiresMs <= now.getTime();
        return {
          id,
          capabilityId: String(created.capability_id ?? ""),
          ownerUid: created.owner_uid ? String(created.owner_uid) : undefined,
          justification: String(created.justification ?? ""),
          approvedBy: String(created.actor_id ?? ""),
          createdAt: toIso(created.created_at),
          expiresAt,
          revokedAt: revoked?.created_at ? toIso(revoked.created_at) : undefined,
          revokedBy: revoked?.actor_id ? String(revoked.actor_id) : undefined,
          revokeReason: revoked?.justification ? String(revoked.justification) : undefined,
          status: revoked ? "revoked" : expired ? "expired" : "active",
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, bounded);
  }

  async createExemption(input: {
    capabilityId: string;
    ownerUid?: string;
    justification: string;
    approvedBy: string;
    expiresAt?: string;
    at: Date;
  }): Promise<PolicyExemption> {
    const pool = getPgPool();
    const exemptionId = `${input.at.getTime().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await pool.query(
      `INSERT INTO brain_capability_exemption_events
       (exemption_id, event_type, capability_id, owner_uid, justification, actor_id, expires_at, created_at)
       VALUES ($1, 'created', $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
      [
        exemptionId,
        input.capabilityId,
        input.ownerUid ?? null,
        input.justification,
        input.approvedBy,
        input.expiresAt ?? null,
        input.at.toISOString(),
      ]
    );
    return {
      id: exemptionId,
      capabilityId: input.capabilityId,
      ownerUid: input.ownerUid,
      justification: input.justification,
      approvedBy: input.approvedBy,
      createdAt: input.at.toISOString(),
      expiresAt: input.expiresAt,
      status: "active",
    };
  }

  async revokeExemption(input: {
    exemptionId: string;
    revokedBy: string;
    reason: string;
    at: Date;
  }): Promise<PolicyExemption | null> {
    const pool = getPgPool();
    const createdResult = await pool.query(
      `SELECT exemption_id, capability_id, owner_uid, justification, actor_id, expires_at, created_at
       FROM brain_capability_exemption_events
       WHERE exemption_id = $1 AND event_type = 'created'
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.exemptionId]
    );
    if (!createdResult.rowCount) return null;

    const existingRevoke = await pool.query(
      `SELECT created_at, actor_id, justification
       FROM brain_capability_exemption_events
       WHERE exemption_id = $1 AND event_type = 'revoked'
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.exemptionId]
    );

    if (!existingRevoke.rowCount) {
      await pool.query(
        `INSERT INTO brain_capability_exemption_events
         (exemption_id, event_type, capability_id, owner_uid, justification, actor_id, expires_at, created_at)
         VALUES ($1, 'revoked', NULL, NULL, $2, $3, NULL, $4::timestamptz)`,
        [input.exemptionId, input.reason, input.revokedBy, input.at.toISOString()]
      );
    }

    const created = createdResult.rows[0] as Record<string, unknown>;
    const revoked = existingRevoke.rowCount
      ? (existingRevoke.rows[0] as Record<string, unknown>)
      : { created_at: input.at.toISOString(), actor_id: input.revokedBy, justification: input.reason };

    return {
      id: String(created.exemption_id ?? input.exemptionId),
      capabilityId: String(created.capability_id ?? ""),
      ownerUid: created.owner_uid ? String(created.owner_uid) : undefined,
      justification: String(created.justification ?? ""),
      approvedBy: String(created.actor_id ?? ""),
      createdAt: toIso(created.created_at),
      expiresAt: created.expires_at ? toIso(created.expires_at) : undefined,
      revokedAt: toIso(revoked.created_at),
      revokedBy: String(revoked.actor_id ?? input.revokedBy),
      revokeReason: String(revoked.justification ?? input.reason),
      status: "revoked",
    };
  }
}

export class PostgresQuotaStore implements QuotaAdminStore {
  async consume(bucket: string, limit: number, windowSeconds: number, nowMs: number): Promise<QuotaResult> {
    const pool = getPgPool();
    const client = await pool.connect();
    const nowIso = new Date(nowMs).toISOString();
    const windowMs = windowSeconds * 1000;
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT bucket, window_start, count FROM brain_capability_quota WHERE bucket = $1 FOR UPDATE",
        [bucket]
      );

      if (!existing.rowCount) {
        await client.query(
          "INSERT INTO brain_capability_quota (bucket, window_start, count) VALUES ($1, $2::timestamptz, 1)",
          [bucket, nowIso]
        );
        await client.query("COMMIT");
        return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) };
      }

      const row = existing.rows[0] as { window_start: Date | string; count: number };
      const windowStartMs = new Date(row.window_start).getTime();
      const currentCount = Number(row.count ?? 0);
      const elapsedMs = nowMs - windowStartMs;

      if (elapsedMs >= windowMs) {
        await client.query(
          "UPDATE brain_capability_quota SET window_start = $2::timestamptz, count = 1 WHERE bucket = $1",
          [bucket, nowIso]
        );
        await client.query("COMMIT");
        return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) };
      }

      if (currentCount >= limit) {
        await client.query("COMMIT");
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000)),
          remaining: 0,
        };
      }

      const nextCount = currentCount + 1;
      await client.query("UPDATE brain_capability_quota SET count = $2 WHERE bucket = $1", [bucket, nextCount]);
      await client.query("COMMIT");
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - nextCount) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBuckets(limit: number): Promise<QuotaBucketRecord[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 500));
    const result = await pool.query(
      "SELECT bucket, window_start, count FROM brain_capability_quota ORDER BY window_start DESC LIMIT $1",
      [bounded]
    );
    return result.rows.map((row) => ({
      bucket: String(row.bucket),
      windowStart: toIso(row.window_start),
      count: Number(row.count ?? 0),
    }));
  }

  async resetBucket(bucket: string): Promise<boolean> {
    const pool = getPgPool();
    const result = await pool.query("DELETE FROM brain_capability_quota WHERE bucket = $1", [bucket]);
    return Boolean(result.rowCount && result.rowCount > 0);
  }
}

function rowToProposal(row: Record<string, unknown>): ActionProposal {
  const preview = (row.preview as ActionProposal["preview"]) ?? { summary: "", input: {}, expectedEffects: [] };
  const tenantFromPreview =
    preview && typeof preview.input?.tenantId === "string" ? preview.input.tenantId.trim() : "";
  return {
    id: String(row.id ?? ""),
    createdAt: toIso(row.created_at),
    requestedBy: String(row.requested_by ?? ""),
    tenantId: tenantFromPreview || String(row.requested_by ?? ""),
    capabilityId: String(row.capability_id ?? ""),
    rationale: String(row.rationale ?? ""),
    inputHash: String(row.input_hash ?? ""),
    preview,
    status: String(row.status ?? "draft") as ActionProposal["status"],
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    approvedAt: row.approved_at ? toIso(row.approved_at) : undefined,
  };
}
