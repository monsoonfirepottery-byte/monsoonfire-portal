import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";

initializeApp();

export const db = getFirestore();
export const adminAuth = getAuth();

export { FieldValue, Timestamp };

export type HeaderValue = string | string[] | undefined;
export type HeaderRecord = Record<string, unknown>;
export type RequestLike = {
  headers?: HeaderRecord;
  method?: string;
  path?: string;
  ip?: string;
  body?: unknown;
  __mfAuth?: unknown;
  __mfAuthContext?: unknown;
};
export type ResponseLike = {
  status: (statusCode: number) => ResponseLike;
  json: (body: unknown) => void;
  set: (name: string, value: string) => void;
  send: (body: string) => void;
};

export function nowTs(): Timestamp {
  return Timestamp.now();
}

export function asInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function safeString(value: unknown): string;
export function safeString(value: unknown, fallback: string): string;
export function safeString(value: unknown, fallback: null): null;
export function safeString(value: unknown, fallback: string | null = ""): string | null {
  return typeof value === "string" ? value : fallback;
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://monsoonfire.com",
  "https://www.monsoonfire.com",
  "https://portal.monsoonfire.com",
  "https://monsoonfire-portal.web.app",
];

function readAllowedOrigins(): string[] {
  const raw = (process.env.ALLOWED_ORIGINS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowList = readAllowedOrigins();
  return allowList.includes(origin);
}

function allowDevAdminToken(): boolean {
  return (
    (process.env.ALLOW_DEV_ADMIN_TOKEN ?? "").trim() === "true" &&
    (process.env.FUNCTIONS_EMULATOR ?? "").trim() === "true"
  );
}

export function applyCors(req: RequestLike, res: ResponseLike): boolean {
  const headers = req.headers ?? {};
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  if (origin && !isOriginAllowed(origin)) {
    res.status(403).json({ ok: false, message: "Origin not allowed" });
    return true;
  }

  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-studio-brain-admin-token, x-request-id, idempotency-key"
  );
  res.set("Access-Control-Max-Age", "3600");

  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

export function readAdminTokenFromReq(req: RequestLike): string {
  const headers = req.headers ?? {};
  const header = headers["x-admin-token"];
  if (typeof header === "string") return header.trim();
  if (Array.isArray(header)) {
    const first = header[0];
    if (typeof first === "string") return first.trim();
    if (typeof first === "number") return String(first).trim();
  }
  return "";
}

export function isStaffFromDecoded(decoded: DecodedIdToken | null | undefined): boolean {
  if (!decoded) return false;
  const decodedRecord = decoded as Record<string, unknown> | null | undefined;
  const explicitStaff = decodedRecord?.staff;
  if (typeof explicitStaff === "boolean") return explicitStaff;
  const roles = Array.isArray(decodedRecord?.roles)
    ? decodedRecord.roles
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry): entry is "staff" => entry === "staff")
    : [];
  return roles.length > 0;
}

