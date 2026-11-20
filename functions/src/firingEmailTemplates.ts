import { readFileSync } from "fs";
import { join } from "path";

export const FIRING_EMAIL_TEMPLATE_KEYS = [
  "work_received",
  "firing_underway",
  "cooling_down",
  "firing_complete",
  "pickup_reminder",
  "action_needed",
  "studio_update",
  "thank_you",
  "next_firing",
] as const;

export type FiringEmailTemplateKey = (typeof FIRING_EMAIL_TEMPLATE_KEYS)[number];

export type FiringEmailTemplateDefinition = {
  id: `MF-NOTIFY-0${number}`;
  key: FiringEmailTemplateKey;
  name: string;
  imageFile: string;
  altText: string;
  classification: "operational" | "manual_operational" | "relationship" | "marketing_follow_up";
  delivery: "automatic" | "billing_owned" | "policy_or_manual" | "manual_only" | "blocked_marketing";
  statusMappings: readonly string[];
  sendReady: boolean;
  title: string;
  defaultDetail: string;
  defaultNextStep: string;
  requiredLiveTextNote: string;
};

export const FIRING_EMAIL_TEMPLATES: Record<FiringEmailTemplateKey, FiringEmailTemplateDefinition> = {
  work_received: {
    id: "MF-NOTIFY-01",
    key: "work_received",
    name: "Work Received",
    imageFile: "work-received-v1-email.jpg",
    altText: "Work received. Your pieces are checked in, and Monsoon Fire will take it from here.",
    classification: "operational",
    delivery: "automatic",
    statusMappings: ["in_studio"],
    sendReady: true,
    title: "Your pieces are checked in.",
    defaultDetail: "We have received and identified your pieces. We’ll take it from here and message you again when firing begins.",
    defaultNextStep: "No action is needed right now.",
    requiredLiveTextNote: "This confirms receipt only; it does not confirm a final price, firing date, or pickup readiness.",
  },
  firing_underway: {
    id: "MF-NOTIFY-02",
    key: "firing_underway",
    name: "Firing Underway",
    imageFile: "firing-underway-v1-email.jpg",
    altText: "Firing underway. Your work is in the kiln, and Monsoon Fire will message when it is ready.",
    classification: "operational",
    delivery: "automatic",
    statusMappings: ["firing"],
    sendReady: true,
    title: "Your work is in the kiln.",
    defaultDetail: "Your firing is active. We’ll keep the kiln process undisturbed and send another update as it moves through cooling.",
    defaultNextStep: "We’ll message again after cooling and studio review.",
    requiredLiveTextNote: "Ceramic firing outcomes naturally vary; this status is not a guarantee of a particular artistic or commercial result.",
  },
  cooling_down: {
    id: "MF-NOTIFY-03",
    key: "cooling_down",
    name: "Cooling Down",
    imageFile: "cooling-down-v1-email.jpg",
    altText: "Cooling down. Your work is almost ready; please wait for the Monsoon Fire pickup-ready message.",
    classification: "operational",
    delivery: "automatic",
    statusMappings: ["cooling"],
    sendReady: true,
    title: "Almost there.",
    defaultDetail: "Your firing has entered its controlled cooling phase. The kiln must remain closed while temperatures settle.",
    defaultNextStep: "Please wait for the ready-for-pickup message.",
    requiredLiveTextNote: "Please do not visit for pickup until Monsoon Fire sends a pickup-ready notice.",
  },
  firing_complete: {
    id: "MF-NOTIFY-04",
    key: "firing_complete",
    name: "Firing Complete",
    imageFile: "firing-complete-ready-v1-email.jpg",
    altText: "Firing complete. Your work is ready; pickup details are in this message from Monsoon Fire.",
    classification: "operational",
    delivery: "billing_owned",
    statusMappings: ["ready_for_pickup"],
    sendReady: true,
    title: "Your firing is ready.",
    defaultDetail: "Your firing is finished and ready for pickup. Current payment and pickup details are included in this message.",
    defaultNextStep: "Use the current pickup instructions below. If you need a fresh copy later, use the pickup-details button in the ready email.",
    requiredLiveTextNote: "The live body must state the current invoice or payment status and pickup instructions; the image does not control either.",
  },
  pickup_reminder: {
    id: "MF-NOTIFY-05",
    key: "pickup_reminder",
    name: "Pickup Reminder",
    imageFile: "pickup-reminder-v1-email.jpg",
    altText: "Pickup reminder. Your fired work is waiting for you; pickup details are in this message from Monsoon Fire.",
    classification: "operational",
    delivery: "policy_or_manual",
    statusMappings: ["ready_for_pickup"],
    sendReady: true,
    title: "Your work is waiting for you.",
    defaultDetail: "Your fired work is still ready for pickup. Refer to the current collection window and storage status in this message.",
    defaultNextStep: "Reply if you need help arranging pickup.",
    requiredLiveTextNote: "The live body must state the current pickup deadline, grace or storage status, and any charge from the current Studio Policies; never reuse a stale deadline.",
  },
  action_needed: {
    id: "MF-NOTIFY-06",
    key: "action_needed",
    name: "Action Needed",
    imageFile: "action-needed-v1-email.jpg",
    altText: "Action needed. Monsoon Fire needs a little more information; please read this message and reply.",
    classification: "manual_operational",
    delivery: "manual_only",
    statusMappings: [],
    sendReady: true,
    title: "We need a little more information.",
    defaultDetail: "Before we continue, please reply with the specific information requested by the studio in this message.",
    defaultNextStep: "Nothing changes until a staff member reviews your reply.",
    requiredLiveTextNote: "Ask one specific question and avoid assigning damage, fault, or financial responsibility before review.",
  },
  studio_update: {
    id: "MF-NOTIFY-07",
    key: "studio_update",
    name: "Studio Update",
    imageFile: "studio-update-v1-email.jpg",
    altText: "Studio update. Monsoon Fire has a quick update about your firing; details are in this message.",
    classification: "manual_operational",
    delivery: "policy_or_manual",
    statusMappings: [],
    sendReady: true,
    title: "A quick update about your firing.",
    defaultDetail: "Your work remains safe at the studio. The details below explain what changed and when to expect the next update.",
    defaultNextStep: "No pickup action is implied by this update.",
    requiredLiveTextNote: "State what changed, what is known now, and when the next update is expected; do not guarantee a date the studio cannot support.",
  },
  thank_you: {
    id: "MF-NOTIFY-08",
    key: "thank_you",
    name: "Thank You",
    imageFile: "thank-you-v1-email.jpg",
    altText: "Thank you. Your fired work is home; Monsoon Fire looks forward to the next firing.",
    classification: "relationship",
    delivery: "automatic",
    statusMappings: ["picked_up", "pickup_complete", "closed_picked_up"],
    sendReady: true,
    title: "Your work is home.",
    defaultDetail: "Pickup is complete. Thank you for trusting Monsoon Fire with your work.",
    defaultNextStep: "Questions are always welcome by reply.",
    requiredLiveTextNote: "Keep this message to thanks and support. A review request, referral ask, offer, or next-firing call to action requires the commercial footer.",
  },
  next_firing: {
    id: "MF-NOTIFY-09",
    key: "next_firing",
    name: "Next Firing",
    imageFile: "next-firing-v1-email.jpg",
    altText: "Next firing. Monsoon Fire is ready when you are; start your next firing plan.",
    classification: "marketing_follow_up",
    delivery: "blocked_marketing",
    statusMappings: [],
    sendReady: false,
    title: "Ready when you are.",
    defaultDetail: "When you have another batch in mind, the current firing-planning path can help you get started.",
    defaultNextStep: "This invitation is optional.",
    requiredLiveTextNote: "This card is a planning asset only. Commercial delivery is restricted to the authenticated biannual client-newsletter route and its suppression gate.",
  },
};

