import { getAppCheck } from "firebase-admin/app-check";
import type { Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import {
  db,
  isStaffFromDecoded,
  nowTs,
  requireAuthContext,
  type RequestLike,
  type AuthContext,
} from "./shared";

type FeatureFlags = {
  v2AgenticEnabled: boolean;
  strictDelegationChecks: boolean;
  enforceAppCheck: boolean;
  allowAppCheckBypassInEmulator: boolean;
};

type DelegationRecord = {
  ownerUid: string;
  agentClientId: string;
  scopes: string[];
  resources: string[];
  status: string;
  expiresAtMs: number;
  revokedAtMs: number;
};

type DelegationCheckInput = {
  delegation: DelegationRecord;
  ownerUid: string;
  agentClientId: string;
  scope: string | null;
  resource: string | null;
  nowMs: number;
};

type DelegationCheckResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "DELEGATION_INACTIVE"
        | "DELEGATION_REVOKED"
        | "DELEGATION_EXPIRED"
        | "DELEGATION_OWNER_MISMATCH"
        | "DELEGATION_AGENT_MISMATCH"
        | "DELEGATION_SCOPE_MISSING"
        | "DELEGATION_RESOURCE_MISSING";
      message: string;
    };

type AuthorizedActor = {
  ok: true;
  ctx: AuthContext;
  actorType: "staff" | "human" | "agent_pat" | "agent_delegated";
};

type DeniedActor = {
  ok: false;
  httpStatus: number;
  code: string;
  message: string;
  ctx: AuthContext | null;
};

function boolEnv(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isEmulator(): boolean {
  return (process.env.FUNCTIONS_EMULATOR ?? "").trim() === "true";
}

function asMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (value && typeof value === "object") {
    const maybeTs = value as Timestamp & { toMillis?: () => number; seconds?: number };
    if (typeof maybeTs.toMillis === "function") return maybeTs.toMillis();
    if (typeof maybeTs.seconds === "number") return Math.trunc(maybeTs.seconds * 1000);
  }
  return 0;
}

function parseDelegationRecord(row: Record<string, unknown> | null): DelegationRecord | null {
  if (!row) return null;
  const ownerUid = typeof row.ownerUid === "string" ? row.ownerUid.trim() : "";
  const agentClientId = typeof row.agentClientId === "string" ? row.agentClientId.trim() : "";
  if (!ownerUid || !agentClientId) return null;
  return {
    ownerUid,
    agentClientId,
    scopes: Array.isArray(row.scopes)
      ? row.scopes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    resources: Array.isArray(row.resources)
      ? row.resources.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    status: typeof row.status === "string" ? row.status : "active",
    expiresAtMs: asMs(row.expiresAt),
    revokedAtMs: asMs(row.revokedAt),
  };
}

function resourceAllowed(resources: string[], resource: string | null): boolean {
  if (!resource) return true;
  if (!resources.length) return true;
  if (resources.includes("*")) return true;
  return resources.includes(resource);
}

export function evaluateDelegationAuthorization(input: DelegationCheckInput): DelegationCheckResult {
  const { delegation, ownerUid, agentClientId, scope, resource, nowMs } = input;

  if (delegation.status !== "active") {
    return {
      ok: false,
      code: "DELEGATION_INACTIVE",
      message: "Delegation is inactive.",
    };
  }
  if (delegation.revokedAtMs > 0) {
    return {
      ok: false,
      code: "DELEGATION_REVOKED",
      message: "Delegation has been revoked.",
    };
  }
  if (delegation.expiresAtMs > 0 && delegation.expiresAtMs <= nowMs) {
    return {
      ok: false,
      code: "DELEGATION_EXPIRED",
      message: "Delegation has expired.",
    };
  }
  if (delegation.ownerUid !== ownerUid) {
    return {
      ok: false,
      code: "DELEGATION_OWNER_MISMATCH",
      message: "Delegation owner does not match requested owner.",
    };
  }
  if (delegation.agentClientId !== agentClientId) {
    return {
      ok: false,
      code: "DELEGATION_AGENT_MISMATCH",
      message: "Delegation agent binding mismatch.",
    };
  }
  if (scope && !delegation.scopes.includes(scope)) {
    return {
      ok: false,
      code: "DELEGATION_SCOPE_MISSING",
      message: `Delegation missing scope: ${scope}`,
    };
  }
  if (!resourceAllowed(delegation.resources, resource)) {
    return {
      ok: false,
      code: "DELEGATION_RESOURCE_MISSING",
      message: "Delegation does not include the requested resource.",
    };
  }
  return { ok: true };
}

export function readAuthFeatureFlags(): FeatureFlags {
  return {
    v2AgenticEnabled: boolEnv("V2_AGENTIC_ENABLED", false),
    strictDelegationChecks: boolEnv("STRICT_DELEGATION_CHECKS_ENABLED", false),
    enforceAppCheck: boolEnv("ENFORCE_APPCHECK", false),
    allowAppCheckBypassInEmulator: boolEnv("ALLOW_APPCHECK_BYPASS_IN_EMULATOR", true),
  };
}