export function parseAuthToken(req: RequestLike): string | null {
  const headers = req.headers ?? {};
  const header = headers.authorization ?? headers.Authorization;
  const raw =
    typeof header === "string"
      ? header
      : Array.isArray(header)
      ? typeof header[0] === "string"
        ? header[0]
        : typeof header[0] === "number"
        ? String(header[0])
        : ""
      : "";
  if (!raw) return null;

  const parts = raw.trim().split(" ");
  if (parts.length < 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;

  const token = parts.slice(1).join(" ").trim();
  return token.length ? token : null;
}

export async function requireAuthUid(
  req: RequestLike
): Promise<{ ok: true; uid: string; decoded: DecodedIdToken } | { ok: false; message: string }> {
  const token = parseAuthToken(req);
  if (!token) return { ok: false, message: "Missing Authorization header" };

  try {
    const checkRevoked = boolEnv("STRICT_TOKEN_REVOCATION_CHECK", false);
    const decoded = await adminAuth.verifyIdToken(token, checkRevoked);
    req.__mfAuth = decoded;
    return { ok: true, uid: decoded.uid, decoded };
  } catch {
    return { ok: false, message: "Invalid Authorization token" };
  }
}

export type AuthContext =
  | {
      mode: "firebase";
      uid: string;
      decoded: DecodedIdToken;
      scopes: null;
      tokenId: null;
      delegated: null;
    }
  | {
      mode: "pat";
      uid: string;
      decoded: null;
      scopes: string[];
      tokenId: string;
      delegated: null;
    }
  | {
      mode: "delegated";
      uid: string;
      decoded: null;
      scopes: string[];
      tokenId: string;
      delegated: {
        agentClientId: string;
        audience: string;
        expiresAt: number;
        nonce: string;
        delegationId: string | null;
      };
    };

type SecurityAuditMode = "firebase" | "pat" | "delegated" | "unknown";
type SecurityAuditOutcome = "ok" | "deny" | "error";

export async function logSecurityEvent(params: {
  req: RequestLike;
  type: string;
  outcome: SecurityAuditOutcome;
  code?: string;
  uid?: string | null;
  mode?: SecurityAuditMode;
  tokenId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    const ipHash = hashClientIp(getClientIp(params.req));
    const uaHeader = params.req?.headers?.["user-agent"];
    const ua = typeof uaHeader === "string" ? uaHeader.slice(0, 200) : "";
    const path = typeof params.req?.path === "string" ? params.req.path : "";
    await db.collection("securityAudit").add({
      at: nowTs(),
      type: params.type,
      outcome: params.outcome,
      code: (params.code ?? "").trim() || null,
      uid: (params.uid ?? "").trim() || null,
      mode: (params.mode ?? "unknown").trim(),
      tokenId: (params.tokenId ?? "").trim() || null,
      ipHash,
      ua: ua || null,
      requestId: (params.requestId ?? "").trim() || null,
      path: path || null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Best-effort security logging should never block request handling.
  }
}

export async function logIntegrationTokenAudit(params: {
  req: RequestLike;
  type: "created" | "used" | "revoked" | "failed_auth" | "listed";
  tokenId?: string | null;
  ownerUid?: string | null;
  details?: Record<string, unknown> | null;
}) {
  try {
    const ipHash = hashClientIp(getClientIp(params.req));
    const uaHeader = params.req?.headers?.["user-agent"];
    const ua = typeof uaHeader === "string" ? uaHeader.slice(0, 200) : "";
    await db.collection("integrationTokenAudit").add({
      at: nowTs(),
      type: params.type,
      tokenId: (params.tokenId ?? "").trim() || null,
      ownerUid: (params.ownerUid ?? "").trim() || null,
      ipHash,
      userAgent: ua || null,
      details: params.details ?? null,
    });
  } catch {
    // Best-effort audit logging should never block request handling.
  }
}

function readIntegrationTokenPepper(): string | null {
  const raw = (process.env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  return raw.length ? raw : null;
}

function hashIntegrationTokenSecret(secret: string): string | null {
  const pepper = readIntegrationTokenPepper();
  if (!pepper) return null;
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

function parsePatToken(raw: string): { ok: true; tokenId: string; secret: string } | { ok: false } {
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false };
  if (parts[0] !== "mf_pat_v1") return { ok: false };
  const tokenId = parts[1] ?? "";
  const secret = parts[2] ?? "";
  if (!tokenId || !secret) return { ok: false };
  return { ok: true, tokenId, secret };
}

const DELEGATED_TOKEN_PREFIX = "mf_dlg_v1";
const DEFAULT_DELEGATED_AUDIENCE = "monsoonfire-agent-v1";

type DelegatedTokenPayload = {
  principalUid: string;
  agentClientId: string;
  scopes: string[];
  aud: string;
  exp: number;
  iat: number;
  nonce: string;
  delegationId?: string;
};

function readDelegatedTokenSecret(): string | null {
  const raw = (process.env.DELEGATED_AGENT_TOKEN_SECRET ?? "").trim();
  return raw.length ? raw : null;
}

function delegatedAudience(): string {
  const raw = (process.env.DELEGATED_TOKEN_AUDIENCE ?? "").trim();
  return raw.length ? raw : DEFAULT_DELEGATED_AUDIENCE;
}

function delegatedMaxAgeMs(): number {
  const raw = Number(process.env.DELEGATED_TOKEN_MAX_AGE_MS ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  return 10 * 60 * 1000;
}

function signDelegatedPayload(encodedPayload: string): string | null {
  const secret = readDelegatedTokenSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseDelegatedToken(raw: string): { ok: true; payloadEncoded: string; signature: string } | { ok: false } {
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false };
  if (parts[0] !== DELEGATED_TOKEN_PREFIX) return { ok: false };
  const payloadEncoded = parts[1] ?? "";
  const signature = parts[2] ?? "";
  if (!payloadEncoded || !signature) return { ok: false };
  return { ok: true, payloadEncoded, signature };
}

function decodeDelegatedPayload(encodedPayload: string): DelegatedTokenPayload | null {
  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const principalUid = typeof parsed.principalUid === "string" ? parsed.principalUid.trim() : "";
    const agentClientId = typeof parsed.agentClientId === "string" ? parsed.agentClientId.trim() : "";
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const aud = typeof parsed.aud === "string" ? parsed.aud.trim() : "";
    const exp = typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? Math.trunc(parsed.exp) : 0;
    const iat = typeof parsed.iat === "number" && Number.isFinite(parsed.iat) ? Math.trunc(parsed.iat) : 0;
    const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
    const delegationId =
      typeof parsed.delegationId === "string" && parsed.delegationId.trim().length
        ? parsed.delegationId.trim()
        : undefined;
    if (!principalUid || !agentClientId || !aud || !nonce || !scopes.length || exp <= 0 || iat <= 0) {
      return null;
    }
    return { principalUid, agentClientId, scopes, aud, exp, iat, nonce, delegationId };
  } catch {
    return null;
  }
}

function constantTimeCompareStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function claimDelegatedNonce(payload: DelegatedTokenPayload): Promise<boolean> {
  const now = Date.now();
  if (payload.exp <= now) return false;
  const nonceHash = createHash("sha256")
    .update(`${payload.nonce}:${payload.agentClientId}:${payload.principalUid}:${payload.exp}`)
    .digest("hex")
    .slice(0, 40);
  const ref = db.collection("delegatedTokenNonces").doc(nonceHash);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        throw new Error("nonce_replayed");
      }
      tx.create(ref, {
        nonce: payload.nonce,
        principalUid: payload.principalUid,
        agentClientId: payload.agentClientId,
        expMs: payload.exp,
        aud: payload.aud,
        createdAt: nowTs(),
        expiresAt: Timestamp.fromMillis(payload.exp),
      });
    });
    return true;
  } catch {
    return false;
  }
}

