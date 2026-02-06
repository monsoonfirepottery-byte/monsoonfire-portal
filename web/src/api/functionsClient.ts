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

export type LastRequest = {
  atIso: string;
  requestId: string;

  fn: string;
  url: string;
  payload: unknown;

  status?: number;
  ok?: boolean;
  response?: unknown;
  error?: string;

  /** Redacted curl suitable for sharing/logging. */
  curlExample?: string;
};

export type FunctionsClientConfig = {
  baseUrl: string;
  getIdToken: () => Promise<string>;
  getAdminToken?: () => string | undefined;

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

function makeRequestId() {
  try {
    // modern browsers
    return crypto.randomUUID();
  } catch {
    // fallback: not cryptographically strong, but fine for correlation IDs
    return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

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

  const redactDefault = config.redactCurlByDefault ?? true;

  function publish(req: LastRequest) {
    lastReq = req;
    config.onLastRequest?.(req);
  }

  async function postJson<TResp>(fn: string, payload: unknown): Promise<TResp> {
    const base = config.baseUrl.replace(/\/+$/, "");
    const path = fn.replace(/^\/+/, "");
    const url = `${base}/${path}`;

    const req: LastRequest = {
      atIso: new Date().toISOString(),
      requestId: makeRequestId(),
      fn: path,
      url,
      payload: payload ?? {},
      curlExample: buildCurlRedacted(url, payload ?? {}),
    };
    publish(req);

    const idToken = await config.getIdToken();
    lastIdToken = idToken;

    const adminToken = config.getAdminToken?.();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    };
    if (adminToken && adminToken.trim()) headers["x-admin-token"] = adminToken.trim();

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload ?? {}),
    });

    const body = await readResponseBody(resp);

    const updated: LastRequest = {
      ...req,
      status: resp.status,
      ok: resp.ok,
      response: body,
      curlExample: buildCurlRedacted(url, payload ?? {}),
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

      updated.error = String(msg);
      publish(updated);
      throw new Error(String(msg));
    }

    publish(updated);
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
