// web/src/api/portalApi.ts
/* iOS-forward API client for Cloud Functions
   - stateless request/response
   - explicit JSON parsing + normalized errors
   - requestId + troubleshooting metadata
   - SAFE curl example (tokens redacted by default)
*/

export type PortalApiMeta = {
  atIso: string;
  requestId: string;
  fn: string;
  url: string;
  payload: any;

  status?: number;
  ok?: boolean;
  response?: any;
  error?: string;

  // Safe for pasting into chat/logs
  curlExample?: string;
};

export class PortalApiError extends Error {
  meta: PortalApiMeta;
  constructor(message: string, meta: PortalApiMeta) {
    super(message);
    this.name = "PortalApiError";
    this.meta = meta;
  }
}

export type ContinueJourneyResp = {
  ok: boolean;
  newBatchId?: string;
  existingBatchId?: string;
  batchId?: string;
  message?: string;
};

function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function readResponseBody(resp: Response) {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await resp.json();
  const text = await resp.text();
  return text;
}

function buildCurlExample(url: string, hasAdminToken: boolean, payload?: any) {
  // IMPORTANT: keep tokens redacted in the generated curl
  const headers: string[] = [
    `-H 'Content-Type: application/json'`,
    `-H 'Authorization: Bearer <ID_TOKEN>'`,
  ];
  if (hasAdminToken) headers.push(`-H 'x-admin-token: <ADMIN_TOKEN>'`);

  const body = payload
    ? `-d '${safeJsonStringify(payload).replace(/'/g, "'\\''")}'`
    : "";

  return `curl -X POST ${headers.join(" ")} ${body} '${url}'`;
}

function getBaseUrl() {
  // iOS-forward: configurable via env. Defaults to prod.
  // Example .env.local:
  // VITE_FUNCTIONS_BASE_URL=http://localhost:5001/<projectId>/us-central1
  const env = (import.meta as any)?.env;
  const fromEnv = env?.VITE_FUNCTIONS_BASE_URL;
  return typeof fromEnv === "string" && fromEnv.trim()
    ? fromEnv.trim().replace(/\/+$/, "")
    : "https://us-central1-monsoonfire-portal.cloudfunctions.net";
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export type PortalApiClientOptions = {
  baseUrl?: string;
};

export function createPortalApi(opts?: PortalApiClientOptions) {
  const baseUrl = (opts?.baseUrl || getBaseUrl()).replace(/\/+$/, "");

  async function callFn<TResp>(args: {
    fn: string;
    payload: any;
    idToken: string;
    adminToken?: string;
  }): Promise<{ data: TResp; meta: PortalApiMeta }> {
    const requestId = newRequestId();
    const url = `${baseUrl}/${args.fn}`;

    const meta: PortalApiMeta = {
      atIso: new Date().toISOString(),
      requestId,
      fn: args.fn,
      url,
      payload: args.payload ?? {},
      curlExample: buildCurlExample(url, !!args.adminToken, args.payload ?? {}),
    };

    // NOTE: No custom headers beyond Content-Type/Authorization/x-admin-token.
    // Adding new custom headers requires CORS allow-list updates server-side.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.idToken}`,
    };
    if (args.adminToken) headers["x-admin-token"] = args.adminToken;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(args.payload ?? {}),
      });
    } catch (e: any) {
      meta.ok = false;
      meta.error = e?.message || String(e);
      throw new PortalApiError(meta.error, meta);
    }

    const body = await readResponseBody(resp);

    meta.status = resp.status;
    meta.ok = resp.ok;
    meta.response = body;

    if (!resp.ok) {
      const msg =
        (typeof body === "object" && body && (body.message || body.error)) ||
        (typeof body === "string" ? body : "Request failed");
      meta.error = String(msg);
      throw new PortalApiError(String(msg), meta);
    }

    return { data: body as TResp, meta };
  }

  // --- Function wrappers (tolerant payloads; backend remains source of truth) ---

  async function createBatch(args: {
    idToken: string;
    adminToken?: string;
    payload: Record<string, any>;
  }) {
    return callFn<{ ok: boolean; batchId?: string }>({
      fn: "createBatch",
      payload: args.payload,
      idToken: args.idToken,
      adminToken: args.adminToken,
    });
  }

  async function pickedUpAndClose(args: {
    idToken: string;
    adminToken?: string;
    payload: Record<string, any>;
  }) {
    return callFn<{ ok: boolean }>({
      fn: "pickedUpAndClose",
      payload: args.payload,
      idToken: args.idToken,
      adminToken: args.adminToken,
    });
  }

  async function continueJourney(args: {
    idToken: string;
    adminToken?: string;
    payload: Record<string, any>; // expects { uid, fromBatchId }
  }) {
    return callFn<ContinueJourneyResp>({
      fn: "continueJourney",
      payload: args.payload,
      idToken: args.idToken,
      adminToken: args.adminToken,
    });
  }

  return {
    baseUrl,
    callFn,
    createBatch,
    pickedUpAndClose,
    continueJourney,
  };
}
