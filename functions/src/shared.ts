import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { createHash } from "crypto";
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
    "Content-Type, Authorization, x-admin-token"
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

function isStaffClaim(decoded: DecodedIdToken): boolean {
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

  if (isStaffClaim(decoded)) {
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

export async function enforceRateLimit(params: {
  req: any;
  key: string;
  max: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const { req, key, max, windowMs } = params;
  const uid = (req as any).__mfAuth?.uid ?? "anon";
  const ip = getClientIp(req);
  const bucketKey = `${key}:${uid}:${ip}`;
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
