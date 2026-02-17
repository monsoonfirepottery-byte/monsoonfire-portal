import { randomBytes, createHmac } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db, nowTs } from "./shared";

export const INTEGRATION_TOKEN_PREFIX = "mf_pat_v1";

export const INTEGRATION_TOKEN_SCOPES = [
  "batches:read",
  "pieces:read",
  "timeline:read",
  "firings:read",
  "reservations:read",
  "events:read",
  "requests:read",
  "requests:write",
  "catalog:read",
  "quote:write",
  "reserve:write",
  "pay:write",
  "status:read",
] as const;

export type IntegrationTokenScope = (typeof INTEGRATION_TOKEN_SCOPES)[number];

export type IntegrationTokenPublic = {
  tokenId: string;
  label: string | null;
  scopes: IntegrationTokenScope[];
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  revokedAt: FirebaseFirestore.Timestamp | null;
};

function readPepper(): string {
  const raw = (process.env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (!raw) {
    throw new Error("INTEGRATION_TOKEN_PEPPER not configured");
  }
  return raw;
}

function hashSecret(secret: string): string {
  const pepper = readPepper();
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

function uniqStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function normalizeAndValidateScopes(
  input: unknown
): { ok: true; scopes: IntegrationTokenScope[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "scopes must be an array" };

  const scopes = uniqStrings(
    input
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
  );

  if (scopes.length < 1) return { ok: false, message: "At least 1 scope is required" };
  if (scopes.length > 20) return { ok: false, message: "Too many scopes" };

  const allow = new Set<string>(INTEGRATION_TOKEN_SCOPES);
  for (const s of scopes) {
    if (!allow.has(s)) return { ok: false, message: `Unknown scope: ${s}` };
  }

  return { ok: true, scopes: scopes as IntegrationTokenScope[] };
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function formatToken(tokenId: string, secret: string): string {
  return `${INTEGRATION_TOKEN_PREFIX}.${tokenId}.${secret}`;
}
function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTimestamp(value: unknown): Timestamp | null {
  return value instanceof Timestamp ? value : null;
}
export async function createIntegrationToken(params: {
  ownerUid: string;
  label: string | null;
  scopes: IntegrationTokenScope[];
}): Promise<{ tokenId: string; token: string; record: IntegrationTokenPublic }> {
  const { ownerUid, label, scopes } = params;

  const t = nowTs();

  // Uniqueness collisions are extremely unlikely, but we still guard with a short retry loop.
  for (let attempt = 0; attempt < 5; attempt++) {
    const tokenId = toBase64Url(randomBytes(16));
    const secret = toBase64Url(randomBytes(32));
    const secretHash = hashSecret(secret);

    const ref = db.collection("integrationTokens").doc(tokenId);

    const doc = {
      ownerUid,
      label: label || null,
      scopes,
      secretHash,
      createdAt: t,
      updatedAt: t,
      lastUsedAt: null,
      revokedAt: null,
    };

    try {
      await ref.create(doc);
    } catch (error: unknown) {
      const code = String(
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : ""
      );
      // ALREADY_EXISTS
      if (code.includes("already-exists") || code.includes("ALREADY_EXISTS")) {
        continue;
      }
      throw error;
    }

    const record: IntegrationTokenPublic = {
      tokenId,
      label: doc.label,
      scopes,
      createdAt: t,
      updatedAt: t,
      lastUsedAt: null,
      revokedAt: null,
    };

    return { tokenId, token: formatToken(tokenId, secret), record };
  }

  throw new Error("Failed to allocate integration token id");
}

export async function listIntegrationTokensForOwner(ownerUid: string): Promise<IntegrationTokenPublic[]> {
  const snap = await db
    .collection("integrationTokens")
    .where("ownerUid", "==", ownerUid)
    .limit(250)
    .get();

  const out: IntegrationTokenPublic[] = [];

  for (const doc of snap.docs) {
    const data = asRecord(doc.data()) ? (doc.data() as Record<string, unknown>) : {};
    out.push({
      tokenId: doc.id,
      label: typeof data.label === "string" ? data.label : null,
      scopes: Array.isArray(data?.scopes)
        ? (data.scopes.filter((entry): entry is string => typeof entry === "string") as IntegrationTokenScope[])
        : [],
      createdAt: asTimestamp(data.createdAt) ?? nowTs(),
      updatedAt: asTimestamp(data.updatedAt) ?? nowTs(),
      lastUsedAt: asTimestamp(data.lastUsedAt),
      revokedAt: asTimestamp(data.revokedAt),
    });
  }

  // Deterministic ordering without requiring composite indexes.
  out.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  return out;
}

export async function revokeIntegrationTokenForOwner(params: {
  ownerUid: string;
  tokenId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { ownerUid, tokenId } = params;
  const ref = db.collection("integrationTokens").doc(tokenId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: "Token not found" };

  const data = snap.data() as Record<string, unknown> | undefined;
  if (data?.ownerUid !== ownerUid) return { ok: false, message: "Forbidden" };

  const t = nowTs();
  await ref.set({ revokedAt: t, updatedAt: t }, { merge: true });
  return { ok: true };
}
