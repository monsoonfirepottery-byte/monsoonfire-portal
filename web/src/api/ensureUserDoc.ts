import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "../lib/safeStorage";

type ImportMetaEnvShape = {
  VITE_FUNCTIONS_BASE_URL?: string;
};

const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

const inFlightBySession = new Map<string, Promise<EnsureUserDocResult>>();
const sessionGuards = new Set<string>();
const RETRY_COOLDOWN_MS = 30_000;

export type EnsureUserDocResult = {
  ok: boolean;
  userCreated: boolean;
  profileCreated: boolean;
  skipped?: boolean;
  retrySuppressed?: boolean;
  retryAfterMs?: number;
  message?: string;
  code?: string;
};

export type EnsureUserDocArgs = {
  uid: string;
  getIdToken: () => Promise<string>;
  baseUrl?: string;
  projectId?: string;
};

function resolveBaseUrl(input?: string): string {
  const raw = (input ?? ENV.VITE_FUNCTIONS_BASE_URL ?? DEFAULT_FUNCTIONS_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

function bootstrapSuccessKey(uid: string, projectId: string): string {
  return `bootstrapped:${uid}:${projectId}`;
}

function retryCooldownKey(uid: string, projectId: string): string {
  return `bootstrappedRetryAfter:${uid}:${projectId}`;
}

function readRetryCooldown(uid: string, projectId: string): number {
  try {
    const raw = safeStorageGetItem("localStorage", retryCooldownKey(uid, projectId));
    const parsed = Number(raw ?? "0");
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function writeRetryCooldown(uid: string, projectId: string, value: number) {
  try {
    safeStorageSetItem("localStorage", retryCooldownKey(uid, projectId), String(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function clearRetryCooldown(uid: string, projectId: string) {
  try {
    safeStorageRemoveItem("localStorage", retryCooldownKey(uid, projectId));
  } catch {
    // Ignore localStorage failures.
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function ensureUserDocForSession(args: EnsureUserDocArgs): Promise<EnsureUserDocResult> {
  const projectId = (args.projectId ?? "monsoonfire-portal").trim() || "monsoonfire-portal";
  const sessionKey = `${projectId}:${args.uid}`;

  if (sessionGuards.has(sessionKey)) {
    return { ok: true, userCreated: false, profileCreated: false, skipped: true };
  }

  try {
    const key = bootstrapSuccessKey(args.uid, projectId);
    if (safeStorageGetItem("localStorage", key) === "1") {
      sessionGuards.add(sessionKey);
      return { ok: true, userCreated: false, profileCreated: false, skipped: true };
    }
  } catch {
    // Ignore storage availability issues.
  }

  const retryAfterMs = readRetryCooldown(args.uid, projectId);
  if (retryAfterMs > Date.now()) {
    const waitMs = Math.max(0, retryAfterMs - Date.now());
    return {
      ok: false,
      userCreated: false,
      profileCreated: false,
      skipped: true,
      retrySuppressed: true,
      retryAfterMs: waitMs,
      code: "RETRY_COOLDOWN",
      message: "ensureUserDoc retry temporarily suppressed.",
    };
  }

  const existing = inFlightBySession.get(sessionKey);
  if (existing) {
    return await existing;
  }

  const run = (async (): Promise<EnsureUserDocResult> => {
    try {
      const idToken = await args.getIdToken();
      if (!idToken || !idToken.trim().length) {
        return {
          ok: false,
          userCreated: false,
          profileCreated: false,
          code: "TOKEN_UNAVAILABLE",
          message: "ID token unavailable.",
        };
      }

      const resp = await fetch(`${resolveBaseUrl(args.baseUrl)}/ensureUserDoc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: "{}",
      });

      const body = (await resp.json().catch(() => null)) as
        | {
            ok?: boolean;
            code?: string;
            userCreated?: boolean;
            profileCreated?: boolean;
            message?: string;
          }
        | null;

      if (!resp.ok || body?.ok !== true) {
        writeRetryCooldown(args.uid, projectId, Date.now() + RETRY_COOLDOWN_MS);

        return {
          ok: false,
          userCreated: false,
          profileCreated: false,
          code: body?.code ?? `HTTP_${resp.status}`,
          message: (body?.message ?? `HTTP ${resp.status}`).toString(),
        };
      }

      sessionGuards.add(sessionKey);
      clearRetryCooldown(args.uid, projectId);

      try {
        safeStorageSetItem("localStorage", bootstrapSuccessKey(args.uid, projectId), "1");
      } catch {
        // Ignore storage availability issues.
      }

      return {
        ok: true,
        code: body.code,
        userCreated: body.userCreated === true,
        profileCreated: body.profileCreated === true,
      };
    } catch (error: unknown) {
      writeRetryCooldown(args.uid, projectId, Date.now() + RETRY_COOLDOWN_MS);
      return {
        ok: false,
        userCreated: false,
        profileCreated: false,
        code: "NETWORK_ERROR",
        message: getErrorMessage(error),
      };
    }
  })();

  inFlightBySession.set(sessionKey, run);
  try {
    return await run;
  } finally {
    inFlightBySession.delete(sessionKey);
  }
}
