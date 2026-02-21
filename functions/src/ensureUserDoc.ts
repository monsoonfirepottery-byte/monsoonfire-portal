import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import {
  adminAuth,
  applyCors,
  db,
  nowTs,
  requireAuthUid,
  safeString,
  type ResponseLike,
} from "./shared";

const REGION = "us-central1";

function isEmulatorRuntime(): boolean {
  return (process.env.FUNCTIONS_EMULATOR ?? "").trim() === "true";
}

function nullableTrimmed(value: unknown): string | null {
  const normalized = safeString(value).trim();
  return normalized.length ? normalized : null;
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: unknown; details?: unknown; message?: unknown };
  if (maybe.code === 6 || maybe.code === "already-exists" || maybe.code === "ALREADY_EXISTS") return true;
  if (typeof maybe.details === "string" && maybe.details.toLowerCase().includes("already exists")) return true;
  if (typeof maybe.message === "string" && maybe.message.toLowerCase().includes("already exists")) return true;
  return false;
}

function jsonError(
  res: ResponseLike,
  status: number,
  code: string,
  message: string
) {
  res.status(status).json({ ok: false, code, message });
}

async function createDocIfMissing(params: {
  path: string;
  payload: Record<string, unknown>;
}): Promise<"created" | "exists"> {
  const ref = db.doc(params.path);
  const existing = await ref.get();
  if (existing.exists) return "exists";

  try {
    await ref.create(params.payload);
    return "created";
  } catch (error: unknown) {
    if (isAlreadyExistsError(error)) return "exists";
    throw error;
  }
}

export const ensureUserDoc = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") {
      jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      jsonError(res, 401, "UNAUTHENTICATED", auth.message);
      return;
    }

    const uid = auth.uid;
    const decoded = auth.decoded as Record<string, unknown>;
    const email = nullableTrimmed(decoded.email);
    const displayName = nullableTrimmed(decoded.name) ?? nullableTrimmed(decoded.displayName);
    const photoURL = nullableTrimmed(decoded.picture) ?? nullableTrimmed(decoded.photoURL);

    const now = nowTs();
    const userPayload = compactRecord({
      uid,
      email,
      displayName,
      photoURL,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const profilePayload = compactRecord({
      displayName,
      uiTheme: null,
      uiEnhancedMotion: null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const [userResult, profileResult] = await Promise.all([
        createDocIfMissing({ path: `users/${uid}`, payload: userPayload }),
        createDocIfMissing({ path: `profiles/${uid}`, payload: profilePayload }),
      ]);

      const userCreated = userResult === "created";
      const profileCreated = profileResult === "created";

      logger.info("ensureUserDoc complete", {
        uid,
        userCreated,
        profileCreated,
      });

      res.status(200).json({
        ok: true,
        code: "OK",
        userCreated,
        profileCreated,
      });
    } catch (error: unknown) {
      const message = messageFromError(error);
      logger.error("ensureUserDoc failed", {
        uid,
        errorMessage: message,
        stack: error instanceof Error ? error.stack ?? null : null,
      });
      jsonError(res, 500, "ENSURE_USER_DOC_FAILED", "Unable to ensure user document");
    }
  }
);

export const emulatorGrantStaffRole = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") {
      jsonError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");
      return;
    }

    if (!isEmulatorRuntime()) {
      jsonError(res, 404, "NOT_FOUND", "This endpoint is emulator-only.");
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      jsonError(res, 401, "UNAUTHENTICATED", auth.message);
      return;
    }

    const uid = auth.uid;

    try {
      const record = await adminAuth.getUser(uid);
      const existingClaims = (record.customClaims ?? {}) as Record<string, unknown>;
      const roles = Array.isArray(existingClaims.roles)
        ? existingClaims.roles
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];
      const nextRoles = Array.from(new Set([...roles, "staff"]));

      await adminAuth.setCustomUserClaims(uid, {
        ...existingClaims,
        staff: true,
        roles: nextRoles,
      });

      logger.info("emulatorGrantStaffRole complete", { uid, roles: nextRoles });

      res.status(200).json({
        ok: true,
        code: "STAFF_GRANTED",
        uid,
        roles: nextRoles,
        tokenNeedsRefresh: true,
      });
    } catch (error: unknown) {
      const message = messageFromError(error);
      logger.error("emulatorGrantStaffRole failed", {
        uid,
        errorMessage: message,
        stack: error instanceof Error ? error.stack ?? null : null,
      });
      jsonError(res, 500, "EMULATOR_STAFF_GRANT_FAILED", "Unable to grant staff role in emulator");
    }
  }
);