function getClientIp(req: RequestLike): string {
  const header = req.headers?.["x-forwarded-for"];
  if (typeof header === "string" && header.trim()) {
    return header.split(",")[0].trim();
  }
  if (Array.isArray(header) && header[0]) return String(header[0]).trim();
  return typeof req.ip === "string" ? req.ip : "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function logAuditEvent(params: {
  req: RequestLike;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ownerUid?: string | null;
  result: "allow" | "deny" | "error";
  reasonCode?: string | null;
  metadata?: Record<string, unknown> | null;
  ctx?: AuthContext | null;
}) {
  try {
    const delegationMetadata =
      params.ctx?.mode === "delegated"
        ? {
            delegationId: params.ctx.delegated.delegationId ?? null,
            delegationAudience: params.ctx.delegated.audience ?? null,
            agentClientId: params.ctx.delegated.agentClientId,
          }
        : null;
    const uaHeader = params.req?.headers?.["user-agent"];
    const userAgent = typeof uaHeader === "string" ? uaHeader.slice(0, 200) : null;
    const actorMode = params.ctx?.mode ?? "unknown";
    const actorUid = params.ctx?.uid ?? null;
    const actorType =
      actorMode === "delegated"
        ? "agent_delegated"
        : actorMode === "pat"
          ? "agent_pat"
          : params.ctx?.decoded && isStaffFromDecoded(params.ctx.decoded)
            ? "staff"
            : actorMode === "firebase"
              ? "human"
              : "unknown";
    await db.collection("auditEvents").add({
      at: nowTs(),
      requestId: params.requestId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      ownerUid: params.ownerUid ?? null,
      result: params.result,
      reasonCode: params.reasonCode ?? null,
      actorUid,
      actorType,
      actorMode,
      tokenId: params.ctx?.tokenId ?? null,
      metadata: {
        ...delegationMetadata,
        ...(params.metadata ?? null ? params.metadata : {}),
      },
      ipHash: hashIp(getClientIp(params.req)),
      userAgent,
    });
  } catch {
    // best effort logging
  }
}

export async function enforceAppCheckIfEnabled(req: RequestLike): Promise<
  | { ok: true; appId: string | null; bypassed: boolean }
  | { ok: false; httpStatus: number; code: string; message: string }
> {
  const flags = readAuthFeatureFlags();
  if (!flags.enforceAppCheck) return { ok: true, appId: null, bypassed: false };
  if (isEmulator() && flags.allowAppCheckBypassInEmulator) {
    return { ok: true, appId: "emulator-bypass", bypassed: true };
  }

  const rawHeader = req.headers?.["x-firebase-appcheck"];
  const token =
    typeof rawHeader === "string"
      ? rawHeader.trim()
      : Array.isArray(rawHeader) && rawHeader[0]
        ? String(rawHeader[0]).trim()
        : "";

  if (!token) {
    return {
      ok: false,
      httpStatus: 401,
      code: "APPCHECK_REQUIRED",
      message: "Missing App Check token.",
    };
  }

  try {
    const appCheck = getAppCheck();
    const decoded = await appCheck.verifyToken(token);
    return {
      ok: true,
      appId: typeof decoded.appId === "string" ? decoded.appId : null,
      bypassed: false,
    };
  } catch {
    return {
      ok: false,
      httpStatus: 401,
      code: "APPCHECK_INVALID",
      message: "Invalid App Check token.",
    };
  }
}

export async function assertActorAuthorized(params: {
  req: RequestLike;
  ownerUid: string;
  scope: string | null;
  resource: string | null;
  allowStaff: boolean;
  ctx?: AuthContext;
}): Promise<AuthorizedActor | DeniedActor> {
  const ctxResult = params.ctx ? { ok: true as const, ctx: params.ctx } : await requireAuthContext(params.req);
  if (!ctxResult.ok) {
    return {
      ok: false,
      httpStatus: 401,
      code: "UNAUTHENTICATED",
      message: ctxResult.message,
      ctx: null,
    };
  }
  const ctx = ctxResult.ctx;
  const isStaff = ctx.mode === "firebase" && isStaffFromDecoded(ctx.decoded);

  if (isStaff && params.allowStaff) {
    return { ok: true, ctx, actorType: "staff" };
  }

  if (ctx.uid !== params.ownerUid) {
    return {
      ok: false,
      httpStatus: 403,
      code: "OWNER_MISMATCH",
      message: "Owner mismatch.",
      ctx,
    };
  }

  if (params.scope && ctx.mode !== "firebase") {
    const scopes = ctx.scopes ?? [];
    if (!scopes.includes(params.scope)) {
      return {
        ok: false,
        httpStatus: 403,
        code: "MISSING_SCOPE",
        message: `Missing scope: ${params.scope}`,
        ctx,
      };
    }
  }

  const flags = readAuthFeatureFlags();
  if (ctx.mode === "delegated" && flags.v2AgenticEnabled && flags.strictDelegationChecks) {
    const delegationId = ctx.delegated.delegationId;
    if (!delegationId) {
      return {
        ok: false,
        httpStatus: 403,
        code: "DELEGATION_REQUIRED",
        message: "Delegation ID is required for delegated auth in strict mode.",
        ctx,
      };
    }
    const snap = await db.collection("delegations").doc(delegationId).get();
    if (!snap.exists) {
      return {
        ok: false,
        httpStatus: 403,
        code: "DELEGATION_NOT_FOUND",
        message: "Delegation not found.",
        ctx,
      };
    }
    const delegation = parseDelegationRecord(snap.data() as Record<string, unknown>);
    if (!delegation) {
      return {
        ok: false,
        httpStatus: 403,
        code: "DELEGATION_INVALID",
        message: "Delegation record is invalid.",
        ctx,
      };
    }
    const check = evaluateDelegationAuthorization({
      delegation,
      ownerUid: params.ownerUid,
      agentClientId: ctx.delegated.agentClientId,
      scope: params.scope,
      resource: params.resource,
      nowMs: Date.now(),
    });
    if (!check.ok) {
      return {
        ok: false,
        httpStatus: 403,
        code: check.code,
        message: check.message,
        ctx,
      };
    }
  }

  if (ctx.mode === "delegated") {
    return { ok: true, ctx, actorType: "agent_delegated" };
  }
  if (ctx.mode === "pat") {
    return { ok: true, ctx, actorType: "agent_pat" };
  }
  return { ok: true, ctx, actorType: "human" };
}
