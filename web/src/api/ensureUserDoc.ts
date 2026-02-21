type ImportMetaEnvShape = {
  VITE_FUNCTIONS_BASE_URL?: string;
};

const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

const inFlightBySession = new Map<string, Promise<EnsureUserDocResult>>();
const sessionGuards = new Set<string>();
const retryCountBySession = new Map<string, number>();

const MAX_RETRIES_PER_SESSION = 1;
const RETRY_COOLDOWN_MS = 30_000;

export type EnsureUserDocResult = {
  ok: boolean;
  userCreated: boolean;
  profileCreated: boolean;
  skipped?: boolean;
  retrySuppressed?: boolean;
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
    if (typeof localStorage === "undefined") return 0;
    const raw = localStorage.getItem(retryCooldownKey(uid, projectId));
    const parsed = Number(raw ?? "0");
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function writeRetryCooldown(uid: string, projectId: string, value: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(retryCooldownKey(uid, projectId), String(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function clearRetryCooldown(uid: string, projectId: string) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(retryCooldownKey(uid, projectId));
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
    if (typeof localStorage !== "undefined") {
      const key = bootstrapSuccessKey(args.uid, projectId);
      if (localStorage.getItem(key) === "1") {
        sessionGuards.add(sessionKey);
        return { ok: true, userCreated: false, profileCreated: false, skipped: true };
      }
    }
  } catch {
    // Ignore storage availability issues.
  }

  const retriesUsed = retryCountBySession.get(sessionKey) ?? 0;
  if (retriesUsed > MAX_RETRIES_PER_SESSION) {
    return {
      ok: false,
      userCreated: false,
      profileCreated: false,
      skipped: true,
      retrySuppressed: true,
      code: "RETRY_SUPPRESSED",
      message: "ensureUserDoc retry budget exhausted for this session.",
    };
  }

  const retryAfterMs = readRetryCooldown(args.uid, projectId);
  if (retryAfterMs > Date.now()) {
    return {
      ok: false,
      userCreated: false,
      profileCreated: false,
      skipped: true,
      retrySuppressed: true,
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
        retryCountBySession.set(sessionKey, retriesUsed + 1);
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
      retryCountBySession.delete(sessionKey);
      clearRetryCooldown(args.uid, projectId);

      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(bootstrapSuccessKey(args.uid, projectId), "1");
        }
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
      retryCountBySession.set(sessionKey, retriesUsed + 1);
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
