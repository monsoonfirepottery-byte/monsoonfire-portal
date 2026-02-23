import { makeRequestId } from "../api/requestId";

export type AppErrorKind =
  | "auth"
  | "payment"
  | "firestore"
  | "functions"
  | "network"
  | "unknown";

export type AppErrorOptions = {
  kind?: AppErrorKind;
  statusCode?: number;
  code?: string;
  requestId?: string;
  userMessage?: string;
  debugMessage?: string;
  retryable?: boolean;
  authFailureReason?: string;
};

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

export class AppError extends Error {
  kind: AppErrorKind;
  userMessage: string;
  debugMessage: string;
  correlationId: string;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  authFailureReason?: string;

  constructor(input: {
    kind: AppErrorKind;
    userMessage: string;
    debugMessage: string;
    correlationId: string;
    retryable: boolean;
    statusCode?: number;
    code?: string;
    authFailureReason?: string;
  }) {
    super(input.userMessage);
    this.name = "AppError";
    this.kind = input.kind;
    this.userMessage = input.userMessage;
    this.debugMessage = input.debugMessage;
    this.correlationId = input.correlationId;
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.authFailureReason = input.authFailureReason;
  }
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value == null) return "";
  return String(value);
}

function asStatusCode(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.trunc(value);
  if (rounded < 100 || rounded > 599) return undefined;
  return rounded;
}

function normalizeCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next ? next : undefined;
}

function getErrorLike(value: unknown): ErrorLike {
  if (!value || typeof value !== "object") return {};
  return value as ErrorLike;
}

function isConnectivityMessage(rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    lower.includes("fetch failed") ||
    lower.includes("network timeout") ||
    lower.includes("timed out")
  );
}

function isChunkLoadMessage(rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes("loading chunk") ||
    lower.includes("chunkloaderror") ||
    lower.includes("failed to load chunk") ||
    lower.includes("imported module") ||
    lower.includes("dynamic import")
  );
}

function isAuthMessage(rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes("unauthenticated") ||
    lower.includes("unauthorized") ||
    lower.includes("permission denied") ||
    lower.includes("forbidden") ||
    lower.includes("invalid authorization token") ||
    lower.includes("missing authorization") ||
    lower.includes("authorization header") ||
    lower.includes("session expired")
  );
}

function inferAuthFailureReason(rawMessage: string, statusCode?: number, code?: string): string | undefined {
  const lower = rawMessage.toLowerCase();
  if (!lower) return undefined;
  if (code === "UNAUTHENTICATED" || code === "PERMISSION_DENIED") return "credential invalid";
  if (statusCode !== 401 && statusCode !== 403) return undefined;

  if (lower.includes("expired")) return "credential expired";
  if (lower.includes("revoked") || lower.includes("disabled")) return "account access revoked";
  if (lower.includes("permission denied") || lower.includes("forbidden") || lower.includes("unauthorized") || lower.includes("unauthenticated")) {
    return "permission denied";
  }
  if (lower.includes("token") || lower.includes("id token") || lower.includes("auth")) {
    return "credential invalid";
  }

  return "session issue";
}

function isContractMismatchMessage(rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  const hasRequiredFields = lower.includes("uid") || lower.includes("frombatchid") || lower.includes("event id");
  return (
    (lower.includes("required") && hasRequiredFields && (lower.includes("missing") || lower.includes("invalid") || lower.includes("parse"))) ||
    lower.includes("cart is empty") ||
    lower.includes("invalid argument") ||
    lower.includes("validation") ||
    lower.includes("required argument") ||
    lower.includes("parsed message")
  );
}

function isPaymentConfigMessage(rawMessage: string): boolean {
  const lower = rawMessage.toLowerCase();
  return (
    lower.includes("stripe") &&
    (lower.includes("price") || lower.includes("checkout") || lower.includes("customer portal")) &&
    (lower.includes("missing") || lower.includes("not configured") || lower.includes("invalid") || lower.includes("error"))
  );
}

export function isMissingFirestoreIndexError(value: unknown): boolean {
  const message = asString(value).toLowerCase();
  return (
    message.includes("requires an index") ||
    (message.includes("failed_precondition") && message.includes("index")) ||
    (message.includes("missing firestore composite index") && message.includes("index"))
  );
}

function inferKindFromSignals(input: {
  code?: string;
  statusCode?: number;
  debugMessage: string;
  explicitKind?: AppErrorKind;
}): AppErrorKind {
  if (input.explicitKind) return input.explicitKind;
  const lowerCode = (input.code ?? "").toLowerCase();
  const lowerMessage = input.debugMessage.toLowerCase();
  const statusCode = input.statusCode;

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lowerCode === "unauthenticated" ||
    lowerCode === "permission_denied" ||
    lowerCode.startsWith("auth/") ||
    isAuthMessage(lowerMessage)
  ) {
    return "auth";
  }

  if (
    lowerMessage.includes("stripe") ||
    lowerMessage.includes("checkout") ||
    lowerMessage.includes("payment") ||
    lowerCode.includes("stripe") ||
    isPaymentConfigMessage(lowerMessage)
  ) {
    return "payment";
  }

  if (
    lowerMessage.includes("firestore") ||
    lowerCode.includes("failed_precondition") ||
    lowerCode.includes("permission_denied") ||
    isMissingFirestoreIndexError(input.debugMessage)
  ) {
    return "firestore";
  }

  if (isConnectivityMessage(lowerMessage) || isChunkLoadMessage(lowerMessage)) return "network";

  if (
    lowerCode === "invalid_argument" ||
    lowerCode === "bad_request" ||
    isContractMismatchMessage(lowerMessage)
  ) {
    return "functions";
  }

  if (statusCode === 409 && !lowerCode) return "functions";

  if (typeof statusCode === "number") return "functions";

  return "unknown";
}

