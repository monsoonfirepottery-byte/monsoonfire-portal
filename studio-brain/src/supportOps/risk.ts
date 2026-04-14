import { getAuth } from "firebase-admin/auth";
import type { SupportMailboxMessage, SupportPolicyResolution, SupportRiskAssessment } from "./types";

const ACCESS_SECRET_PATTERN = /\b(gate code|door code|access code|address|entry code)\b/i;
const BILLING_EXCEPTION_PATTERN = /\b(refund|credit|waive|waiver|chargeback|reverse charge|exception)\b/i;
const MANUAL_OVERRIDE_PATTERN = /\b(manual override|bypass|ignore policy|just make an exception|override the queue)\b/i;
const FORWARDED_PATTERN = /\b(forwarded message|fw:|fwd:|from:\s.+@)\b/i;
const SUSPICIOUS_LINK_DOMAIN_PATTERN = /(tinyurl\.com|bit\.ly|t\.co|forms\.gle|drive\.google\.com)/i;
const SUSPICIOUS_ATTACHMENT_PATTERN = /\.(zip|rar|7z|exe|msi|dmg|bat|cmd|scr|js)$/i;

function normalizeText(message: SupportMailboxMessage): string {
  return [message.subject, message.snippet, message.bodyText].join(" ").toLowerCase();
}

export async function assessSupportRisk(
  message: SupportMailboxMessage,
  policy: SupportPolicyResolution
): Promise<SupportRiskAssessment> {
  const senderEmail = message.senderEmail?.trim().toLowerCase() ?? null;
  let senderVerifiedUid: string | null = null;
  if (senderEmail) {
    try {
      const user = await getAuth().getUserByEmail(senderEmail);
      senderVerifiedUid = user.uid;
    } catch {
      senderVerifiedUid = null;
    }
  }

  const text = normalizeText(message);
  const suspiciousLinks = message.linkDomains.filter((domain) => SUSPICIOUS_LINK_DOMAIN_PATTERN.test(domain));
  const suspiciousAttachments = message.attachments
    .map((attachment) => attachment.filename)
    .filter((filename) => SUSPICIOUS_ATTACHMENT_PATTERN.test(filename));
  const blockedActionRequested =
    policy.blockedActions.some((action) => action && text.includes(action.toLowerCase())) ||
    BILLING_EXCEPTION_PATTERN.test(text);
  const accessSecretRequested = ACCESS_SECRET_PATTERN.test(text);
  const forwarded = FORWARDED_PATTERN.test(text) || Boolean(message.inReplyTo && /@/.test(message.inReplyTo));
  const manualOverrideLanguage = MANUAL_OVERRIDE_PATTERN.test(text);
  const reasons: string[] = [];

  if (!senderVerifiedUid) reasons.push("sender_unverified");
  if (forwarded) reasons.push("forwarded_or_third_party_context");
  if (blockedActionRequested) reasons.push("blocked_action_requested");
  if (accessSecretRequested) reasons.push("access_secret_requested");
  if (manualOverrideLanguage) reasons.push("manual_override_language");
  if (suspiciousLinks.length > 0) reasons.push("suspicious_links");
  if (suspiciousAttachments.length > 0) reasons.push("suspicious_attachments");

  let state: SupportRiskAssessment["state"] = "clear";
  if (
    accessSecretRequested ||
    suspiciousAttachments.length > 0 ||
    suspiciousLinks.length > 0 ||
    (blockedActionRequested && !senderVerifiedUid)
  ) {
    state = "high_risk";
  } else if (reasons.length > 0) {
    state = "possible_security_risk";
  }

  return {
    state,
    reasons,
    senderVerifiedUid,
    senderMatchedAccount: Boolean(senderVerifiedUid),
    forwarded,
    suspiciousLinks,
    suspiciousAttachments,
    blockedActionRequested,
    accessSecretRequested,
    manualOverrideLanguage,
  };
}
