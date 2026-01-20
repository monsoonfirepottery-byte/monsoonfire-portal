// web/src/api/portalApi.ts
// Portal API client (HTTP Cloud Functions)
// Updated to consume canonical types from portalContracts.ts (no behavior changes)

import type {
  ContinueJourneyRequest as ContractsContinueJourneyRequest,
  ContinueJourneyResponse as ContractsContinueJourneyResponse,
  CreateBatchRequest as ContractsCreateBatchRequest,
  CreateBatchResponse as ContractsCreateBatchResponse,
  PickedUpAndCloseRequest as ContractsPickedUpAndCloseRequest,
  PickedUpAndCloseResponse as ContractsPickedUpAndCloseResponse,
  PortalApiMeta,
  PortalFnName,
} from "./portalContracts";
import { getErrorCode, getErrorMessage } from "./portalContracts";

/**
 * Re-export canonical contracts so existing imports keep working,
 * while ensuring the source of truth is portalContracts.ts.
 */
export type CreateBatchRequest = ContractsCreateBatchRequest;
export type CreateBatchResponse = ContractsCreateBatchResponse;

export type PickedUpAndCloseRequest = ContractsPickedUpAndCloseRequest;
export type PickedUpAndCloseResponse = ContractsPickedUpAndCloseResponse;

export type ContinueJourneyRequest = ContractsContinueJourneyRequest;
export type ContinueJourneyResponse = ContractsContinueJourneyResponse;

type PortalApiCallArgs<TReq> = {
  idToken: string;
  adminToken?: string;
  payload: TReq;
};

type PortalApiCallResult<TResp> = {
  data: TResp;
  meta: PortalApiMeta;
};

export class PortalApiError extends Error {
  meta: PortalApiMeta;

  constructor(message: string, meta: PortalApiMeta) {
    super(message);
    this.name = "PortalApiError";
    this.meta = meta;
  }
}

export type PortalApi = {
  baseUrl: string;

  createBatch(args: PortalApiCallArgs<CreateBatchRequest>): Promise<PortalApiCallResult<CreateBatchResponse>>;
  pickedUpAndClose(
    args: PortalApiCallArgs<PickedUpAndCloseRequest>
  ): Promise<PortalApiCallResult<PickedUpAndCloseResponse>>;
  continueJourney(
    args: PortalApiCallArgs<ContinueJourneyRequest>
  ): Promise<PortalApiCallResult<ContinueJourneyResponse>>;
};

type CreatePortalApiOptions = {
  baseUrl?: string;
};

const DEFAULT_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

function nowIso() {
  return new Date().toISOString();
}

function makeRequestId(): string {
  // Browser-friendly UUID fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCrypto = crypto as any;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  } catch {
    // ignore
  }
  return `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function safeStringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildCurlExample(url: string, payload: unknown, includeAdminToken: boolean): string {
  const headers: string[] = [
    "-H 'Content-Type: application/json'",
    "-H 'Authorization: Bearer <ID_TOKEN>'",
  ];
  if (includeAdminToken) headers.push("-H 'x-admin-token: <ADMIN_TOKEN>'");

  // Curl heredoc-style quoting is fussy; keep it simple with single-quoted -d,
  // and escape any single quotes inside JSON.
  const body = safeStringifyJson(payload).replace(/'/g, "'\\''");

  return `curl -X POST ${headers.join(" ")} -d '${body}' '${url}'`;
}

async function readResponseBody(resp: Response): Promise<unknown> {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await resp.json();
    } catch {
      // fall through to text
    }
  }
  try {
    return await resp.text();
  } catch {
    return null;
  }
}

async function callFn<TReq, TResp>(
  baseUrl: string,
  fn: PortalFnName,
  args: PortalApiCallArgs<TReq>
): Promise<PortalApiCallResult<TResp>> {
  const url = `${baseUrl.replace(/\/$/, "")}/${fn}`;
  const requestId = makeRequestId();

  const metaStart: PortalApiMeta = {
    atIso: nowIso(),
    requestId,
    fn,
    url,
    payload: args.payload,
    curlExample: buildCurlExample(url, args.payload, !!args.adminToken),
  };

  let resp: Response | null = null;
  let body: unknown = null;

  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.idToken}`,
        ...(args.adminToken ? { "x-admin-token": args.adminToken } : {}),
      },
      body: JSON.stringify(args.payload ?? {}),
    });

    body = await readResponseBody(resp);

    const metaDone: PortalApiMeta = {
      ...metaStart,
      status: resp.status,
      ok: resp.ok,
      response: body,
    };

    if (!resp.ok) {
      const msg = getErrorMessage(body);
      const code = getErrorCode(body);
      const enriched: PortalApiMeta = {
        ...metaDone,
        error: msg,
        message: msg,
        ...(code ? { code } : {}),
      };
      throw new PortalApiError(msg, enriched);
    }

    return { data: body as TResp, meta: metaDone };
  } catch (err: any) {
    if (err instanceof PortalApiError) throw err;

    const msg = err?.message ? String(err.message) : "Request failed";
    const metaFail: PortalApiMeta = {
      ...metaStart,
      status: resp?.status,
      ok: false,
      response: body,
      error: msg,
      message: msg,
    };
    throw new PortalApiError(msg, metaFail);
  }
}

export function createPortalApi(options: CreatePortalApiOptions = {}): PortalApi {
  const baseUrl =
    options.baseUrl ||
    (typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
      ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
      : DEFAULT_BASE_URL);

  return {
    baseUrl,

    async createBatch(args) {
      return await callFn<CreateBatchRequest, CreateBatchResponse>(baseUrl, "createBatch", args);
    },

    async pickedUpAndClose(args) {
      return await callFn<PickedUpAndCloseRequest, PickedUpAndCloseResponse>(baseUrl, "pickedUpAndClose", args);
    },

    async continueJourney(args) {
      return await callFn<ContinueJourneyRequest, ContinueJourneyResponse>(baseUrl, "continueJourney", args);
    },
  };
}