export type FiringEmailInlineAttachment = {
  filename: string;
  content: string;
  encoding: "base64";
  cid: string;
  contentType: "image/jpeg";
  contentDisposition: "inline";
};

export type RenderFiringEmailInput = {
  recipientName?: string | null;
  ticketId?: string | null;
  detail?: string | null;
  nextStep?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  previewBlockedCommercial?: boolean;
};

export type RenderedFiringEmail = {
  key: FiringEmailTemplateKey;
  subject: string;
  text: string;
  html: string;
  attachment: FiringEmailInlineAttachment;
  sendReady: boolean;
};

const SUPPORT_EMAIL = "support@monsoonfire.com";
const POSTAL_ADDRESS = "17926 West Montebello Ave., Litchfield Park, AZ 85340";
const POLICY_VERSION = "2026-07-19";
const POLICY_LINKS = {
  privacy: "https://monsoonfire.com/privacy/",
  terms: "https://monsoonfire.com/terms/",
  policies: "https://monsoonfire.com/policies/",
  accessibility: "https://monsoonfire.com/accessibility/",
} as const;

const assetCache = new Map<FiringEmailTemplateKey, FiringEmailInlineAttachment>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clean(value: string | null | undefined, fallback: string): string {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function subjectFor(key: FiringEmailTemplateKey, ticketId: string | null): string {
  const suffix = ticketId ? ` — ${ticketId}` : "";
  switch (key) {
    case "work_received": return `Work received${suffix}`;
    case "firing_underway": return `Firing underway${suffix}`;
    case "cooling_down": return `Cooling down${suffix}`;
    case "firing_complete": return `Your firing is ready${suffix}`;
    case "pickup_reminder": return `Pickup reminder${suffix}`;
    case "action_needed": return `A quick question${suffix ? ` about ${ticketId}` : ""}`;
    case "studio_update": return `Studio update${suffix}`;
    case "thank_you": return "Thank you from Monsoon Fire";
    case "next_firing": return "Ready for your next firing?";
  }
}

export function firingEmailTemplateForTicketStatus(status: unknown): FiringEmailTemplateKey | null {
  if (typeof status !== "string") return null;
  const normalized = status.trim().toLowerCase();
  if (normalized === "in_studio") return "work_received";
  if (normalized === "firing") return "firing_underway";
  if (normalized === "cooling") return "cooling_down";
  if (["picked_up", "pickup_complete", "closed_picked_up"].includes(normalized)) return "thank_you";
  // ready_for_pickup remains owned by the billing finalization saga to avoid duplicate mail.
  return null;
}

export function getFiringEmailInlineAsset(key: FiringEmailTemplateKey): FiringEmailInlineAttachment {
  const cached = assetCache.get(key);
  if (cached) return cached;
  const definition = FIRING_EMAIL_TEMPLATES[key];
  const bytes = readFileSync(join(__dirname, "../assets/notifications", definition.imageFile));
  const attachment: FiringEmailInlineAttachment = {
    filename: definition.imageFile,
    content: bytes.toString("base64"),
    encoding: "base64",
    cid: `${definition.id.toLowerCase()}@monsoonfire`,
    contentType: "image/jpeg",
    contentDisposition: "inline",
  };
  assetCache.set(key, attachment);
  return attachment;
}

export function renderFiringEmailTemplate(
  key: FiringEmailTemplateKey,
  input: RenderFiringEmailInput = {}
): RenderedFiringEmail {
  const definition = FIRING_EMAIL_TEMPLATES[key];
  if (!definition.sendReady && !input.previewBlockedCommercial) {
    throw new Error(`${definition.id} is blocked for send until commercial-email requirements are verified`);
  }

  const recipientName = clean(input.recipientName, "there");
  const ticketId = clean(input.ticketId, "") || null;
  const detail = clean(input.detail, definition.defaultDetail);
  const nextStep = clean(input.nextStep, definition.defaultNextStep);
  const actionUrl = clean(input.actionUrl, "") || null;
  const actionLabel = clean(input.actionLabel, "View current details");
  const attachment = getFiringEmailInlineAsset(key);
  const subject = subjectFor(key, ticketId);
  const ticketLine = ticketId ? `Ticket: ${ticketId}` : "";
  const actionText = actionUrl ? `\n${actionLabel}: ${actionUrl}` : "";
  const footerText = definition.classification === "marketing_follow_up"
    ? [
        "NEWSLETTER ROUTE PREVIEW — DO NOT SEND THIS FIRING TEMPLATE DIRECTLY.",
        "Advertisement — Monsoon Fire client newsletter.",
        "To stop all Monsoon Fire marketing, use your email app's Unsubscribe control.",
        `If it is not shown, email ${SUPPORT_EMAIL} with UNSUBSCRIBE in the subject.`,
        "Unsubscribing does not stop service messages about work you have submitted.",
        "",
        "Monsoon Fire Pottery Studio",
        POSTAL_ADDRESS,
        SUPPORT_EMAIL,
      ]
    : [
        "This is a service message about your current or recently completed Monsoon Fire firing request. It is not a promotional email.",
        `Privacy: ${POLICY_LINKS.privacy}`,
        `Terms: ${POLICY_LINKS.terms}`,
        `Studio Policies: ${POLICY_LINKS.policies}`,
        `Accessibility: ${POLICY_LINKS.accessibility}`,
        "",
        "Monsoon Fire Pottery Studio",
        POSTAL_ADDRESS,
        SUPPORT_EMAIL,
        `Policy version: ${POLICY_VERSION}`,
        "© 2026 Monsoon Fire Pottery Studio. All rights reserved.",
      ];
  const text = [
    `Hi ${recipientName},`,
    "",
    definition.title,
    detail,
    "",
    "What happens next",
    nextStep,
    actionText,
    "",
    definition.requiredLiveTextNote,
    ticketLine,
    `Questions or accessibility needs? Reply to this email or contact ${SUPPORT_EMAIL}.`,
    "",
    ...footerText,
  ].filter((line) => line !== "").join("\n");

  const actionHtml = actionUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#95472f;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;">${escapeHtml(actionLabel)}</a></p>`
    : "";
  const ticketHtml = ticketId ? `Ticket: ${escapeHtml(ticketId)}<br>` : "";
  const footerHtml = definition.classification === "marketing_follow_up"
    ? `<tr><td style="padding:20px 28px;border-top:3px solid #c45f3b;background:#fff4df;color:#6d2f20;font:13px/1.55 Arial,sans-serif;">
          <p style="margin:0 0 8px;font-weight:700;">Newsletter route preview — do not send this firing template directly</p>
          <p style="margin:0 0 8px;"><strong>Advertisement — Monsoon Fire client newsletter.</strong></p>
          <p style="margin:0 0 8px;">To stop all Monsoon Fire marketing, use your email app's Unsubscribe control. If it is not shown, email <a href="mailto:${SUPPORT_EMAIL}?subject=UNSUBSCRIBE" style="color:#8a3f2b;">${SUPPORT_EMAIL}</a> with UNSUBSCRIBE in the subject.</p>
          <p style="margin:0 0 8px;">Unsubscribing does not stop service messages about work you have submitted.</p>
          <p style="margin:0;">Monsoon Fire Pottery Studio<br>${POSTAL_ADDRESS}<br>${SUPPORT_EMAIL}</p>
        </td></tr>`
    : `<tr><td style="padding:20px 28px;border-top:1px solid #d8c9b7;color:#66594f;font:12px/1.55 Arial,sans-serif;">
          <p style="margin:0 0 10px;">This is a service message about your current or recently completed Monsoon Fire firing request. It is not a promotional email.</p>
          <p style="margin:0 0 10px;"><a href="${POLICY_LINKS.privacy}" style="color:#8a3f2b;">Privacy</a> · <a href="${POLICY_LINKS.terms}" style="color:#8a3f2b;">Terms</a> · <a href="${POLICY_LINKS.policies}" style="color:#8a3f2b;">Studio Policies</a> · <a href="${POLICY_LINKS.accessibility}" style="color:#8a3f2b;">Accessibility</a></p>
          <p style="margin:0;">Monsoon Fire Pottery Studio<br>${POSTAL_ADDRESS}<br>${SUPPORT_EMAIL}<br>Policy version: ${POLICY_VERSION}<br>© 2026 Monsoon Fire Pottery Studio. All rights reserved.</p>
        </td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#15110e;color:#271d17;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;border-collapse:collapse;background:#f8f0e5;">
        <tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;">
          <p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p>
          <h1 style="margin:0;color:#f5ede2;font:600 28px/1.15 Georgia,serif;">${escapeHtml(subject)}</h1>
        </td></tr>
        <tr><td><img src="cid:${attachment.cid}" width="680" alt="${escapeHtml(definition.altText)}" style="display:block;width:100%;max-width:680px;height:auto;border:0;"></td></tr>
        <tr><td style="padding:26px 28px;">
          <p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(recipientName)},</p>
          <h2 style="margin:0 0 12px;color:#271d17;font:600 24px/1.2 Georgia,serif;">${escapeHtml(definition.title)}</h2>
          <p style="margin:0 0 18px;color:#271d17;font:16px/1.55 Georgia,serif;">${escapeHtml(detail)}</p>
          <div style="margin:0 0 18px;padding:16px 18px;background:#efe2cf;border:1px solid #dfd0bd;">
            <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">What happens next</p>
            <p style="margin:0;color:#271d17;font:15px/1.55 Georgia,serif;">${escapeHtml(nextStep)}</p>
            ${actionHtml}
          </div>
          <p style="margin:0;color:#695a4e;font:13px/1.55 Arial,sans-serif;">${escapeHtml(definition.requiredLiveTextNote)}</p>
          <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.55 Arial,sans-serif;">${ticketHtml}Questions or accessibility needs? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#8a3f2b;">${SUPPORT_EMAIL}</a>.</p>
        </td></tr>
        ${footerHtml}
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { key, subject, text, html, attachment, sendReady: definition.sendReady };
}