function inferRetryable(input: {
  kind: AppErrorKind;
  statusCode?: number;
  debugMessage: string;
  explicitRetryable?: boolean;
}): boolean {
  if (typeof input.explicitRetryable === "boolean") return input.explicitRetryable;
  if (input.kind === "network") return true;
  if (input.statusCode === 408 || input.statusCode === 429) return true;
  if (typeof input.statusCode === "number" && input.statusCode >= 500) return true;

  const lowerMessage = input.debugMessage.toLowerCase();
  if (lowerMessage.includes("timed out") || lowerMessage.includes("timeout")) return true;
  if (isChunkLoadMessage(lowerMessage)) return true;

  return false;
}

function buildUserMessage(input: {
  kind: AppErrorKind;
  authFailureReason?: string;
  retryable: boolean;
  debugMessage: string;
  statusCode?: number;
}): string {
  const suffix = input.retryable
    ? "Try again."
    : "Contact support with this code if it continues.";
  const authReasonText = input.authFailureReason ? ` (${input.authFailureReason})` : "";

  if (input.kind === "auth") {
    if (input.statusCode === 401 || input.statusCode === 403) {
      return `Session issue${authReasonText}. Sign in again, then retry.`;
    }

    return `Session issue${authReasonText}. Sign in again, then retry.`;
  }

  if (input.kind === "network") {
    if (isChunkLoadMessage(input.debugMessage.toLowerCase())) {
      return "A page module failed to load. Reload to recover from a network/code update interruption.";
    }
    return "You appear to be offline or on a weak network. Reconnect, then try again.";
  }

  if (input.kind === "payment") {
    const lower = input.debugMessage.toLowerCase();

    if (isPaymentConfigMessage(lower)) {
      return "Payment setup is missing required Stripe configuration. Contact support with this code.";
    }

    if (input.statusCode === 409) {
      return "A checkout request may already be in progress. Check your order/billing state before retrying.";
    }

    if (input.statusCode === 429 || input.statusCode === 500 || (input.statusCode ?? 0) >= 500) {
      return "Payment service is temporarily unavailable. Try again in a moment.";
    }

    return `Could not complete checkout. ${suffix}`;
  }

  if (input.kind === "firestore" && isMissingFirestoreIndexError(input.debugMessage)) {
    return `A required database index is missing or still building. ${suffix}`;
  }

  if (input.kind === "functions") {
    if (input.statusCode === 400 && isContractMismatchMessage(input.debugMessage)) {
      return "That request was rejected due to an input contract mismatch. Check required values (uid / fromBatchId) and retry.";
    }

    if (input.statusCode === 409) {
      return "This action was already processed. Refresh to confirm current state.";
    }

    if (input.statusCode === 429) {
      return "Portal is handling high traffic right now. Try again in a minute.";
    }
    if ((input.statusCode ?? 0) >= 500) {
      return "Portal services are temporarily unavailable. Try again.";
    }
    return `We could not complete that request. ${suffix}`;
  }

  return `Something went wrong. ${suffix}`;
}

export function toAppError(error: unknown, options: AppErrorOptions = {}): AppError {
  if (error instanceof AppError) return error;

  const asObj = getErrorLike(error);
  const rawDebugMessage =
    options.debugMessage ??
    (typeof asObj.message === "string" ? asObj.message : asString(error));
  const debugMessage = rawDebugMessage.trim() || "Request failed";
  const statusCode = asStatusCode(options.statusCode ?? asObj.statusCode ?? asObj.status);
  const code = normalizeCode(options.code ?? asObj.code);
  const authFailureReason = options.authFailureReason ?? inferAuthFailureReason(debugMessage, statusCode, code);
  const kind = inferKindFromSignals({
    code,
    statusCode,
    debugMessage,
    explicitKind: options.kind,
  });
  const retryable = inferRetryable({
    kind,
    statusCode,
    debugMessage,
    explicitRetryable: options.retryable,
  });
  const userMessage =
    options.userMessage?.trim() ||
    buildUserMessage({
      kind,
      authFailureReason,
      retryable,
      debugMessage,
      statusCode,
    });
  const correlationId = options.requestId?.trim() || makeRequestId();

  return new AppError({
    kind,
    userMessage,
    debugMessage,
    correlationId,
    retryable,
    statusCode,
    code,
    authFailureReason,
  });
}
