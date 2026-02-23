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
  UpdateReservationRequest as ContractsUpdateReservationRequest,
  UpdateReservationResponse as ContractsUpdateReservationResponse,
  AssignReservationStationRequest as ContractsAssignReservationStationRequest,
  AssignReservationStationResponse as ContractsAssignReservationStationResponse,
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
import {
  getErrorCode,
  getErrorMessage,
  V1_RESERVATION_ASSIGN_STATION_FN,
  V1_RESERVATION_CREATE_FN,
  V1_RESERVATION_UPDATE_FN,
} from "./portalContracts";
import { makeRequestId as createRequestId } from "./requestId";
import type { AppError } from "../errors/appError";
import { toAppError } from "../errors/appError";
import {
  publishRequestTelemetry,
  redactTelemetryPayload,
  stringifyResponseSnippet,
} from "../lib/requestTelemetry";

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
export type UpdateReservationRequest = ContractsUpdateReservationRequest;
export type UpdateReservationResponse = ContractsUpdateReservationResponse;
export type AssignReservationStationRequest = ContractsAssignReservationStationRequest;
export type AssignReservationStationResponse = ContractsAssignReservationStationResponse;

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
  requestTimeoutMs?: number;
};

type PortalApiCallResult<TResp> = {
  data: TResp;
  meta: PortalApiMeta;
};

export class PortalApiError extends Error {
  meta: PortalApiMeta;
  appError?: AppError;

  constructor(message: string, meta: PortalApiMeta, appError?: AppError) {
    super(message);
    this.name = "PortalApiError";
    this.meta = meta;
    this.appError = appError;
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
  updateReservation(
    args: PortalApiCallArgs<UpdateReservationRequest>
  ): Promise<PortalApiCallResult<UpdateReservationResponse>>;
  assignReservationStation(
    args: PortalApiCallArgs<AssignReservationStationRequest>
  ): Promise<PortalApiCallResult<AssignReservationStationResponse>>;
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
  requestTimeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const RESERVATION_CREATE_FN = V1_RESERVATION_CREATE_FN;
const RESERVATION_UPDATE_FN = V1_RESERVATION_UPDATE_FN;
const RESERVATION_ASSIGN_STATION_FN = V1_RESERVATION_ASSIGN_STATION_FN;
// Back-compat aliases for older callers.
// Compatibility review date: 2026-05-15. Do not sunset before: 2026-06-30.
const LEGACY_RESERVATION_FN_PATHS: Partial<Record<PortalFnName, string>> = {
  createReservation: RESERVATION_CREATE_FN,
  updateReservation: RESERVATION_UPDATE_FN,
  assignReservationStation: RESERVATION_ASSIGN_STATION_FN,
};
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

function nowIso() {
  return new Date().toISOString();
}

const makeRequestId = createRequestId;

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
  const route = LEGACY_RESERVATION_FN_PATHS[fn] ?? fn;
  const url = `${baseUrl.replace(/\/$/, "")}/${route}`;
  const requestId = makeRequestId();

  const metaStart: PortalApiMeta = {
    atIso: nowIso(),
    requestId,
    fn,
    url,
    payload: args.payload,
    curlExample: buildCurlExample(url, args.payload, !!args.adminToken),
  };
  publishRequestTelemetry({
    atIso: metaStart.atIso,
    requestId,
    source: "portal-api",
    endpoint: url,
    method: "POST",
    payload: redactTelemetryPayload(args.payload),
    curl: metaStart.curlExample,
  });

  let resp: Response | null = null;
  let body: unknown = null;
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const requestTimeoutMs = args.requestTimeoutMs ?? 10_000;

  try {
    const abortController = new AbortController();
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      abortController.abort("request-timeout");
    }, requestTimeoutMs);

    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.idToken}`,
        ...(args.adminToken ? { "x-admin-token": args.adminToken } : {}),
      },
      body: JSON.stringify(args.payload ?? {}),
      signal: abortController.signal,
    });
    clearTimeout(timeoutHandle);

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
      const appError = toAppError(body, {
        requestId,
        statusCode: resp.status,
        code,
        debugMessage: msg,
      });
      const enriched: PortalApiMeta = {
        ...metaDone,
        error: msg,
        message: appError.userMessage,
        ...(code ? { code } : {}),
      };
      publishRequestTelemetry({
        atIso: enriched.atIso,
        requestId,
        source: "portal-api",
        endpoint: url,
        method: "POST",
        payload: redactTelemetryPayload(args.payload),
        status: resp.status,
        ok: false,
        responseSnippet: stringifyResponseSnippet(body),
        error: `${appError.userMessage} (support code: ${appError.correlationId})`,
        curl: enriched.curlExample,
      });
      throw new PortalApiError(appError.userMessage, enriched, appError);
    }

    publishRequestTelemetry({
      atIso: metaDone.atIso,
      requestId,
      source: "portal-api",
      endpoint: url,
      method: "POST",
      payload: redactTelemetryPayload(args.payload),
      status: resp.status,
      ok: true,
      responseSnippet: stringifyResponseSnippet(body),
      curl: metaDone.curlExample,
    });
    return { data: body as TResp, meta: metaDone };
  } catch (error: unknown) {
    if (error instanceof PortalApiError) throw error;
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const msg = didTimeout
      ? `Request timeout after ${requestTimeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error ?? "Request failed");
    const appError = toAppError(error, {
      requestId,
      statusCode: resp?.status,
      debugMessage: msg,
    });
    const metaFail: PortalApiMeta = {
      ...metaStart,
      status: resp?.status,
      ok: false,
      response: body,
      error: msg,
      message: appError.userMessage,
    };
    publishRequestTelemetry({
      atIso: metaFail.atIso,
      requestId,
      source: "portal-api",
      endpoint: url,
      method: "POST",
      payload: redactTelemetryPayload(args.payload),
      status: resp?.status,
      ok: false,
      responseSnippet: stringifyResponseSnippet(body),
      error: `${appError.userMessage} (support code: ${appError.correlationId})`,
      curl: metaFail.curlExample,
    });
    throw new PortalApiError(appError.userMessage, metaFail, appError);
  }
}

