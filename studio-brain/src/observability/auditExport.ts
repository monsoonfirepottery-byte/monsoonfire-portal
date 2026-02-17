import crypto from "node:crypto";
import type { AuditEvent } from "../stores/interfaces";

export type AuditExportBundle = {
  generatedAt: string;
  manifest: {
    rowCount: number;
    payloadHash: string;
    rowHashes: string[];
    firstAt: string | null;
    lastAt: string | null;
    signature: string | null;
    signatureAlgorithm: "hmac-sha256" | null;
  };
  rows: AuditEvent[];
};

function hashJson(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildAuditExportBundle(rows: AuditEvent[], options?: { generatedAt?: string; signingKey?: string }): AuditExportBundle {
  const generatedAt = options?.generatedAt ?? new Date().toISOString();
  const rowHashes = rows.map((row) => hashJson(row));
  const payloadHash = hashJson(rows);
  const firstAt = rows.length ? rows[rows.length - 1]?.at ?? null : null;
  const lastAt = rows.length ? rows[0]?.at ?? null : null;
  const signatureAlgorithm: "hmac-sha256" | null = options?.signingKey ? "hmac-sha256" : null;
  const signature = options?.signingKey
    ? crypto
        .createHmac("sha256", options.signingKey)
        .update(hashJson({ generatedAt, payloadHash, rowCount: rows.length, firstAt, lastAt }))
        .digest("hex")
    : null;
  return {
    generatedAt,
    manifest: {
      rowCount: rows.length,
      payloadHash,
      rowHashes,
      firstAt,
      lastAt,
      signature,
      signatureAlgorithm,
    },
    rows,
  };
}

export function verifyAuditExportBundle(bundle: AuditExportBundle, signingKey?: string): { ok: boolean; reason: string | null } {
  const payloadHash = hashJson(bundle.rows);
  if (payloadHash !== bundle.manifest.payloadHash) {
    return { ok: false, reason: "PAYLOAD_HASH_MISMATCH" };
  }
  const rowHashes = bundle.rows.map((row) => hashJson(row));
  if (JSON.stringify(rowHashes) !== JSON.stringify(bundle.manifest.rowHashes)) {
    return { ok: false, reason: "ROW_HASH_MISMATCH" };
  }
  if (bundle.manifest.signatureAlgorithm === "hmac-sha256") {
    if (!signingKey || !bundle.manifest.signature) {
      return { ok: false, reason: "SIGNATURE_KEY_REQUIRED" };
    }
    const expected = crypto
      .createHmac("sha256", signingKey)
      .update(hashJson({
        generatedAt: bundle.generatedAt,
        payloadHash: bundle.manifest.payloadHash,
        rowCount: bundle.manifest.rowCount,
        firstAt: bundle.manifest.firstAt,
        lastAt: bundle.manifest.lastAt,
      }))
      .digest("hex");
    if (expected !== bundle.manifest.signature) {
      return { ok: false, reason: "SIGNATURE_MISMATCH" };
    }
  }
  return { ok: true, reason: null };
}
