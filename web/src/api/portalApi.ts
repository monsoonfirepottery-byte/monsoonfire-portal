// web/src/api/portalApi.ts
// iOS-forward API client with runtime base URL override (dynamic, not cached)

export const FUNCTIONS_BASE_OVERRIDE_KEY = "mf_functions_base_override";

export type PortalApiMeta = {
  atIso: string;
  requestId: string;
  fn: string;
  url: string;
  payload: unknown;
  status?: number;
  ok?: boolean;
  response?: unknown;
  error?: string;
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

/* ======================
   API CONTRACTS
   ====================== */

export type CreateBatchRequest = {
  ownerUid: string;
  ownerDisplayName: string;
  title: string;
  intakeMode: string;
  estimatedCostCents: number;
  estimateNotes?: string | null;
  [k: string]: unknown;
};

export type CreateBatchResponse = {
  ok: boolean;
  batchId?: string;
  message?: string;
};

export type PickedUpAndCloseRequest = {
  batchId: string;
  uid?: string;
  [k: string]: unknown;
};

export type PickedUpAndCloseResponse = {
  ok: boolean;
  message?: string;
};

export type ContinueJourneyRequest = {
  uid: string;
  fromBatchId: string;
  [k: string]: unknown;
};

export type ContinueJourneyResponse = {
  ok: boolean;
  batchId?: string;
  newBatchId?: string;
  existingBatchId?: string;
  message?: string;
};

/* ======================
   INTERNALS
   ====================== */

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function getFunctionsBaseUrl(): string {
  // 1) Runtime override (wins)
  try {
    const override = localStorage.getItem(FUNCTIONS_BASE_OVERRIDE_KEY);
    if (override && override.trim()) return override.trim().replace(/\/+$/, "");
  } catch {
    /* ignore */
  }

  // 2) Vite env (best effort)
  const env = (import.meta as any)?.env;
  const fromEnv = env?.VITE_FUNCTIONS_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");

  // 3) Default prod
  return "https://us-central1-monsoonfire-portal.cloudfunctions.net";
}

function buildCurl(url: string, hasAdminToken: boolean, payload?: unknown) {
  const headers = [
    `-H 'Content-Type: application/json'`,
    `-H 'Authorization: Bearer <ID_TOKEN>'`,
  ];
  if (hasAdminToken) headers.push(`-H 'x-admin-token: <ADMIN_TOKEN>'`);

  const body = payload ? `-d '${safeJson(payload).replace(/'/g, "'\\''")}'` : "";
  return `curl -X POST ${headers.join(" ")} ${body} '${url}'`;
}

async function readBody(resp: Response) {
  const ct = resp.headers.get("content-type") || "";
  return ct.includes("application/json") ? resp.json() : resp.text();
}

/* ======================
   CLIENT
   ====================== */

export function createPortalApi() {
  async function callFn<T>(args: {
    fn: string;
    payload: unknown;
    idToken: string;
    adminToken?: string;
  }): Promise<{ data: T; meta: PortalApiMeta }> {
    const requestId = newRequestId();
    const baseUrl = getFunctionsBaseUrl(); // ✅ dynamic every call
    const url = `${baseUrl}/${args.fn}`;

    const meta: PortalApiMeta = {
      atIso: new Date().toISOString(),
      requestId,
      fn: args.fn,
      url,
      payload: args.payload ?? {},
      curlExample: buildCurl(url, !!args.adminToken, args.payload),
    };

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
      meta.error = e?.message || String(e);
      throw new PortalApiError(meta.error, meta);
    }

    const body = await readBody(resp);
    meta.status = resp.status;
    meta.ok = resp.ok;
    meta.response = body;

    if (!resp.ok) {
      const msg =
        (typeof body === "object" && body && ((body as any).message || (body as any).error)) ||
        (typeof body === "string" ? body : "Request failed");
      meta.error = String(msg);
      throw new PortalApiError(String(msg), meta);
    }

    return { data: body as T, meta };
  }

  return {
    // ✅ live getter for the UI header
    get baseUrl() {
      return getFunctionsBaseUrl();
    },

    createBatch(args: {
      idToken: string;
      adminToken?: string;
      payload: CreateBatchRequest;
    }) {
      return callFn<CreateBatchResponse>({
        fn: "createBatch",
        payload: args.payload,
        idToken: args.idToken,
        adminToken: args.adminToken,
      });
    },

    pickedUpAndClose(args: {
      idToken: string;
      adminToken?: string;
      payload: PickedUpAndCloseRequest;
    }) {
      return callFn<PickedUpAndCloseResponse>({
        fn: "pickedUpAndClose",
        payload: args.payload,
        idToken: args.idToken,
        adminToken: args.adminToken,
      });
    },

    continueJourney(args: {
      idToken: string;
      adminToken?: string;
      payload: ContinueJourneyRequest;
    }) {
      return callFn<ContinueJourneyResponse>({
        fn: "continueJourney",
        payload: args.payload,
        idToken: args.idToken,
        adminToken: args.adminToken,
      });
    },
  };
}
