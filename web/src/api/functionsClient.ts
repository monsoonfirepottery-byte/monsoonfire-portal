// src/api/functionsClient.ts
/**
 * Monsoon Fire Portal — Cloud Functions client (web reference + iOS-portable shape)
 *
 * Goals:
 * - Stateless request/response wrapper suitable for Swift re-implementation
 * - Explicit JSON contracts
 * - Optional dev-only admin token header support (x-admin-token)
 * - First-class troubleshooting: last request snapshot + curl examples
 *
 * Safety:
 * - curlExample is REDACTED by default (<ID_TOKEN>, <ADMIN_TOKEN>)
 * - A separate helper can generate a real curl string if needed.
 */
import { makeRequestId as createRequestId } from "./requestId";
import { toAppError } from "../errors/appError";
import {
  publishRequestTelemetry,
  redactTelemetryPayload,
  stringifyResponseSnippet,
} from "../lib/requestTelemetry";

export type LastRequest = {
  atIso: string;
  requestId: string;

  fn: string;
  url: string;
  method: "POST";
  payload: unknown;
  payloadRedacted?: unknown;

  status?: number;
  ok?: boolean;
  response?: unknown;
  responseSnippet?: string;
  error?: string;

  /** Redacted curl suitable for sharing/logging. */
  curlExample?: string;
};

export type FunctionsClientConfig = {
  baseUrl: string;
  getIdToken: () => Promise<string>;
  getAdminToken?: () => string | undefined;
  requestTimeoutMs?: number;

  onLastRequest?: (req: LastRequest) => void;

  /**
   * Default true: keep the stored curlExample redacted so we don't leak tokens
   * into UI screenshots, logs, or copied text by accident.
   */
  redactCurlByDefault?: boolean;
};

export function safeJsonStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function escapeSingleQuotesForBash(s: string) {
  // wrap body in single quotes; escape embedded single quotes safely
  return s.replace(/'/g, "'\\''");
}

async function readResponseBody(resp: Response): Promise<unknown> {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return (await resp.json()) as unknown;
    } catch {
      // fall through
    }
  }
  return await resp.text();
}

const makeRequestId = createRequestId;

export function buildCurlRedacted(url: string, payload?: unknown) {
  const headerArgs = [
    `-H 'Content-Type: application/json'`,
    `-H 'Authorization: Bearer <ID_TOKEN>'`,
    `-H 'x-admin-token: <ADMIN_TOKEN>'`,
  ].join(" ");

  const body = payload
    ? `-d '${escapeSingleQuotesForBash(safeJsonStringify(payload))}'`
    : "";

  return `curl -X POST ${headerArgs} ${body} '${url}'`;
}

export function buildCurlReal(
  url: string,
  idToken: string,
  adminToken?: string,
  payload?: unknown
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };
  if (adminToken) headers["x-admin-token"] = adminToken;

  const headerArgs = Object.entries(headers)
    .map(([k, v]) => `-H '${k}: ${v}'`)
    .join(" ");

  const body = payload
    ? `-d '${escapeSingleQuotesForBash(safeJsonStringify(payload))}'`
    : "";

  return `curl -X POST ${headerArgs} ${body} '${url}'`;
}

export type FunctionsClient = {
  postJson<TResp>(fn: string, payload: unknown): Promise<TResp>;
  getLastRequest(): LastRequest | null;

  /** Returns a curl string; redacted by default. */
  getLastCurl(opts?: { redact?: boolean }): string;
};