export function createDelegatedAgentToken(params: {
  principalUid: string;
  agentClientId: string;
  scopes: string[];
  ttlSeconds: number;
  audience?: string | null;
  delegationId?: string | null;
}): { token: string; expiresAt: number; nonce: string; audience: string } {
  const now = Date.now();
  const ttlSeconds = Math.max(30, Math.min(params.ttlSeconds, 600));
  const expiresAt = now + ttlSeconds * 1000;
  const nonce = randomBytes(12).toString("base64url");
  const audience = (params.audience ?? "").trim() || delegatedAudience();
  const payload: DelegatedTokenPayload = {
    principalUid: params.principalUid,
    agentClientId: params.agentClientId,
    scopes: params.scopes,
    aud: audience,
    exp: expiresAt,
    iat: now,
    nonce,
    delegationId: params.delegationId ?? undefined,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signDelegatedPayload(payloadEncoded);
  if (!signature) {
    throw new Error("DELEGATED_AGENT_TOKEN_SECRET not configured");
  }
  return {
    token: `${DELEGATED_TOKEN_PREFIX}.${payloadEncoded}.${signature}`,
    expiresAt,
    nonce,
    audience,
  };
}

export async function requireAuthContext(
  req: RequestLike
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; code: "UNAUTHENTICATED"; message: string }> {
  const cached = req.__mfAuthContext as AuthContext | undefined;
  if (cached && typeof cached.uid === "string" && cached.uid) return { ok: true, ctx: cached };

  const token = parseAuthToken(req);
  if (!token) {
    void logSecurityEvent({
      req,
      type: "auth_missing_authorization",
      outcome: "deny",
      code: "MISSING_AUTH_HEADER",
      mode: "unknown",
    });
    return { ok: false, code: "UNAUTHENTICATED", message: "Missing Authorization header" };
  }

  // Delegated auth token
  if (token.startsWith(`${DELEGATED_TOKEN_PREFIX}.`)) {
    const parsed = parseDelegatedToken(token);
    if (!parsed.ok) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_PARSE_FAILED", mode: "delegated" });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const expectedSignature = signDelegatedPayload(parsed.payloadEncoded);
    if (!expectedSignature || !constantTimeCompareStrings(expectedSignature, parsed.signature)) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_SIGNATURE_INVALID", mode: "delegated" });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const payload = decodeDelegatedPayload(parsed.payloadEncoded);
    if (!payload) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_PAYLOAD_INVALID", mode: "delegated" });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (payload.aud !== delegatedAudience()) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_AUDIENCE_MISMATCH", mode: "delegated", tokenId: payload.agentClientId });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    const nowMs = Date.now();
    if (payload.exp <= nowMs) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_EXPIRED", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (payload.iat > nowMs + 60_000) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_ISSUED_IN_FUTURE", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (nowMs - payload.iat > delegatedMaxAgeMs()) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_TOKEN_TOO_OLD", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const clientRef = db.collection("agentClients").doc(payload.agentClientId);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_CLIENT_NOT_FOUND", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    const clientData = clientSnap.data() as Record<string, unknown>;
    const status = typeof clientData.status === "string" ? clientData.status : "active";
    if (status !== "active") {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_CLIENT_INACTIVE", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    const allowedScopes = Array.isArray(clientData.scopes)
      ? clientData.scopes.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (payload.scopes.some((scope) => !allowedScopes.includes(scope))) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_SCOPE_INVALID", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const nonceOk = await claimDelegatedNonce(payload);
    if (!nonceOk) {
      void logSecurityEvent({ req, type: "auth_delegated_denied", outcome: "deny", code: "DELEGATED_NONCE_REPLAY", mode: "delegated", tokenId: payload.agentClientId, uid: payload.principalUid });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const ctx: AuthContext = {
      mode: "delegated",
      uid: payload.principalUid,
      decoded: null,
      scopes: payload.scopes,
      tokenId: payload.agentClientId,
      delegated: {
        agentClientId: payload.agentClientId,
        audience: payload.aud,
        expiresAt: payload.exp,
        nonce: payload.nonce,
        delegationId: payload.delegationId ?? null,
      },
    };
    req.__mfAuthContext = ctx;

    try {
      const t = nowTs();
      await clientRef.set({ lastUsedAt: t, updatedAt: t }, { merge: true });
    } catch {
      // ignore
    }
    void logSecurityEvent({
      req,
      type: "auth_delegated_ok",
      outcome: "ok",
      code: "DELEGATED_AUTH_OK",
      mode: "delegated",
      uid: payload.principalUid,
      tokenId: payload.agentClientId,
      metadata: { scopeCount: payload.scopes.length, audience: payload.aud },
    });

    return { ok: true, ctx };
  }

  // PAT auth
  if (token.startsWith("mf_pat_v1.")) {
    const parsed = parsePatToken(token);
    if (!parsed.ok) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_PARSE_FAILED", mode: "pat" });
      void logIntegrationTokenAudit({ req, type: "failed_auth", details: { reason: "PAT_PARSE_FAILED" } });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const gotHash = hashIntegrationTokenSecret(parsed.secret);
    if (!gotHash) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_HASH_UNAVAILABLE", mode: "pat", tokenId: parsed.tokenId });
      void logIntegrationTokenAudit({
        req,
        type: "failed_auth",
        tokenId: parsed.tokenId,
        details: { reason: "PAT_HASH_UNAVAILABLE" },
      });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const ref = db.collection("integrationTokens").doc(parsed.tokenId);
    const snap = await ref.get();
    if (!snap.exists) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_TOKEN_NOT_FOUND", mode: "pat", tokenId: parsed.tokenId });
      void logIntegrationTokenAudit({
        req,
        type: "failed_auth",
        tokenId: parsed.tokenId,
        details: { reason: "PAT_TOKEN_NOT_FOUND" },
      });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const data = snap.data() as Record<string, unknown> | undefined;
    const expectedHash = typeof data?.secretHash === "string" ? data.secretHash : "";
    const ownerUid = typeof data?.ownerUid === "string" ? data.ownerUid : "";
    const revokedAt = data?.revokedAt ?? null;
    const scopes = Array.isArray(data?.scopes)
      ? data.scopes.filter((entry): entry is string => typeof entry === "string")
      : [];

    // Revoked or malformed records are treated as unauthorized.
    if (!expectedHash || !ownerUid || revokedAt) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_REVOKED_OR_INVALID", mode: "pat", tokenId: parsed.tokenId, uid: ownerUid || null });
      void logIntegrationTokenAudit({
        req,
        type: "failed_auth",
        tokenId: parsed.tokenId,
        ownerUid: ownerUid || null,
        details: { reason: "PAT_REVOKED_OR_INVALID" },
      });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const expectedBuf = Buffer.from(expectedHash, "hex");
    const gotBuf = Buffer.from(gotHash, "hex");
    if (expectedBuf.length !== gotBuf.length) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_HASH_LENGTH_MISMATCH", mode: "pat", tokenId: parsed.tokenId, uid: ownerUid });
      void logIntegrationTokenAudit({
        req,
        type: "failed_auth",
        tokenId: parsed.tokenId,
        ownerUid,
        details: { reason: "PAT_HASH_LENGTH_MISMATCH" },
      });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (!timingSafeEqual(expectedBuf, gotBuf)) {
      void logSecurityEvent({ req, type: "auth_pat_denied", outcome: "deny", code: "PAT_HASH_MISMATCH", mode: "pat", tokenId: parsed.tokenId, uid: ownerUid });
      void logIntegrationTokenAudit({
        req,
        type: "failed_auth",
        tokenId: parsed.tokenId,
        ownerUid,
        details: { reason: "PAT_HASH_MISMATCH" },
      });
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const ctx: AuthContext = {
      mode: "pat",
      uid: ownerUid,
      decoded: null,
      scopes,
      tokenId: parsed.tokenId,
      delegated: null,
    };
    req.__mfAuthContext = ctx;

    // Best-effort usage marker (never block auth if this fails).
    try {
      const t = nowTs();
      await ref.set({ lastUsedAt: t, updatedAt: t }, { merge: true });
    } catch {
      // ignore
    }
    void logSecurityEvent({
      req,
      type: "auth_pat_ok",
      outcome: "ok",
      code: "PAT_AUTH_OK",
      mode: "pat",
      uid: ownerUid,
      tokenId: parsed.tokenId,
      metadata: { scopeCount: scopes.length },
    });
    void logIntegrationTokenAudit({
      req,
      type: "used",
      tokenId: parsed.tokenId,
      ownerUid,
      details: { scopeCount: scopes.length },
    });

    return { ok: true, ctx };
  }

  // Firebase ID token auth
  const auth = await requireAuthUid(req);
  if (!auth.ok) return { ok: false, code: "UNAUTHENTICATED", message: auth.message };

  const ctx: AuthContext = {
    mode: "firebase",
    uid: auth.uid,
    decoded: auth.decoded,
    scopes: null,
    tokenId: null,
    delegated: null,
  };
  req.__mfAuthContext = ctx;
  return { ok: true, ctx };
}

async function getAuthDecoded(req: RequestLike): Promise<DecodedIdToken | null> {
  const cached = req.__mfAuth as DecodedIdToken | undefined;
  if (cached) return cached;
  const token = parseAuthToken(req);
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.__mfAuth = decoded;
    return decoded;
  } catch {
    return null;
  }
}

export async function requireAdmin(
  req: RequestLike
): Promise<{ ok: true; mode: "staff" | "dev" } | { ok: false; message: string }> {
  const decoded = await getAuthDecoded(req);
  if (!decoded) return { ok: false, message: "Unauthorized" };

  if (isStaffFromDecoded(decoded)) {
    return { ok: true, mode: "staff" };
  }

  if (allowDevAdminToken()) {
    const expected = (process.env.ADMIN_TOKEN ?? "").trim();
    if (expected) {
      const got = readAdminTokenFromReq(req);
      if (got && got === expected) return { ok: true, mode: "dev" };
    }
  }

  return { ok: false, message: "Unauthorized" };
}

type RateLimitState = {
  count: number;
  resetAt: number;
  expiresAt?: Timestamp;
};

const RATE_LIMIT_BUCKETS = new Map<string, RateLimitState>();

export function evaluateRateLimitWindow(params: {
  state: Pick<RateLimitState, "count" | "resetAt"> | null;
  nowMs: number;
  max: number;
  windowMs: number;
}): {
  ok: boolean;
  retryAfterMs: number;
  nextState: RateLimitState;
} {
  const normalizedMax = Number.isFinite(params.max) ? Math.max(1, Math.trunc(params.max)) : 1;
  const normalizedWindowMs = Number.isFinite(params.windowMs) ? Math.max(1, Math.trunc(params.windowMs)) : 1;
  const nowMs = Number.isFinite(params.nowMs) ? Math.trunc(params.nowMs) : Date.now();
  const existing = params.state;

  if (!existing || existing.resetAt <= nowMs) {
    return {
      ok: true,
      retryAfterMs: 0,
      nextState: { count: 1, resetAt: nowMs + normalizedWindowMs },
    };
  }

  const nextCount = existing.count + 1;
  if (nextCount > normalizedMax) {
    return {
      ok: false,
      retryAfterMs: Math.max(1, existing.resetAt - nowMs),
      nextState: { count: nextCount, resetAt: existing.resetAt },
    };
  }

  return {
    ok: true,
    retryAfterMs: 0,
    nextState: { count: nextCount, resetAt: existing.resetAt },
  };
}

function getClientIp(req: RequestLike): string {
  const headers = req.headers ?? {};
  const header = headers["x-forwarded-for"];
  if (typeof header === "string" && header.trim()) {
    return header.split(",")[0].trim();
  }
  if (Array.isArray(header) && header[0]) return String(header[0]).trim();
  return typeof req.ip === "string" ? req.ip : "unknown";
}

function hashClientIp(ip: string): string {
  // Avoid storing raw IPs in Firestore while still keeping rate limits stable per client.
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function enforceRateLimit(params: {
  req: RequestLike;
  key: string;
  max: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const { req, key, max, windowMs } = params;
  const cachedCtx = req.__mfAuthContext as AuthContext | undefined;
  const uid = cachedCtx?.uid ?? (req.__mfAuth as { uid?: string } | undefined)?.uid ?? "anon";
  const ipHash = hashClientIp(getClientIp(req));
  const bucketKey = `${key}:${uid}:${ipHash}`;
  const now = Date.now();

  const local = RATE_LIMIT_BUCKETS.get(bucketKey);
  const localDecision = evaluateRateLimitWindow({
    state: local ? { count: local.count, resetAt: local.resetAt } : null,
    nowMs: now,
    max,
    windowMs,
  });
  RATE_LIMIT_BUCKETS.set(bucketKey, localDecision.nextState);

  const docRef = db.collection("rateLimits").doc(bucketKey);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? (snap.data() as RateLimitState) : null;
      const resetAt = data?.resetAt && data.resetAt > now ? data.resetAt : now + windowMs;
      const count = data?.resetAt && data.resetAt > now ? (data.count ?? 0) + 1 : 1;

      // Enables Firestore TTL cleanup if configured on `rateLimits.expiresAt`.
      const expiresAt = Timestamp.fromMillis(resetAt + windowMs * 2);
      tx.set(docRef, { count, resetAt, expiresAt }, { merge: true });
      return { count, resetAt };
    });

    if (result.count > max) {
      return { ok: false, retryAfterMs: result.resetAt - now };
    }
    return { ok: true };
  } catch {
    if (!localDecision.ok) {
      return { ok: false, retryAfterMs: localDecision.retryAfterMs };
    }
    const fallback = RATE_LIMIT_BUCKETS.get(bucketKey);
    if (fallback && fallback.count > max) {
      return { ok: false, retryAfterMs: Math.max(fallback.resetAt - now, 1) };
    }
    return { ok: true };
  }
}

export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): { ok: true; data: T } | { ok: false; message: string } {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue?.message || "Invalid request body";
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}

export function makeIdempotencyId(prefix: string, uid: string, clientRequestId: string): string {
  const raw = `${prefix}:${uid}:${clientRequestId}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 20);
  return `${prefix}-${hash}`;
}
