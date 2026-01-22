// web/src/api/portalApi.ts
// Portal API client (HTTP Cloud Functions)
// Updated to consume canonical types from portalContracts.ts (no behavior changes)

import type {
  ContinueJourneyRequest as ContractsContinueJourneyRequest,
  ContinueJourneyResponse as ContractsContinueJourneyResponse,
  CreateBatchRequest as ContractsCreateBatchRequest,
  CreateBatchResponse as ContractsCreateBatchResponse,
  CreateReservationRequest as ContractsCreateReservationRequest,
  CreateReservationResponse as ContractsCreateReservationResponse,
  PickedUpAndCloseRequest as ContractsPickedUpAndCloseRequest,
  PickedUpAndCloseResponse as ContractsPickedUpAndCloseResponse,
  ListMaterialsProductsRequest as ContractsListMaterialsProductsRequest,
  ListMaterialsProductsResponse as ContractsListMaterialsProductsResponse,
  CreateMaterialsCheckoutSessionRequest as ContractsCreateMaterialsCheckoutSessionRequest,
  CreateMaterialsCheckoutSessionResponse as ContractsCreateMaterialsCheckoutSessionResponse,
  SeedMaterialsCatalogRequest as ContractsSeedMaterialsCatalogRequest,
  SeedMaterialsCatalogResponse as ContractsSeedMaterialsCatalogResponse,
  ListEventsRequest as ContractsListEventsRequest,
  ListEventsResponse as ContractsListEventsResponse,
  ListEventSignupsRequest as ContractsListEventSignupsRequest,
  ListEventSignupsResponse as ContractsListEventSignupsResponse,
  GetEventRequest as ContractsGetEventRequest,
  GetEventResponse as ContractsGetEventResponse,
  CreateEventRequest as ContractsCreateEventRequest,
  CreateEventResponse as ContractsCreateEventResponse,
  PublishEventRequest as ContractsPublishEventRequest,
  PublishEventResponse as ContractsPublishEventResponse,
  SignupForEventRequest as ContractsSignupForEventRequest,
  SignupForEventResponse as ContractsSignupForEventResponse,
  CancelEventSignupRequest as ContractsCancelEventSignupRequest,
  CancelEventSignupResponse as ContractsCancelEventSignupResponse,
  ClaimEventOfferRequest as ContractsClaimEventOfferRequest,
  ClaimEventOfferResponse as ContractsClaimEventOfferResponse,
  CheckInEventRequest as ContractsCheckInEventRequest,
  CheckInEventResponse as ContractsCheckInEventResponse,
  CreateEventCheckoutSessionRequest as ContractsCreateEventCheckoutSessionRequest,
  CreateEventCheckoutSessionResponse as ContractsCreateEventCheckoutSessionResponse,
  ListBillingSummaryRequest as ContractsListBillingSummaryRequest,
  BillingReceipt as ContractsBillingReceipt,
  BillingSummaryResponse as ContractsBillingSummaryResponse,
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

export type CreateReservationRequest = ContractsCreateReservationRequest;
export type CreateReservationResponse = ContractsCreateReservationResponse;

export type ListMaterialsProductsRequest = ContractsListMaterialsProductsRequest;
export type ListMaterialsProductsResponse = ContractsListMaterialsProductsResponse;
export type CreateMaterialsCheckoutSessionRequest = ContractsCreateMaterialsCheckoutSessionRequest;
export type CreateMaterialsCheckoutSessionResponse = ContractsCreateMaterialsCheckoutSessionResponse;
export type SeedMaterialsCatalogRequest = ContractsSeedMaterialsCatalogRequest;
export type SeedMaterialsCatalogResponse = ContractsSeedMaterialsCatalogResponse;

export type ListEventsRequest = ContractsListEventsRequest;
export type ListEventsResponse = ContractsListEventsResponse;
export type ListEventSignupsRequest = ContractsListEventSignupsRequest;
export type ListEventSignupsResponse = ContractsListEventSignupsResponse;
export type GetEventRequest = ContractsGetEventRequest;
export type GetEventResponse = ContractsGetEventResponse;
export type CreateEventRequest = ContractsCreateEventRequest;
export type CreateEventResponse = ContractsCreateEventResponse;
export type PublishEventRequest = ContractsPublishEventRequest;
export type PublishEventResponse = ContractsPublishEventResponse;
export type SignupForEventRequest = ContractsSignupForEventRequest;
export type SignupForEventResponse = ContractsSignupForEventResponse;
export type CancelEventSignupRequest = ContractsCancelEventSignupRequest;
export type CancelEventSignupResponse = ContractsCancelEventSignupResponse;
export type ClaimEventOfferRequest = ContractsClaimEventOfferRequest;
export type ClaimEventOfferResponse = ContractsClaimEventOfferResponse;
export type CheckInEventRequest = ContractsCheckInEventRequest;
export type CheckInEventResponse = ContractsCheckInEventResponse;
export type CreateEventCheckoutSessionRequest = ContractsCreateEventCheckoutSessionRequest;
export type CreateEventCheckoutSessionResponse = ContractsCreateEventCheckoutSessionResponse;
export type ListBillingSummaryRequest = ContractsListBillingSummaryRequest;
export type BillingReceipt = ContractsBillingReceipt;
export type BillingSummaryResponse = ContractsBillingSummaryResponse;

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
  createReservation(
    args: PortalApiCallArgs<CreateReservationRequest>
  ): Promise<PortalApiCallResult<CreateReservationResponse>>;
  continueJourney(
    args: PortalApiCallArgs<ContinueJourneyRequest>
  ): Promise<PortalApiCallResult<ContinueJourneyResponse>>;
  listMaterialsProducts(
    args: PortalApiCallArgs<ListMaterialsProductsRequest>
  ): Promise<PortalApiCallResult<ListMaterialsProductsResponse>>;
  createMaterialsCheckoutSession(
    args: PortalApiCallArgs<CreateMaterialsCheckoutSessionRequest>
  ): Promise<PortalApiCallResult<CreateMaterialsCheckoutSessionResponse>>;
  seedMaterialsCatalog(
    args: PortalApiCallArgs<SeedMaterialsCatalogRequest>
  ): Promise<PortalApiCallResult<SeedMaterialsCatalogResponse>>;
  listEvents(args: PortalApiCallArgs<ListEventsRequest>): Promise<PortalApiCallResult<ListEventsResponse>>;
  listEventSignups(args: PortalApiCallArgs<ListEventSignupsRequest>): Promise<PortalApiCallResult<ListEventSignupsResponse>>;
  getEvent(args: PortalApiCallArgs<GetEventRequest>): Promise<PortalApiCallResult<GetEventResponse>>;
  listBillingSummary(
    args: PortalApiCallArgs<ListBillingSummaryRequest>
  ): Promise<PortalApiCallResult<BillingSummaryResponse>>;
  createEvent(args: PortalApiCallArgs<CreateEventRequest>): Promise<PortalApiCallResult<CreateEventResponse>>;
  publishEvent(args: PortalApiCallArgs<PublishEventRequest>): Promise<PortalApiCallResult<PublishEventResponse>>;
  signupForEvent(
    args: PortalApiCallArgs<SignupForEventRequest>
  ): Promise<PortalApiCallResult<SignupForEventResponse>>;
  cancelEventSignup(
    args: PortalApiCallArgs<CancelEventSignupRequest>
  ): Promise<PortalApiCallResult<CancelEventSignupResponse>>;
  claimEventOffer(
    args: PortalApiCallArgs<ClaimEventOfferRequest>
  ): Promise<PortalApiCallResult<ClaimEventOfferResponse>>;
  checkInEvent(
    args: PortalApiCallArgs<CheckInEventRequest>
  ): Promise<PortalApiCallResult<CheckInEventResponse>>;
  createEventCheckoutSession(
    args: PortalApiCallArgs<CreateEventCheckoutSessionRequest>
  ): Promise<PortalApiCallResult<CreateEventCheckoutSessionResponse>>;
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

    async createReservation(args) {
      return await callFn<CreateReservationRequest, CreateReservationResponse>(
        baseUrl,
        "createReservation",
        args
      );
    },

    async continueJourney(args) {
      return await callFn<ContinueJourneyRequest, ContinueJourneyResponse>(baseUrl, "continueJourney", args);
    },

    async listMaterialsProducts(args) {
      return await callFn<ListMaterialsProductsRequest, ListMaterialsProductsResponse>(
        baseUrl,
        "listMaterialsProducts",
        args
      );
    },

    async createMaterialsCheckoutSession(args) {
      return await callFn<CreateMaterialsCheckoutSessionRequest, CreateMaterialsCheckoutSessionResponse>(
        baseUrl,
        "createMaterialsCheckoutSession",
        args
      );
    },

    async seedMaterialsCatalog(args) {
      return await callFn<SeedMaterialsCatalogRequest, SeedMaterialsCatalogResponse>(
        baseUrl,
        "seedMaterialsCatalog",
        args
      );
    },

    async listEvents(args) {
      return await callFn<ListEventsRequest, ListEventsResponse>(baseUrl, "listEvents", args);
    },

    async listEventSignups(args) {
      return await callFn<ListEventSignupsRequest, ListEventSignupsResponse>(baseUrl, "listEventSignups", args);
    },

    async listBillingSummary(args) {
      return await callFn<ListBillingSummaryRequest, BillingSummaryResponse>(
        baseUrl,
        "listBillingSummary",
        args
      );
    },

    async getEvent(args) {

      return await callFn<GetEventRequest, GetEventResponse>(baseUrl, "getEvent", args);
    },

    async createEvent(args) {
      return await callFn<CreateEventRequest, CreateEventResponse>(baseUrl, "createEvent", args);
    },

    async publishEvent(args) {
      return await callFn<PublishEventRequest, PublishEventResponse>(baseUrl, "publishEvent", args);
    },

    async signupForEvent(args) {
      return await callFn<SignupForEventRequest, SignupForEventResponse>(baseUrl, "signupForEvent", args);
    },

    async cancelEventSignup(args) {
      return await callFn<CancelEventSignupRequest, CancelEventSignupResponse>(baseUrl, "cancelEventSignup", args);
    },

    async claimEventOffer(args) {
      return await callFn<ClaimEventOfferRequest, ClaimEventOfferResponse>(baseUrl, "claimEventOffer", args);
    },

    async checkInEvent(args) {
      return await callFn<CheckInEventRequest, CheckInEventResponse>(baseUrl, "checkInEvent", args);
    },

    async createEventCheckoutSession(args) {
      return await callFn<CreateEventCheckoutSessionRequest, CreateEventCheckoutSessionResponse>(
        baseUrl,
        "createEventCheckoutSession",
        args
      );
    },
  };
}