export function createFunctionsClient(config: FunctionsClientConfig): FunctionsClient {
  let lastReq: LastRequest | null = null;
  let lastIdToken: string | null = null;
  const requestTimeoutMs = config.requestTimeoutMs ?? 10_000;

  const redactDefault = config.redactCurlByDefault ?? true;

  function publish(req: LastRequest) {
    lastReq = req;
    config.onLastRequest?.(req);
  }

  async function postJson<TResp>(fn: string, payload: unknown): Promise<TResp> {
    const base = config.baseUrl.replace(/\/+$/, "");
    const path = fn.replace(/^\/+/, "");
    const url = `${base}/${path}`;
    const normalizedPayload = payload ?? {};

    const redactedPayload = redactTelemetryPayload(normalizedPayload);
    const req: LastRequest = {
      atIso: new Date().toISOString(),
      requestId: makeRequestId(),
      fn: path,
      url,
      method: "POST",
      payload: normalizedPayload,
      payloadRedacted: redactedPayload,
      curlExample: buildCurlRedacted(url, normalizedPayload),
    };
    publish(req);
    publishRequestTelemetry({
      atIso: req.atIso,
      requestId: req.requestId,
      source: "functions-client",
      endpoint: req.url,
      method: req.method,
      payload: redactedPayload,
      curl: req.curlExample,
    });

    const idToken = await config.getIdToken();
    lastIdToken = idToken;

    const adminToken = config.getAdminToken?.();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    };
    if (adminToken && adminToken.trim()) headers["x-admin-token"] = adminToken.trim();

    let resp: Response;
    let didTimeout = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const abortController = new AbortController();
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        abortController.abort("request-timeout");
      }, requestTimeoutMs);

      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(normalizedPayload),
        signal: abortController.signal,
      });
      clearTimeout(timeoutHandle);
    } catch (error: unknown) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      let debugMessage = error instanceof Error ? error.message : String(error);
      if (didTimeout) {
        debugMessage = `Request timeout after ${requestTimeoutMs}ms`;
      }
      const appError = toAppError(error, {
        requestId: req.requestId,
        kind: "network",
        debugMessage,
      });

      const failed: LastRequest = {
        ...req,
        ok: false,
        error: appError.debugMessage,
      };
      publish(failed);
      publishRequestTelemetry({
        atIso: failed.atIso,
        requestId: failed.requestId,
        source: "functions-client",
        endpoint: failed.url,
        method: failed.method,
        payload: redactedPayload,
        ok: false,
        error: `${appError.userMessage} (support code: ${appError.correlationId})`,
        curl: failed.curlExample,
      });
      throw appError;
    }
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const body = await readResponseBody(resp);

    const updated: LastRequest = {
      ...req,
      status: resp.status,
      ok: resp.ok,
      response: body,
      responseSnippet: stringifyResponseSnippet(body),
      curlExample: buildCurlRedacted(url, normalizedPayload),
    };

    if (!resp.ok) {
      const messageFromBody =
        typeof body === "object" && body
          ? (body as { message?: unknown; error?: unknown })
          : null;
      const msg =
        (typeof messageFromBody?.message === "string" && messageFromBody.message) ||
        (typeof messageFromBody?.error === "string" && messageFromBody.error) ||
        (typeof body === "string" ? body : `HTTP ${resp.status}`);

      const appError = toAppError(body, {
        requestId: req.requestId,
        statusCode: resp.status,
        debugMessage: String(msg),
      });

      updated.error = appError.debugMessage;
      publish(updated);
      publishRequestTelemetry({
        atIso: updated.atIso,
        requestId: updated.requestId,
        source: "functions-client",
        endpoint: updated.url,
        method: updated.method,
        payload: redactedPayload,
        status: updated.status,
        ok: false,
        responseSnippet: stringifyResponseSnippet(body),
        error: `${appError.userMessage} (support code: ${appError.correlationId})`,
        curl: updated.curlExample,
      });
      throw appError;
    }

    publish(updated);
    publishRequestTelemetry({
      atIso: updated.atIso,
      requestId: updated.requestId,
      source: "functions-client",
      endpoint: updated.url,
      method: updated.method,
      payload: redactTelemetryPayload(updated.payload),
      status: updated.status,
      ok: true,
      responseSnippet: stringifyResponseSnippet(body),
      curl: updated.curlExample,
    });
    return body as TResp;
  }

  function getLastRequest() {
    return lastReq;
  }

  function getLastCurl(opts?: { redact?: boolean }) {
    if (!lastReq) return "";

    const redact = opts?.redact ?? redactDefault;
    if (redact) return buildCurlRedacted(lastReq.url, lastReq.payload);

    // real curl requires we have an idToken from THIS session
    if (!lastIdToken) return "";
    const adminToken = config.getAdminToken?.();
    return buildCurlReal(
      lastReq.url,
      lastIdToken,
      adminToken?.trim() || undefined,
      lastReq.payload
    );
  }

  return { postJson, getLastRequest, getLastCurl };
}
