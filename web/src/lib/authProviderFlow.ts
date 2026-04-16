export type AuthProviderId = "google" | "apple" | "facebook" | "microsoft";

const POPUP_REDIRECT_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
]);

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

export function shouldTryPopupFirst(providerId: AuthProviderId): boolean {
  return providerId === "google";
}

export function shouldFallbackToRedirect(error: unknown): boolean {
  return POPUP_REDIRECT_FALLBACK_CODES.has(getErrorCode(error));
}