export function createPortalApi(options: CreatePortalApiOptions = {}): PortalApi {
  const baseUrl =
    options.baseUrl ||
    (typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
      ? String(ENV.VITE_FUNCTIONS_BASE_URL)
      : DEFAULT_BASE_URL);
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  return {
    baseUrl,

    async createBatch(args) {
      return await callFn<CreateBatchRequest, CreateBatchResponse>(baseUrl, "createBatch", {
        ...args,
        requestTimeoutMs,
      });
    },

    async pickedUpAndClose(args) {
      return await callFn<PickedUpAndCloseRequest, PickedUpAndCloseResponse>(baseUrl, "pickedUpAndClose", {
        ...args,
        requestTimeoutMs,
      });
    },

    async createReservation(args) {
      return await callFn<CreateReservationRequest, CreateReservationResponse>(
        baseUrl,
        RESERVATION_CREATE_FN,
        { ...args, requestTimeoutMs }
      );
    },

    async updateReservation(args) {
      return await callFn<UpdateReservationRequest, UpdateReservationResponse>(
        baseUrl,
        RESERVATION_UPDATE_FN,
        { ...args, requestTimeoutMs }
      );
    },

    async assignReservationStation(args) {
      return await callFn<AssignReservationStationRequest, AssignReservationStationResponse>(
        baseUrl,
        RESERVATION_ASSIGN_STATION_FN,
        { ...args, requestTimeoutMs }
      );
    },

    async continueJourney(args) {
      return await callFn<ContinueJourneyRequest, ContinueJourneyResponse>(baseUrl, "continueJourney", {
        ...args,
        requestTimeoutMs,
      });
    },

    async listMaterialsProducts(args) {
      return await callFn<ListMaterialsProductsRequest, ListMaterialsProductsResponse>(
        baseUrl,
        "listMaterialsProducts",
        { ...args, requestTimeoutMs }
      );
    },

    async createMaterialsCheckoutSession(args) {
      return await callFn<CreateMaterialsCheckoutSessionRequest, CreateMaterialsCheckoutSessionResponse>(
        baseUrl,
        "createMaterialsCheckoutSession",
        { ...args, requestTimeoutMs }
      );
    },

    async seedMaterialsCatalog(args) {
      return await callFn<SeedMaterialsCatalogRequest, SeedMaterialsCatalogResponse>(
        baseUrl,
        "seedMaterialsCatalog",
        { ...args, requestTimeoutMs }
      );
    },

    async listEvents(args) {
      return await callFn<ListEventsRequest, ListEventsResponse>(baseUrl, "listEvents", {
        ...args,
        requestTimeoutMs,
      });
    },

    async listEventSignups(args) {
      return await callFn<ListEventSignupsRequest, ListEventSignupsResponse>(baseUrl, "listEventSignups", {
        ...args,
        requestTimeoutMs,
      });
    },

    async listBillingSummary(args) {
      return await callFn<ListBillingSummaryRequest, BillingSummaryResponse>(
        baseUrl,
        "listBillingSummary",
        { ...args, requestTimeoutMs }
      );
    },

    async getEvent(args) {

      return await callFn<GetEventRequest, GetEventResponse>(baseUrl, "getEvent", {
        ...args,
        requestTimeoutMs,
      });
    },

    async createEvent(args) {
      return await callFn<CreateEventRequest, CreateEventResponse>(baseUrl, "createEvent", {
        ...args,
        requestTimeoutMs,
      });
    },

    async publishEvent(args) {
      return await callFn<PublishEventRequest, PublishEventResponse>(baseUrl, "publishEvent", {
        ...args,
        requestTimeoutMs,
      });
    },

    async signupForEvent(args) {
      return await callFn<SignupForEventRequest, SignupForEventResponse>(baseUrl, "signupForEvent", {
        ...args,
        requestTimeoutMs,
      });
    },

    async cancelEventSignup(args) {
      return await callFn<CancelEventSignupRequest, CancelEventSignupResponse>(baseUrl, "cancelEventSignup", {
        ...args,
        requestTimeoutMs,
      });
    },

    async claimEventOffer(args) {
      return await callFn<ClaimEventOfferRequest, ClaimEventOfferResponse>(baseUrl, "claimEventOffer", {
        ...args,
        requestTimeoutMs,
      });
    },

    async checkInEvent(args) {
      return await callFn<CheckInEventRequest, CheckInEventResponse>(baseUrl, "checkInEvent", {
        ...args,
        requestTimeoutMs,
      });
    },

    async createEventCheckoutSession(args) {
      return await callFn<CreateEventCheckoutSessionRequest, CreateEventCheckoutSessionResponse>(
        baseUrl,
        "createEventCheckoutSession",
        { ...args, requestTimeoutMs }
      );
    },
  };
}
