export const LEGAL_DOCUMENT_VERSION = "2026-07-18";

export const defaultLegalAcceptance = Object.freeze({
  termsAccepted: false,
  policiesAcknowledged: false,
});

export function buildLegalAcceptance({ termsAccepted, policiesAcknowledged }) {
  return {
    termsAccepted,
    policiesAcknowledged,
    termsVersion: LEGAL_DOCUMENT_VERSION,
    privacyNoticeVersion: LEGAL_DOCUMENT_VERSION,
    studioPoliciesVersion: LEGAL_DOCUMENT_VERSION,
  };
}
