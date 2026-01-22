import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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

export function applyCors(req: any, res: any): boolean {
  const origin = (req.headers.origin as string | undefined) ?? "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token"
  );
  res.set("Access-Control-Max-Age", "3600");

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

export function requireAdmin(req: any): { ok: true } | { ok: false; message: string } {
  const expected = (process.env.ADMIN_TOKEN ?? "").trim();
  if (!expected) return { ok: false, message: "ADMIN_TOKEN not configured" };
  const got = readAdminTokenFromReq(req);
  if (!got) return { ok: false, message: "Missing x-admin-token" };
  if (got !== expected) return { ok: false, message: "Unauthorized" };
  return { ok: true };
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
): Promise<{ ok: true; uid: string } | { ok: false; message: string }> {
  const token = parseAuthToken(req);
  if (!token) return { ok: false, message: "Missing Authorization header" };

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, message: "Invalid Authorization token" };
  }
}
