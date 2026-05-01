import crypto from "node:crypto";
import type { Pool } from "pg";
import { getPgPool } from "../db/postgres";

export const EMBER_SUPPORT_ATTACHMENT_MAX_BYTES = 512 * 1024;
export const EMBER_SUPPORT_ATTACHMENT_DEFAULT_TTL_MINUTES = 120;
export const EMBER_SUPPORT_ATTACHMENT_MAX_TTL_MINUTES = 12 * 60;
export const EMBER_SUPPORT_ATTACHMENT_MAX_ACTIVE_PER_SESSION = 3;

export type EmberSupportAttachmentInput = {
  sessionId: string;
  supportRequestId: string | null;
  pagePath: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  payload: Buffer;
  note: string | null;
  source: string;
  uploadedBy: string;
  requestId: string | null;
  ttlMinutes?: number | null;
  metadata?: Record<string, unknown>;
};

export type EmberSupportAttachmentRecord = {
  id: string;
  sessionId: string;
  supportRequestId: string | null;
  pagePath: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  note: string | null;
  source: string;
  uploadedBy: string;
  requestId: string | null;
  createdAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
};

export type EmberSupportAttachmentPruneResult = {
  deletedRows: number;
  deletedBefore: string;
};

export interface EmberSupportAttachmentStore {
  countActiveForSession(sessionId: string, now?: Date): Promise<number>;
  save(input: EmberSupportAttachmentInput, now?: Date): Promise<EmberSupportAttachmentRecord>;
  pruneExpired(now?: Date): Promise<EmberSupportAttachmentPruneResult>;
}

function rowCountOrZero(value: number | null): number {
  return typeof value === "number" ? value : 0;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clampTtlMinutes(value: number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return EMBER_SUPPORT_ATTACHMENT_DEFAULT_TTL_MINUTES;
  return Math.max(15, Math.min(EMBER_SUPPORT_ATTACHMENT_MAX_TTL_MINUTES, Math.trunc(parsed)));
}

function hydrateAttachment(row: Record<string, unknown>): EmberSupportAttachmentRecord {
  return {
    id: String(row.id ?? ""),
    sessionId: String(row.session_id ?? ""),
    supportRequestId: typeof row.support_request_id === "string" ? row.support_request_id : null,
    pagePath: String(row.page_path ?? ""),
    fileName: String(row.file_name ?? ""),
    contentType: String(row.content_type ?? "image/jpeg") as EmberSupportAttachmentRecord["contentType"],
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 ?? ""),
    note: typeof row.note === "string" ? row.note : null,
    source: String(row.source ?? "ember-web-chat"),
    uploadedBy: String(row.uploaded_by ?? "firebase-apiV1"),
    requestId: typeof row.request_id === "string" ? row.request_id : null,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    metadata: toJsonObject(row.metadata),
  };
}

export class PostgresEmberSupportAttachmentStore implements EmberSupportAttachmentStore {
  constructor(private readonly poolProvider: () => Pool = getPgPool) {}

  async countActiveForSession(sessionId: string, now = new Date()): Promise<number> {
    const pool = this.poolProvider();
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM brain_ember_support_attachments
       WHERE session_id = $1
         AND expires_at > $2::timestamptz
         AND deleted_at IS NULL`,
      [sessionId, now.toISOString()],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async save(input: EmberSupportAttachmentInput, now = new Date()): Promise<EmberSupportAttachmentRecord> {
    if (input.payload.byteLength <= 0 || input.payload.byteLength > EMBER_SUPPORT_ATTACHMENT_MAX_BYTES) {
      throw new Error(`Attachment payload must be between 1 and ${EMBER_SUPPORT_ATTACHMENT_MAX_BYTES} bytes.`);
    }
    const ttlMinutes = clampTtlMinutes(input.ttlMinutes);
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const id = `esa_${crypto.randomBytes(12).toString("base64url")}`;
    const sha256 = crypto.createHash("sha256").update(input.payload).digest("hex");
    const result = await this.poolProvider().query(
      `INSERT INTO brain_ember_support_attachments
       (
         id, session_id, support_request_id, page_path, file_name, content_type,
         size_bytes, sha256, payload, note, source, uploaded_by, request_id,
         metadata, created_at, expires_at
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9::bytea,$10,$11,$12,$13,$14::jsonb,$15::timestamptz,$16::timestamptz)
       RETURNING id, session_id, support_request_id, page_path, file_name, content_type,
         size_bytes, sha256, note, source, uploaded_by, request_id, metadata, created_at, expires_at`,
      [
        id,
        input.sessionId,
        input.supportRequestId,
        input.pagePath,
        input.fileName,
        input.contentType,
        input.payload.byteLength,
        sha256,
        input.payload,
        input.note,
        input.source,
        input.uploadedBy,
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
        now.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    return hydrateAttachment(result.rows[0] as Record<string, unknown>);
  }

  async pruneExpired(now = new Date()): Promise<EmberSupportAttachmentPruneResult> {
    const result = await this.poolProvider().query(
      `DELETE FROM brain_ember_support_attachments
       WHERE expires_at <= $1::timestamptz
          OR deleted_at IS NOT NULL`,
      [now.toISOString()],
    );
    return {
      deletedRows: rowCountOrZero(result.rowCount),
      deletedBefore: now.toISOString(),
    };
  }
}
