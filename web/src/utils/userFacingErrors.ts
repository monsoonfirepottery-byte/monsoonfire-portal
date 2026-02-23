import type { AppError, AppErrorKind } from "../errors/appError";
import { toAppError } from "../errors/appError";

type ErrorMessageOptions = {
  kind?: AppErrorKind;
  statusCode?: number;
  includeSupportCode?: boolean;
};

function asString(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

export function isConnectivityError(err: unknown): boolean {
  const raw = asString(err).toLowerCase();
  return (
    raw.includes("failed to fetch") ||
    raw.includes("networkerror") ||
    raw.includes("network request failed") ||
    raw.includes("load failed")
  );
}

function formatSurfaceMessage(error: AppError): string {
  return error.userMessage;
}

function supportCodeCopy(error: AppError): string {
  return `Contact support with this code: ${error.correlationId}`;
}

function appendSupportHint(message: string, error: AppError, includeSupportCode: boolean): string {
  if (!includeSupportCode) return message;
  if (message.includes("support code")) return message;
  return `${message} ${supportCodeCopy(error)}.`;
}

export type SurfaceError = {
  error: AppError;
  message: string;
};

export function buildSurfaceError(err: unknown, options: ErrorMessageOptions = {}): SurfaceError {
  const appError = toAppError(err, {
    kind: options.kind,
    statusCode: options.statusCode,
  });
  return {
    error: appError,
    message: appendSupportHint(
      formatSurfaceMessage(appError),
      appError,
      options.includeSupportCode !== false
    ),
  };
}

export function requestErrorMessage(err: unknown, options: ErrorMessageOptions = {}): string {
  const { error, message } = buildSurfaceError(err, {
    kind: options.kind,
    statusCode: options.statusCode,
    includeSupportCode: options.includeSupportCode,
  });

  if (error.kind === "functions" && error.statusCode === 409) {
    return `This action may already be in progress. Check your order/status and retry if needed. ${supportCodeCopy(
      error
    )}.`;
  }

  return message;
}

export function checkoutErrorMessage(err: unknown): string {
  const { error, message } = buildSurfaceError(err);
  if (error.kind === "auth") {
    return `${error.userMessage} Sign in again, then retry. ${supportCodeCopy(error)}.`;
  }

  if (error.kind === "functions" && error.statusCode === 409) {
    return `Checkout request may already be in progress. Check your order status and retry if needed. ${supportCodeCopy(error)}.`;
  }

  if (isConnectivityError(err)) {
    return `Could not reach checkout services. Check your connection and try again. ${supportCodeCopy(error)}.`;
  }

  if (error.kind === "payment") {
    return `${error.userMessage} ${supportCodeCopy(error)}.`;
  }

  return message;
}

export function authErrorMessage(err: unknown): string {
  const { error, message } = buildSurfaceError(err, { kind: "auth" });
  if (error.retryable) {
    return `${error.userMessage} Contact support with this code if it persists: ${error.correlationId}.`;
  }
  return `${message}`;
}

export function serviceOfflineMessage(): string {
  return "Could not reach portal services. If you are using local emulators, confirm Firestore and Functions are running.";
}
