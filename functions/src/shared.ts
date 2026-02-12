import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";

initializeApp();

export const db = getFirestore();
export const adminAuth = getAuth();

export { FieldValue, Timestamp };

export function nowTs(): Timestamp {
  return Timestamp.now();
}

export function asInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://monsoonfire.com",
  "https://www.monsoonfire.com",
  "https://portal.monsoonfire.com",
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

export function applyCors(req: any, res: any): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin && !isOriginAllowed(origin)) {
    res.status(403).json({ ok: false, message: "Origin not allowed" });
    return true;
  }

  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-request-id, idempotency-key"
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

export function readAdminTokenFromReq(req: any): string {
  const header = req.headers["x-admin-token"];
  if (typeof header === "string") return header.trim();
  if (Array.isArray(header)) return (header[0] ?? "").trim();
  return "";
}

export function isStaffFromDecoded(decoded: DecodedIdToken | null | undefined): boolean {
  if (!decoded) return false;
  if ((decoded as any).staff === true) return true;
  const roles = (decoded as any).roles;
  return Array.isArray(roles) && roles.includes("staff");
}

export function parseAuthToken(req: any): string | null {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  const raw =
    typeof header === "string" ? header : Array.isArray(header) ? header[0] : "";
  if (!raw) return null;

  const parts = raw.trim().split(" ");
  if (parts.length < 2) return null;
  if (parts[0].toLowerCase() !== "bearer") return null;

  const token = parts.slice(1).join(" ").trim();
  return token.length ? token : null;
}

export async function requireAuthUid(
  req: any
): Promise<{ ok: true; uid: string; decoded: DecodedIdToken } | { ok: false; message: string }> {
  const token = parseAuthToken(req);
  if (!token) return { ok: false, message: "Missing Authorization header" };

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    (req as any).__mfAuth = decoded;
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
      };
    };

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
};

function readDelegatedTokenSecret(): string | null {
  const raw = (process.env.DELEGATED_AGENT_TOKEN_SECRET ?? "").trim();
  return raw.length ? raw : null;
}

function delegatedAudience(): string {
  const raw = (process.env.DELEGATED_TOKEN_AUDIENCE ?? "").trim();
  return raw.length ? raw : DEFAULT_DELEGATED_AUDIENCE;
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
    if (!principalUid || !agentClientId || !aud || !nonce || !scopes.length || exp <= 0 || iat <= 0) {
      return null;
    }
    return { principalUid, agentClientId, scopes, aud, exp, iat, nonce };
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
  req: any
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; code: "UNAUTHENTICATED"; message: string }> {
  const cached = (req as any).__mfAuthContext as AuthContext | undefined;
  if (cached && typeof cached.uid === "string" && cached.uid) return { ok: true, ctx: cached };

  const token = parseAuthToken(req);
  if (!token) return { ok: false, code: "UNAUTHENTICATED", message: "Missing Authorization header" };

  // Delegated auth token
  if (token.startsWith(`${DELEGATED_TOKEN_PREFIX}.`)) {
    const parsed = parseDelegatedToken(token);
    if (!parsed.ok) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };

    const expectedSignature = signDelegatedPayload(parsed.payloadEncoded);
    if (!expectedSignature || !constantTimeCompareStrings(expectedSignature, parsed.signature)) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const payload = decodeDelegatedPayload(parsed.payloadEncoded);
    if (!payload) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    if (payload.aud !== delegatedAudience()) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (payload.exp <= Date.now()) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const clientRef = db.collection("agentClients").doc(payload.agentClientId);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    const clientData = clientSnap.data() as Record<string, unknown>;
    const status = typeof clientData.status === "string" ? clientData.status : "active";
    if (status !== "active") return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    const allowedScopes = Array.isArray(clientData.scopes)
      ? clientData.scopes.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (payload.scopes.some((scope) => !allowedScopes.includes(scope))) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const nonceOk = await claimDelegatedNonce(payload);
    if (!nonceOk) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };

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
      },
    };
    (req as any).__mfAuthContext = ctx;

    try {
      const t = nowTs();
      await clientRef.set({ lastUsedAt: t, updatedAt: t }, { merge: true });
    } catch {
      // ignore
    }

    return { ok: true, ctx };
  }

  // PAT auth
  if (token.startsWith("mf_pat_v1.")) {
    const parsed = parsePatToken(token);
    if (!parsed.ok) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };

    const gotHash = hashIntegrationTokenSecret(parsed.secret);
    if (!gotHash) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };

    const ref = db.collection("integrationTokens").doc(parsed.tokenId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };

    const data = snap.data() as any;
    const expectedHash = typeof data?.secretHash === "string" ? data.secretHash : "";
    const ownerUid = typeof data?.ownerUid === "string" ? data.ownerUid : "";
    const revokedAt = data?.revokedAt ?? null;
    const scopes = Array.isArray(data?.scopes) ? data.scopes.filter((s: any) => typeof s === "string") : [];

    // Revoked or malformed records are treated as unauthorized.
    if (!expectedHash || !ownerUid || revokedAt) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }

    const expectedBuf = Buffer.from(expectedHash, "hex");
    const gotBuf = Buffer.from(gotHash, "hex");
    if (expectedBuf.length !== gotBuf.length) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Unauthorized" };
    }
    if (!timingSafeEqual(expectedBuf, gotBuf)) {
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
    (req as any).__mfAuthContext = ctx;

    // Best-effort usage marker (never block auth if this fails).
    try {
      const t = nowTs();
      await ref.set({ lastUsedAt: t, updatedAt: t }, { merge: true });
    } catch {
      // ignore
    }

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
  (req as any).__mfAuthContext = ctx;
  return { ok: true, ctx };
}

async function getAuthDecoded(req: any): Promise<DecodedIdToken | null> {
  const cached = (req as any).__mfAuth as DecodedIdToken | undefined;
  if (cached) return cached;
  const token = parseAuthToken(req);
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    (req as any).__mfAuth = decoded;
    return decoded;
  } catch {
    return null;
  }
}

export async function requireAdmin(
  req: any
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

function getClientIp(req: any): string {
  const header = req.headers["x-forwarded-for"];
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
  req: any;
  key: string;
  max: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const { req, key, max, windowMs } = params;
  const cachedCtx = (req as any).__mfAuthContext as AuthContext | undefined;
  const uid = cachedCtx?.uid ?? (req as any).__mfAuth?.uid ?? "anon";
  const ipHash = hashClientIp(getClientIp(req));
  const bucketKey = `${key}:${uid}:${ipHash}`;
  const now = Date.now();

  const local = RATE_LIMIT_BUCKETS.get(bucketKey);
  if (!local || local.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(bucketKey, { count: 1, resetAt: now + windowMs });
  } else {
    local.count += 1;
    RATE_LIMIT_BUCKETS.set(bucketKey, local);
  }

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
    const fallback = RATE_LIMIT_BUCKETS.get(bucketKey);
    if (fallback && fallback.count > max) {
      return { ok: false, retryAfterMs: Math.max(fallback.resetAt - now, 0) };
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
