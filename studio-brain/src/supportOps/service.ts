import { stableHashDeep } from "../stores/hash";
import type { EventStore } from "../stores/interfaces";
import type { Logger } from "../config/logger";
import type { CapabilityRuntime } from "../capabilities/runtime";
import { resolveSupportPolicy } from "./policyResolver";
import { assessSupportRisk } from "./risk";
import { supportAgentSignatureLines } from "./persona";
import type { SupportOpsStore } from "./store";
import type {
  SupportAutomationState,
  SupportCaseSnapshot,
  SupportDecision,
  SupportMemberCareReason,
  SupportMemberCareState,
  SupportMailboxReader,
  SupportMailboxMessage,
  SupportPolicyResolution,
  SupportProposalPlan,
  SupportProvider,
  SupportQueueBucket,
  SupportReplySender,
  SupportReplyPlan,
  SupportRiskAssessment,
  SupportRiskState,
  SupportWarmTouchPlaybook,
} from "./types";

const BILLING_PROPOSAL_PATTERN = /\b(refund|credit|charge|billing|receipt|invoice|waive|fee)\b/i;
const ACCESS_PROPOSAL_PATTERN = /\b(access code|gate code|door code|entry code|address|after[- ]?hours|unlock|building access|studio access)\b/i;
const QUEUE_PROPOSAL_PATTERN = /\b(queue|deadline|rush|expedite|priority|guarantee|guaranteed|same[- ]?day)\b/i;
const RESERVATION_PROPOSAL_PATTERN = /\b(reservation|booking|reschedule|pickup window|pickup|drop[- ]?off|load change|kiln allocation)\b/i;
const APOLOGY_PATTERN = /\b(sorry|apologize|apologies|my bad|missed)\b/i;
const GRATITUDE_PATTERN = /\b(thank you|thanks|appreciate)\b/i;
const CLARIFICATION_PATTERN = /\b(confirm|clarify|checking|does that work|would that work|is that okay|can i|could i)\b/i;
const CONFUSION_PATTERN = /\b(confused|uncertain|not sure|just checking|any chance|timing|delay|running late|reschedule|shift)\b/i;
const FRUSTRATION_PATTERN = /\b(frustrated|upset|annoyed|disappointed|still waiting|ridiculous|this is taking forever)\b/i;
const OVERWHELMED_PATTERN = /\b(overwhelmed|lost|embarrassed|sorry if this is dumb|i don't understand)\b/i;
const PICKUP_PATTERN = /\b(pickup|pick up|drop[- ]?off|porch|window|ready for pickup|come by|swing by)\b/i;
const SUPPORT_CONVERSATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const SUPPORT_FRESH_TOUCH_WINDOW_MS = 4 * 60 * 60 * 1000;

export type SupportEmailSyncReport = {
  provider: SupportProvider;
  mailbox: string;
  fetched: number;
  processed: number;
  skipped: number;
  deadLetters: number;
  repliesSent: number;
  replyDrafts: number;
  proposalsCreated: number;
  latestCursor: string | null;
  summary: string;
};

export type SupportEmailIngestPayload = {
  uid?: string | null;
  subject: string;
  body: string;
  category: string;
  status?: string | null;
  urgency?: string | null;
  displayName?: string | null;
  email?: string | null;
  senderEmail?: string | null;
  senderVerifiedUid?: string | null;
  sourceProvider: string;
  conversationKey?: string | null;
  sourceThreadId: string;
  sourceMessageId?: string | null;
  latestSourceMessageId?: string | null;
  threadDriftFlag?: boolean | null;
  memberVisibleThreadId?: string | null;
  riskState?: SupportRiskState | null;
  riskReasons?: string[];
  decision?: SupportDecision | null;
  automationState?: SupportAutomationState | null;
  memberCareState?: SupportMemberCareState | null;
  memberCareReason?: SupportMemberCareReason | null;
  lastCareTouchAt?: string | null;
  careTouchCount?: number | null;
  lastOperatorActionAt?: string | null;
  nextRecommendedAction?: string | null;
  supportSummary?: string | null;
  emberMemoryScope?: string | null;
  emberSummary?: string | null;
  confusionState?: SupportCaseSnapshot["confusionState"] | null;
  confusionReason?: string | null;
  humanHandoff?: boolean | null;
  latestInboundSubject?: string | null;
  latestInboundBody?: string | null;
  replyDraft?: string | null;
  proposalId?: string | null;
  proposalCapabilityId?: string | null;
  policyResolution?: {
    resolvedPolicySlug?: string | null;
    resolvedPolicyVersion?: string | null;
    discrepancyFlag?: boolean | null;
    escalationReason?: string | null;
    intentId?: string | null;
    requiredSignals?: string[];
    missingSignals?: string[];
    allowedLowRiskActions?: string[];
    blockedActions?: string[];
    matchedTerms?: string[];
    replyTemplate?: string | null;
    difficultProcessGuidance?: string[];
    practiceEvidenceIds?: string[];
    warmTouchPlaybook?: {
      tone?: string | null;
      acknowledge?: string | null;
      boundary?: string | null;
      nextStep?: string | null;
      triggers?: string[];
    } | null;
  } | null;
};

type SupportCaseIngestResult = {
  supportRequestId: string;
  created: boolean;
  matchedExisting: boolean;
  replayed: boolean;
};

type SupportMessageDisposition = {
  decision: SupportDecision;
  queueBucket: SupportQueueBucket;
  automationState: SupportAutomationState;
  proposalCapabilityId: string | null;
};

type SupportMemberCarePlan = {
  memberCareState: SupportMemberCareState;
  memberCareReason: SupportMemberCareReason | null;
  courtesySafe: boolean;
  sendNow: boolean;
  freshTouchExists: boolean;
  supportSummary: string;
  nextRecommendedAction: string;
};

export type SupportEmberMemoryHooks = {
  getDiscordContext?: (input: {
    channel: "discord";
    conversationKey: string;
    senderEmail: string | null;
    senderName: string | null;
    question: string;
  }) => Promise<{ summary: string | null } | null>;
  recordWorking: (input: {
    channel: "email" | "discord";
    conversationKey: string;
    senderEmail: string | null;
    senderName: string | null;
    supportRequestId: string;
    subject: string;
    latestAsk: string;
    supportSummary: string | null;
    nextRecommendedAction: string | null;
    confusionState: SupportCaseSnapshot["confusionState"];
    confusionReason: string | null;
    humanHandoff: boolean;
    issueType: string;
  }) => Promise<{ emberMemoryScope: string | null; emberSummary: string | null } | null>;
  recordResolved?: (input: {
    channel: "email" | "discord";
    conversationKey: string;
    senderEmail: string | null;
    senderName: string | null;
    supportRequestId: string;
    supportSummary: string | null;
    nextRecommendedAction: string | null;
    confusionState: SupportCaseSnapshot["confusionState"];
    confusionReason: string | null;
    humanHandoff: boolean;
    issueType: string;
    successfulReply: string | null;
  }) => Promise<void>;
};

export type SupportOpsServiceOptions = {
  logger: Logger;
  store: SupportOpsStore;
  mailboxReader: SupportMailboxReader;
  replySender?: SupportReplySender | null;
  capabilityRuntime: CapabilityRuntime;
  eventStore: EventStore;
  mailbox: string;
  provider?: SupportProvider;
  tenantId: string;
  maxMessages: number;
  query?: string;
  labelIds?: string[];
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  ingestRoute?: string;
  functionsBaseUrl?: string;
  ingestBearerToken?: string;
  ingestBearerTokenProvider?: () => Promise<string>;
  ingestAdminToken?: string;
  policyResolver?: (message: SupportMailboxMessage) => SupportPolicyResolution;
  riskAssessor?: (
    message: SupportMailboxMessage,
    policy: SupportPolicyResolution
  ) => Promise<SupportRiskAssessment>;
  ingestSupportRequest?: (payload: SupportEmailIngestPayload) => Promise<SupportCaseIngestResult>;
  recordLoopSignal?: (input: {
    loopKey: string;
    supportRequestId?: string | null;
    sourceMessageId?: string | null;
    action: "ack" | "escalate";
    note: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  emberMemory?: SupportEmberMemoryHooks | null;
};

function truncateText(value: string | null | undefined, maxLength: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function toTitleFromSlug(value: string | null): string {
  if (!value) return "support";
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? truncateText(subject, 200) : truncateText(`Re: ${subject}`, 200);
}

function buildReplyReferences(message: SupportMailboxMessage): string[] {
  const references = [...message.references];
  if (message.rfcMessageId && !references.includes(message.rfcMessageId)) {
    references.push(message.rfcMessageId);
  }
  return references;
}

function formatGreeting(message: SupportMailboxMessage): string {
  const name = truncateText(message.senderName, 80);
  return name ? `Hi ${name},` : "Hi,";
}

function supportSignatureBlock(): string[] {
  return supportAgentSignatureLines();
}

function safeStatusLine(policySlug: string | null): string {
  switch (policySlug) {
    case "firing-scheduling":
      return "Timing stays estimate-based until staff confirms any deadline-sensitive exception or queue change.";
    case "payments-refunds":
      return "Refunds, credits, and billing exceptions are never finalized automatically over email.";
    case "storage-abandoned-work":
      return "Storage timing stays tied to the recorded pickup-ready timeline and documented grace windows.";
    case "studio-access":
      return "Access logistics can be coordinated here, but access exceptions and codes are never granted automatically by email.";
    case "damage-responsibility":
      return "Damage questions stay in documentation-first review until evidence and responsibility are reconciled.";
    case "accessibility":
      return "Accessibility requests stay open until the requested accommodation path is confirmed with operations.";
    default:
      return "Any exception, refund, queue change, or access change still requires direct staff confirmation.";
  }
}

function combinedMessageText(message: SupportMailboxMessage): string {
  return [message.subject, message.snippet, message.bodyText].join(" ").toLowerCase();
}

function cleanMessageId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized ? normalized.replace(/[<>]/g, "") : null;
}

function normalizeSubjectFingerprint(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^\s*(re|fw|fwd)\s*:\s*/g, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function conversationTimeBucket(receivedAt: string): string {
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) return "unknown";
  return String(Math.floor(receivedAtMs / SUPPORT_CONVERSATION_WINDOW_MS));
}

export function buildSupportConversationKey(message: SupportMailboxMessage): string {
  const senderEmail = truncateText(message.senderEmail?.toLowerCase() ?? "", 320);
  const references = buildReplyReferences(message)
    .map((entry) => cleanMessageId(entry))
    .filter((entry): entry is string => Boolean(entry));
  const anchor =
    references[0]
    ?? cleanMessageId(message.inReplyTo)
    ?? cleanMessageId(message.rfcMessageId)
    ?? null;
  if (anchor) {
    return `support-conversation:${stableHashDeep({
      senderEmail,
      anchor,
    }).slice(0, 32)}`;
  }
  return `support-conversation:${stableHashDeep({
    senderEmail,
    subjectFingerprint: normalizeSubjectFingerprint(message.subject),
    bucket: conversationTimeBucket(message.receivedAt),
  }).slice(0, 32)}`;
}

export function supportChannelName(provider: SupportProvider): "email" | "discord" {
  return provider === "discord" ? "discord" : "email";
}

export function buildEmberRunId(channel: "email" | "discord", conversationKey: string): string {
  return `ember-support:${channel}:${truncateText(conversationKey, 240)}`;
}

export function buildEmberMemoryScope(channel: "email" | "discord", conversationKey: string): string {
  return `run:${buildEmberRunId(channel, conversationKey)}`;
}

export function buildEmberMemberSubject(value: string | null | undefined): string {
  const normalized = truncateText(String(value ?? "").trim().toLowerCase(), 320);
  const subject = normalized || "unknown";
  return `ember:member:${stableHashDeep(subject).slice(0, 24)}`;
}

export function buildEmberPatternSubject(issueType: string): string {
  const normalized = truncateText(issueType.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-"), 120) || "general";
  return `ember:pattern:${normalized}`;
}

function extendThreadHistory(existingSnapshot: SupportCaseSnapshot | null, threadId: string): string[] {
  const history = new Set<string>(existingSnapshot?.sourceThreadIds ?? []);
  if (existingSnapshot?.sourceThreadId) history.add(existingSnapshot.sourceThreadId);
  if (threadId) history.add(threadId);
  return [...history];
}

function hasFreshCareTouch(existingSnapshot: SupportCaseSnapshot | null, receivedAt: string): boolean {
  const lastCareTouchAt = existingSnapshot?.lastCareTouchAt ?? null;
  if (!lastCareTouchAt) return false;
  const lastTouchMs = Date.parse(lastCareTouchAt);
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(lastTouchMs) || !Number.isFinite(receivedAtMs)) return false;
  return receivedAtMs - lastTouchMs <= SUPPORT_FRESH_TOUCH_WINDOW_MS;
}

function detectMemberCareReason(
  message: SupportMailboxMessage,
  policy: SupportPolicyResolution,
  existingSnapshot: SupportCaseSnapshot | null,
): SupportMemberCareReason | null {
  const text = combinedMessageText(message);
  if (
    (policy.policySlug === "firing-scheduling" || policy.policySlug === "storage-abandoned-work" || PICKUP_PATTERN.test(text))
    && PICKUP_PATTERN.test(text)
  ) {
    return "pickup_coordination";
  }
  if (APOLOGY_PATTERN.test(text)) {
    return "apology";
  }
  if (CONFUSION_PATTERN.test(text)) {
    return "delay_reassurance";
  }
  if (CLARIFICATION_PATTERN.test(text) || existingSnapshot?.queueBucket === "staff_review") {
    return "clarification";
  }
  if (GRATITUDE_PATTERN.test(text) && existingSnapshot?.queueBucket === "resolved") {
    return "gratitude";
  }
  return null;
}

function detectConfusionState(
  message: SupportMailboxMessage,
  existingSnapshot: SupportCaseSnapshot | null,
): { state: SupportCaseSnapshot["confusionState"]; reason: string | null } {
  const text = combinedMessageText(message);
  if (OVERWHELMED_PATTERN.test(text)) {
    return { state: "overwhelmed", reason: "overwhelmed-language" };
  }
  if (FRUSTRATION_PATTERN.test(text)) {
    return { state: "frustrated", reason: "frustration-language" };
  }
  if (APOLOGY_PATTERN.test(text)) {
    return { state: "apologetic", reason: "apology-language" };
  }
  if (CONFUSION_PATTERN.test(text) || CLARIFICATION_PATTERN.test(text)) {
    return { state: "uncertain", reason: "timing-or-clarification" };
  }
  if (GRATITUDE_PATTERN.test(text) || existingSnapshot?.memberCareReason === "gratitude") {
    return { state: "grateful", reason: "gratitude-language" };
  }
  return { state: "none", reason: null };
}

function isCourtesySafe(input: {
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  memberCareReason: SupportMemberCareReason | null;
}): boolean {
  return Boolean(
    input.memberCareReason
    && input.policy.warmTouchPlaybook
    && input.risk.state !== "high_risk"
    && !input.risk.accessSecretRequested
    && !input.risk.blockedActionRequested
    && !input.risk.manualOverrideLanguage
    && input.risk.suspiciousAttachments.length === 0
    && input.risk.suspiciousLinks.length === 0
  );
}

function courtesyAcknowledgement(reason: SupportMemberCareReason | null, playbook: SupportWarmTouchPlaybook | null): string {
  switch (reason) {
    case "pickup_coordination":
      return playbook?.acknowledge ?? "Thanks for the update and for being flexible with the timing.";
    case "apology":
      return playbook?.acknowledge ?? "Thanks for the note, and no worries.";
    case "delay_reassurance":
      return playbook?.acknowledge ?? "Thanks for checking in. We know timing questions can feel uncertain.";
    case "gratitude":
      return playbook?.acknowledge ?? "Thanks for the kind note.";
    case "clarification":
      return playbook?.acknowledge ?? "Thanks for checking in and laying out the details clearly.";
    default:
      return playbook?.acknowledge ?? "Thanks for reaching out.";
  }
}

function courtesyBoundaryLine(policy: SupportPolicyResolution): string {
  return policy.warmTouchPlaybook?.boundary ?? safeStatusLine(policy.policySlug);
}

function courtesyNextStepLine(policy: SupportPolicyResolution): string {
  return policy.warmTouchPlaybook?.nextStep ?? "A team member will follow up in this same thread with the next step.";
}

function buildNextRecommendedAction(input: {
  decision: SupportDecision;
  proposalId: string | null;
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  threadDriftFlag: boolean;
  memberCareState: SupportMemberCareState;
}): string {
  const actions: string[] = [];
  if (input.threadDriftFlag) {
    actions.push("Review merged thread drift and confirm the conversation stayed on one case.");
  }
  if (input.decision === "security_hold" || input.risk.state === "high_risk") {
    actions.push("Review the security risk before sharing any protected details or access information.");
  } else if (input.decision === "proposal_required") {
    actions.push(
      input.proposalId
        ? "Inspect the approval proposal and reply without promising the exception until approval is complete."
        : "Create or inspect the approval proposal before replying."
    );
  } else if (input.decision === "ask_missing_info") {
    actions.push("Wait for the member to send the missing policy signals in this thread.");
  } else if (input.memberCareState === "staff_follow_up") {
    actions.push("Send a warm follow-up that confirms the next step without promising a blocked outcome.");
  } else if (input.memberCareState === "due") {
    actions.push("Send a warm-touch follow-up before the case ages further.");
  } else if (input.decision === "staff_review") {
    actions.push("Review the case context and send the next-step reply in this thread.");
  } else {
    actions.push("Monitor the thread for follow-up and only intervene if the request changes.");
  }
  if (input.policy.policySlug === "firing-scheduling") {
    actions.push("Do not promise same-day pickup or exact timing until staff confirms the window.");
  }
  return truncateText(actions.join(" "), 320);
}

function buildSupportSummary(input: {
  message: SupportMailboxMessage;
  policy: SupportPolicyResolution;
  memberCareReason: SupportMemberCareReason | null;
  nextRecommendedAction: string;
  supportRequestId: string;
}): string {
  const latestRequest = truncateText(input.message.bodyText || input.message.snippet || input.message.subject, 180);
  const summaryParts = [
    truncateText(input.message.senderName || input.message.senderEmail || "Unknown sender", 80),
    input.policy.policySlug ? toTitleFromSlug(input.policy.policySlug) : "Support",
    input.memberCareReason ? input.memberCareReason.replaceAll("_", " ") : null,
    latestRequest ? `Latest: ${latestRequest}` : null,
    `Next: ${input.nextRecommendedAction}`,
    `Case ${input.supportRequestId}`,
  ].filter(Boolean);
  return truncateText(summaryParts.join(" | "), 600);
}

function planMemberCare(input: {
  message: SupportMailboxMessage;
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  disposition: SupportMessageDisposition;
  existingSnapshot: SupportCaseSnapshot | null;
  supportRequestId: string;
  proposalId: string | null;
  threadDriftFlag: boolean;
}): SupportMemberCarePlan {
  const memberCareReason = detectMemberCareReason(input.message, input.policy, input.existingSnapshot);
  const courtesySafe = isCourtesySafe({
    policy: input.policy,
    risk: input.risk,
    memberCareReason,
  });
  const freshTouchExists = hasFreshCareTouch(input.existingSnapshot, input.message.receivedAt);
  const repeatedFollowUpWithoutFreshTouch =
    Boolean(input.existingSnapshot)
    && !freshTouchExists
    && Date.parse(input.existingSnapshot?.lastReceivedAt ?? "") < Date.parse(input.message.receivedAt);
  const shouldSendNow = courtesySafe && !freshTouchExists;
  const baseState: SupportMemberCareState =
    !memberCareReason
      ? "none"
      : courtesySafe
        ? repeatedFollowUpWithoutFreshTouch
          ? "due"
          : "due"
        : "staff_follow_up";
  const nextRecommendedAction = buildNextRecommendedAction({
    decision: input.disposition.decision,
    proposalId: input.proposalId,
    policy: input.policy,
    risk: input.risk,
    threadDriftFlag: input.threadDriftFlag,
    memberCareState: baseState,
  });
  return {
    memberCareState: freshTouchExists && baseState === "due" ? "sent" : baseState,
    memberCareReason,
    courtesySafe,
    sendNow: shouldSendNow,
    freshTouchExists,
    nextRecommendedAction,
    supportSummary: buildSupportSummary({
      message: input.message,
      policy: input.policy,
      memberCareReason,
      nextRecommendedAction,
      supportRequestId: input.supportRequestId,
    }),
  };
}

function buildReplyPlan(input: {
  message: SupportMailboxMessage;
  policy: SupportPolicyResolution;
  decision: SupportDecision;
  supportRequestId: string;
  memberCare: SupportMemberCarePlan;
}): SupportReplyPlan {
  const policyName = toTitleFromSlug(input.policy.policySlug);
  const subject = replySubject(input.message.subject);
  const acknowledgement = input.memberCare.memberCareReason
    ? courtesyAcknowledgement(input.memberCare.memberCareReason, input.policy.warmTouchPlaybook)
    : null;
  if (input.decision === "ask_missing_info") {
    const missingSignals = input.policy.missingSignals.length > 0
      ? input.policy.missingSignals.map((entry) => `- ${entry}`).join("\n")
      : "- Confirm the missing context in this thread.";
    return {
      shouldSend: true,
      subject,
      body: [
        formatGreeting(input.message),
        "",
        ...(acknowledgement ? [acknowledgement, ""] : []),
        `We recorded your email as Monsoon Fire support case ${input.supportRequestId} and matched it to our ${policyName} policy path.`,
        "To keep this case moving safely, please reply with the missing details below:",
        missingSignals,
        "",
        "We’ll keep everything in this same thread once those details are in place.",
        "",
        ...supportSignatureBlock(),
      ].join("\n"),
      lane: "policy_safe",
      memberCareState: input.memberCare.memberCareReason ? "sent" : input.memberCare.memberCareState,
      memberCareReason: input.memberCare.memberCareReason,
      nextRecommendedAction: "Wait for the member to provide the missing details in this thread.",
      supportSummary: input.memberCare.supportSummary,
    };
  }

  if (input.decision === "auto_reply") {
    return {
      shouldSend: true,
      subject,
      body: [
        formatGreeting(input.message),
        "",
        ...(acknowledgement ? [acknowledgement, ""] : []),
        `We recorded your email as Monsoon Fire support case ${input.supportRequestId} and matched it to our ${policyName} policy path.`,
        safeStatusLine(input.policy.policySlug),
        "Your case is staying in the policy-safe support lane right now, and we’ll follow up in this thread if anything needs human approval.",
        "",
        ...supportSignatureBlock(),
      ].join("\n"),
      lane: "policy_safe",
      memberCareState: input.memberCare.memberCareReason ? "sent" : input.memberCare.memberCareState,
      memberCareReason: input.memberCare.memberCareReason,
      nextRecommendedAction: "Monitor the thread for follow-up and only escalate if the request changes.",
      supportSummary: input.memberCare.supportSummary,
    };
  }

  if (input.memberCare.courtesySafe && input.memberCare.sendNow && input.memberCare.memberCareReason) {
    return {
      shouldSend: true,
      subject,
      body: [
        formatGreeting(input.message),
        "",
        courtesyAcknowledgement(input.memberCare.memberCareReason, input.policy.warmTouchPlaybook),
        "",
        "We added your latest note to the support thread.",
        courtesyBoundaryLine(input.policy),
        courtesyNextStepLine(input.policy),
        "",
        ...supportSignatureBlock(),
      ].join("\n"),
      lane: "courtesy_safe",
      memberCareState: "sent",
      memberCareReason: input.memberCare.memberCareReason,
      nextRecommendedAction: input.memberCare.nextRecommendedAction,
      supportSummary: input.memberCare.supportSummary,
    };
  }

  return {
    shouldSend: false,
    subject,
    body: "",
    lane: "none",
    memberCareState: input.memberCare.memberCareState,
    memberCareReason: input.memberCare.memberCareReason,
    nextRecommendedAction: input.memberCare.nextRecommendedAction,
    supportSummary: input.memberCare.supportSummary,
  };
}

export function determineProposalCapabilityId(
  message: SupportMailboxMessage,
  policy: SupportPolicyResolution
): string | null {
  const text = combinedMessageText(message);
  const blockedText = policy.blockedActions.join(" ").toLowerCase();

  if (ACCESS_PROPOSAL_PATTERN.test(text) || blockedText.includes("access")) {
    return "support.access.exception";
  }
  if (BILLING_PROPOSAL_PATTERN.test(text) || blockedText.includes("refund") || blockedText.includes("fee")) {
    return "support.billing.adjustment";
  }
  if (QUEUE_PROPOSAL_PATTERN.test(text) || blockedText.includes("queue") || blockedText.includes("deadline")) {
    return "support.queue.override";
  }
  if (RESERVATION_PROPOSAL_PATTERN.test(text) || blockedText.includes("reservation")) {
    return "support.reservation.override";
  }
  return null;
}

export function decideSupportAction(input: {
  message: SupportMailboxMessage;
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
}): SupportMessageDisposition {
  const { message, policy, risk } = input;
  const proposalCapabilityId = determineProposalCapabilityId(message, policy);
  const senderVerified = Boolean(risk.senderVerifiedUid);
  const clearForAutomation = senderVerified && risk.state === "clear" && !policy.discrepancyFlag;

  if (
    risk.state === "high_risk"
    || risk.accessSecretRequested
    || (risk.forwarded && (risk.blockedActionRequested || proposalCapabilityId !== null))
  ) {
    return {
      decision: "security_hold",
      queueBucket: "security_hold",
      automationState: "security_hold",
      proposalCapabilityId: null,
    };
  }

  if (!policy.policySlug) {
    return {
      decision: "staff_review",
      queueBucket: "staff_review",
      automationState: "staff_review",
      proposalCapabilityId: null,
    };
  }

  if (proposalCapabilityId) {
    if (clearForAutomation) {
      return {
        decision: "proposal_required",
        queueBucket: "awaiting_approval",
        automationState: "proposal_created",
        proposalCapabilityId,
      };
    }
    return {
      decision: "staff_review",
      queueBucket: "staff_review",
      automationState: "staff_review",
      proposalCapabilityId,
    };
  }

  if (policy.missingSignals.length > 0) {
    if (clearForAutomation) {
      return {
        decision: "ask_missing_info",
        queueBucket: "awaiting_info",
        automationState: "awaiting_info",
        proposalCapabilityId: null,
      };
    }
    return {
      decision: "staff_review",
      queueBucket: "staff_review",
      automationState: "staff_review",
      proposalCapabilityId: null,
    };
  }

  if (!clearForAutomation) {
    return {
      decision: "staff_review",
      queueBucket: "staff_review",
      automationState: "staff_review",
      proposalCapabilityId: null,
    };
  }

  return {
    decision: "auto_reply",
    queueBucket: "resolved",
    automationState: "auto_replied",
    proposalCapabilityId: null,
  };
}

function buildProposalPlan(input: {
  message: SupportMailboxMessage;
  policy: SupportPolicyResolution;
  supportRequestId: string;
  capabilityId: string;
}): SupportProposalPlan {
  const policyName = toTitleFromSlug(input.policy.policySlug);
  return {
    capabilityId: input.capabilityId,
    rationale: truncateText(
      `Support email ${input.message.messageId} for case ${input.supportRequestId} requires approval-gated handling under ${policyName}.`,
      400
    ),
    previewSummary: truncateText(
      `Support approval needed for ${policyName}: ${input.message.subject}`,
      200
    ),
    expectedEffects: [
      "Create an approval-gated support action proposal with audit evidence.",
      "Keep the member thread mirrored into the canonical support record.",
      "Prevent policy-blocked writes from executing automatically.",
    ],
  };
}

function computeBackoffUntil(nowMs: number, baseMs: number, maxMs: number, failures: number): string {
  const multiplier = Math.max(1, failures);
  const delayMs = Math.min(maxMs, baseMs * multiplier);
  return new Date(nowMs + delayMs).toISOString();
}

export class SupportOpsService {
  private readonly mailboxReader: SupportMailboxReader;
  private readonly replySender: SupportReplySender | null;
  private readonly provider: SupportProvider;
  private readonly mailbox: string;
  private readonly maxMessages: number;
  private readonly query: string | undefined;
  private readonly labelIds: string[] | undefined;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly ingestRoute: string;
  private readonly functionsBaseUrl: string;
  private readonly ingestBearerToken: string;
  private readonly ingestBearerTokenProvider: (() => Promise<string>) | null;
  private readonly ingestAdminToken: string;
  private readonly policyResolver: (message: SupportMailboxMessage) => SupportPolicyResolution;
  private readonly riskAssessor: (
    message: SupportMailboxMessage,
    policy: SupportPolicyResolution
  ) => Promise<SupportRiskAssessment>;
  private readonly ingestSupportRequest: (payload: SupportEmailIngestPayload) => Promise<SupportCaseIngestResult>;
  private readonly recordLoopSignal:
    | ((input: {
        loopKey: string;
        supportRequestId?: string | null;
        sourceMessageId?: string | null;
        action: "ack" | "escalate";
        note: string;
        metadata?: Record<string, unknown>;
      }) => Promise<void>)
    | null;
  private readonly emberMemory: SupportEmberMemoryHooks | null;

  constructor(private readonly options: SupportOpsServiceOptions) {
    this.mailboxReader = options.mailboxReader;
    this.replySender = options.replySender ?? null;
    this.provider = options.provider ?? "gmail";
    this.mailbox = options.mailbox;
    this.maxMessages = Math.max(1, Math.min(options.maxMessages, 100));
    this.query = options.query?.trim() || undefined;
    this.labelIds = options.labelIds?.filter(Boolean);
    this.backoffBaseMs = Math.max(5_000, options.backoffBaseMs ?? 30_000);
    this.backoffMaxMs = Math.max(this.backoffBaseMs, options.backoffMaxMs ?? 30 * 60 * 1000);
    this.ingestRoute = (options.ingestRoute ?? "apiV1/v1/support.requests.ingestEmail").replace(/^\/+/, "");
    this.functionsBaseUrl = String(options.functionsBaseUrl ?? "").replace(/\/+$/, "");
    this.ingestBearerToken = String(options.ingestBearerToken ?? "").trim();
    this.ingestBearerTokenProvider = options.ingestBearerTokenProvider ?? null;
    this.ingestAdminToken = String(options.ingestAdminToken ?? "").trim();
    this.policyResolver = options.policyResolver ?? resolveSupportPolicy;
    this.riskAssessor = options.riskAssessor ?? assessSupportRisk;
    this.ingestSupportRequest = options.ingestSupportRequest ?? ((payload) => this.defaultIngestSupportRequest(payload));
    this.recordLoopSignal = options.recordLoopSignal ?? null;
    this.emberMemory = options.emberMemory ?? null;

    if (!options.ingestSupportRequest) {
      if (!this.functionsBaseUrl) {
        throw new Error("SupportOpsService requires functionsBaseUrl when no ingestSupportRequest override is provided.");
      }
      if (!this.ingestBearerToken && !this.ingestBearerTokenProvider) {
        throw new Error(
          "SupportOpsService requires ingestBearerToken or ingestBearerTokenProvider when no ingestSupportRequest override is provided."
        );
      }
    }
  }

  private async resolveIngestBearerToken(): Promise<string> {
    if (this.ingestBearerToken) return this.ingestBearerToken;
    if (!this.ingestBearerTokenProvider) {
      throw new Error("SupportOpsService does not have an ingest bearer token provider configured.");
    }
    const token = String(await this.ingestBearerTokenProvider()).trim();
    if (!token) {
      throw new Error("SupportOpsService ingest bearer token provider returned an empty token.");
    }
    return token;
  }

  async syncMailbox(): Promise<SupportEmailSyncReport> {
    const state = await this.options.store.getMailboxState(this.provider, this.mailbox);
    const now = new Date();
    const nowIso = now.toISOString();
    const backoffUntilMs = state?.backoffUntil ? Date.parse(state.backoffUntil) : NaN;
    if (Number.isFinite(backoffUntilMs) && backoffUntilMs > now.getTime()) {
      const summary = "support sync skipped: mailbox in backoff";
      this.options.logger.warn("support_ops_sync_backoff", {
        provider: this.provider,
        mailbox: this.mailbox,
        backoffUntil: state?.backoffUntil ?? null,
      });
      return {
        provider: this.provider,
        mailbox: this.mailbox,
        fetched: 0,
        processed: 0,
        skipped: 1,
        deadLetters: 0,
        repliesSent: 0,
        replyDrafts: 0,
        proposalsCreated: 0,
        latestCursor: state?.historyCursor ?? null,
        summary,
      };
    }

    try {
      const result = await this.mailboxReader.listMessages({
        mailbox: this.mailbox,
        cursor: state?.historyCursor ?? null,
        maxMessages: this.maxMessages,
        query: this.query,
        labelIds: this.labelIds,
      });

      let processed = 0;
      let skipped = 0;
      let deadLetters = 0;
      let repliesSent = 0;
      let replyDrafts = 0;
      let proposalsCreated = 0;

      for (const message of result.messages) {
        const alreadyProcessed = await this.options.store.hasProcessedMessage(this.provider, message.messageId);
        if (alreadyProcessed) {
          skipped += 1;
          continue;
        }
        try {
          const outcome = await this.processMessage(message);
          processed += 1;
          if (outcome.replySent) repliesSent += 1;
          if (outcome.replyDrafted) replyDrafts += 1;
          if (outcome.proposalCreated) proposalsCreated += 1;
        } catch (error) {
          deadLetters += 1;
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.options.logger.error("support_ops_message_failed", {
            provider: message.provider,
            mailbox: message.mailbox,
            messageId: message.messageId,
            threadId: message.threadId,
            error: errorMessage,
          });
          await this.options.store.saveMessageRecord({
            provider: message.provider,
            mailbox: message.mailbox,
            messageId: message.messageId,
            threadId: message.threadId,
            supportRequestId: null,
            receivedAt: message.receivedAt,
            status: "dead_letter",
            decision: null,
            riskState: null,
            rawPayload: {
              subject: truncateText(message.subject, 200),
              senderEmail: message.senderEmail,
              error: errorMessage,
            },
          });
          await this.options.store.addDeadLetter({
            provider: message.provider,
            mailbox: message.mailbox,
            messageId: message.messageId,
            errorMessage,
            rawPayload: {
              subject: truncateText(message.subject, 200),
              senderEmail: message.senderEmail,
              threadId: message.threadId,
            },
          });
          await this.emitLoopSignal({
            loopKey: "support.email.dead-letter",
            sourceMessageId: message.messageId,
            action: "escalate",
            note: "Support mailbox message failed processing and was moved to dead letter handling.",
            metadata: {
              mailbox: message.mailbox,
              provider: message.provider,
              threadId: message.threadId,
              errorMessage,
            },
          });
        }
      }

      const queueSummary = await this.options.store.getQueueSummary();
      await this.options.store.saveMailboxState({
        provider: this.provider,
        mailbox: this.mailbox,
        historyCursor: result.latestCursor ?? result.nextCursor ?? state?.historyCursor ?? null,
        lastSyncAt: nowIso,
        lastSuccessAt: nowIso,
        consecutiveFailures: 0,
        backoffUntil: null,
        lastError: null,
        metadata: {
          fetched: result.messages.length,
          processed,
          skipped,
          deadLetters,
          repliesSent,
          replyDrafts,
          proposalsCreated,
          warmTouchesDue: queueSummary.warmTouchesDue,
          splitThreadSuspects: queueSummary.splitThreadSuspects,
        },
      });

      if (queueSummary.warmTouchesDue > 0) {
        await this.emitLoopSignal({
          loopKey: "support.email.warm-touch-due",
          action: "ack",
          note: "Support queue contains cases that need a warm-touch follow-up.",
          metadata: {
            warmTouchesDue: queueSummary.warmTouchesDue,
            totalOpen: queueSummary.totalOpen,
          },
        });
      }

      const summary = `support sync fetched=${result.messages.length} processed=${processed} skipped=${skipped} dead_letters=${deadLetters} replies=${repliesSent} drafts=${replyDrafts} proposals=${proposalsCreated}`;
      this.options.logger.info("support_ops_sync_completed", {
        provider: this.provider,
        mailbox: this.mailbox,
        fetched: result.messages.length,
        processed,
        skipped,
        deadLetters,
        repliesSent,
        replyDrafts,
        proposalsCreated,
        warmTouchesDue: queueSummary.warmTouchesDue,
        splitThreadSuspects: queueSummary.splitThreadSuspects,
        latestCursor: result.latestCursor ?? result.nextCursor ?? null,
      });
      return {
        provider: this.provider,
        mailbox: this.mailbox,
        fetched: result.messages.length,
        processed,
        skipped,
        deadLetters,
        repliesSent,
        replyDrafts,
        proposalsCreated,
        latestCursor: result.latestCursor ?? result.nextCursor ?? null,
        summary,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failures = Math.max(1, (state?.consecutiveFailures ?? 0) + 1);
      await this.options.store.saveMailboxState({
        provider: this.provider,
        mailbox: this.mailbox,
        historyCursor: state?.historyCursor ?? null,
        lastSyncAt: nowIso,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        consecutiveFailures: failures,
        backoffUntil: computeBackoffUntil(now.getTime(), this.backoffBaseMs, this.backoffMaxMs, failures),
        lastError: errorMessage,
        metadata: {
          lastFailureAt: nowIso,
        },
      });
      throw error;
    }
  }

  private async processMessage(message: SupportMailboxMessage): Promise<{
    replySent: boolean;
    replyDrafted: boolean;
    proposalCreated: boolean;
  }> {
    const conversationKey = buildSupportConversationKey(message);
    const policy = this.policyResolver(message);
    const risk = await this.riskAssessor(message, policy);
    const disposition = decideSupportAction({ message, policy, risk });

    const initialIngest = await this.ingestSupportRequest(this.buildIngestPayload({
      message,
      conversationKey,
      threadDriftFlag: false,
      policy,
      risk,
      decision: disposition.decision,
      automationState:
        disposition.decision === "proposal_required" ? "pending" : disposition.automationState,
      memberCareState: "none",
      memberCareReason: null,
      lastCareTouchAt: null,
      careTouchCount: null,
      lastOperatorActionAt: null,
      nextRecommendedAction: "Review the mirrored support case and continue the conversation safely.",
      supportSummary: null,
      emberMemoryScope: buildEmberMemoryScope(supportChannelName(message.provider), conversationKey),
      emberSummary: null,
      confusionState: "none",
      confusionReason: null,
      humanHandoff: disposition.decision === "security_hold" || disposition.decision === "staff_review",
      replyDraft: null,
      proposalId: null,
      proposalCapabilityId: null,
    }));

    const existingSnapshot = await this.options.store.getCaseSnapshot(initialIngest.supportRequestId);
    const replayNeedsHumanReview = initialIngest.replayed && !existingSnapshot;

    const effectiveDisposition = replayNeedsHumanReview
      ? {
          ...disposition,
          decision: "staff_review" as const,
          queueBucket: "staff_review" as const,
          automationState: "staff_review" as const,
          proposalCapabilityId: null,
        }
      : disposition;

    let proposalId = existingSnapshot?.proposalId ?? null;
    let proposalCapabilityId = effectiveDisposition.proposalCapabilityId ?? existingSnapshot?.proposalCapabilityId ?? null;
    let proposalCreated = false;

    if (effectiveDisposition.decision === "proposal_required" && proposalCapabilityId && !proposalId) {
      const proposalPlan = buildProposalPlan({
        message,
        policy,
        supportRequestId: initialIngest.supportRequestId,
        capabilityId: proposalCapabilityId,
      });
      const createdProposal = await this.createProposal({
        supportRequestId: initialIngest.supportRequestId,
        message,
        policy,
        plan: proposalPlan,
        ownerUid: risk.senderVerifiedUid ?? "support-ops",
      });
      proposalId = createdProposal.proposalId;
      proposalCapabilityId = createdProposal.proposalCapabilityId;
      proposalCreated = createdProposal.created;
    }

    const sourceThreadIds = extendThreadHistory(existingSnapshot, message.threadId);
    const threadDriftFlag = sourceThreadIds.length > 1;
    const newThreadDriftDetected =
      threadDriftFlag
      && (
        !existingSnapshot?.threadDriftFlag
        || !(existingSnapshot?.sourceThreadIds ?? []).includes(message.threadId)
      );
    const memberCare = planMemberCare({
      message,
      policy,
      risk,
      disposition: effectiveDisposition,
      existingSnapshot,
      supportRequestId: initialIngest.supportRequestId,
      proposalId,
      threadDriftFlag,
    });
    const confusion = detectConfusionState(message, existingSnapshot);

    const alreadyAutoHandled =
      existingSnapshot?.latestSourceMessageId === message.messageId
      && (
        existingSnapshot.automationState === "auto_replied"
        || existingSnapshot.automationState === "awaiting_info"
        || existingSnapshot.memberCareState === "sent"
        || existingSnapshot.memberCareState === "drafted"
      );
    const replyPlan = buildReplyPlan({
      message,
      policy,
      decision: effectiveDisposition.decision,
      supportRequestId: initialIngest.supportRequestId,
      memberCare,
    });
    const replyRequiresFollowUp =
      replyPlan.shouldSend
      && !initialIngest.replayed
      && !alreadyAutoHandled;
    const shouldSendReply =
      replyRequiresFollowUp
      && Boolean(message.senderEmail)
      && Boolean(this.replySender);
    const replyDraftedForReview = replyRequiresFollowUp && !shouldSendReply;
    const replyDraftReason = !replyDraftedForReview
      ? null
      : this.replySender
        ? "missing_sender_email"
        : "reply_sender_unavailable";
    const nowIso = new Date().toISOString();
    const existingCareTouchCount =
      existingSnapshot && typeof existingSnapshot.careTouchCount === "number"
        ? Math.max(0, Math.trunc(existingSnapshot.careTouchCount))
        : 0;
    const careTouchCreated = shouldSendReply || replyDraftedForReview;
    const finalMemberCareState: SupportMemberCareState =
      !replyPlan.memberCareReason
        ? memberCare.memberCareState
        : shouldSendReply
          ? "sent"
          : replyDraftedForReview
            ? "drafted"
            : memberCare.memberCareState;
    const finalLastCareTouchAt =
      careTouchCreated
        ? nowIso
        : existingSnapshot?.lastCareTouchAt ?? null;
    const finalCareTouchCount =
      careTouchCreated
        ? existingCareTouchCount + 1
        : existingCareTouchCount;

    const finalAutomationState =
      effectiveDisposition.decision === "proposal_required"
        ? proposalId ? "proposal_created" : "staff_review"
        : replyDraftedForReview
          ? "staff_review"
        : effectiveDisposition.automationState;
    const finalQueueBucket =
      effectiveDisposition.decision === "proposal_required"
        ? proposalId ? "awaiting_approval" : "staff_review"
        : replyDraftedForReview
          ? "staff_review"
        : effectiveDisposition.queueBucket;
    const issueType = truncateText(policy.policySlug ?? "general-support", 80) || "general-support";
    const humanHandoff = finalQueueBucket === "security_hold" || finalQueueBucket === "staff_review" || replayNeedsHumanReview;
    const finalLastOperatorActionAt =
      proposalCreated || careTouchCreated || finalQueueBucket === "security_hold"
        ? nowIso
        : existingSnapshot?.lastOperatorActionAt ?? null;
    const existingMessageCount =
      existingSnapshot && typeof existingSnapshot.rawSnapshot?.messageCount === "number"
        ? Math.max(1, Math.trunc(existingSnapshot.rawSnapshot.messageCount as number))
        : 0;
    const messageCount =
      initialIngest.replayed
        ? Math.max(1, existingMessageCount || 1)
        : Math.max(1, existingMessageCount + 1);
    const emberWorking =
      this.emberMemory
        ? await this.emberMemory.recordWorking({
            channel: supportChannelName(message.provider),
            conversationKey,
            senderEmail: message.senderEmail,
            senderName: message.senderName,
            supportRequestId: initialIngest.supportRequestId,
            subject: truncateText(message.subject, 200),
            latestAsk: truncateText(message.bodyText || message.snippet, 8_000),
            supportSummary: replyPlan.supportSummary,
            nextRecommendedAction: replyPlan.nextRecommendedAction,
            confusionState: confusion.state,
            confusionReason: confusion.reason,
            humanHandoff,
            issueType,
          }).catch((error) => {
            this.options.logger.warn("support_ops_ember_working_failed", {
              supportRequestId: initialIngest.supportRequestId,
              conversationKey,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;

    await this.ingestSupportRequest(this.buildIngestPayload({
      message,
      conversationKey,
      threadDriftFlag,
      policy,
      risk,
      decision: effectiveDisposition.decision,
      automationState: finalAutomationState,
      memberCareState: finalMemberCareState,
      memberCareReason: replyPlan.memberCareReason,
      lastCareTouchAt: finalLastCareTouchAt,
      careTouchCount: finalCareTouchCount,
      lastOperatorActionAt: finalLastOperatorActionAt,
      nextRecommendedAction: replyPlan.nextRecommendedAction,
      supportSummary: replyPlan.supportSummary,
      emberSummary: emberWorking?.emberSummary ?? replyPlan.supportSummary,
      emberMemoryScope: emberWorking?.emberMemoryScope ?? buildEmberMemoryScope(supportChannelName(message.provider), conversationKey),
      confusionState: confusion.state,
      confusionReason: confusion.reason,
      humanHandoff,
      replyDraft: replyPlan.shouldSend ? replyPlan.body : null,
      proposalId,
      proposalCapabilityId,
    }));

    let sentReplyMessageId: string | null = null;
    const replySender = this.replySender;
    if (shouldSendReply && replySender) {
      const sent = await replySender.sendReply({
        mailbox: this.mailbox,
        threadId: message.threadId,
        to: message.senderEmail ?? this.mailbox,
        subject: replyPlan.subject,
        body: replyPlan.body,
        inReplyTo: message.rfcMessageId,
        references: buildReplyReferences(message),
      });
      sentReplyMessageId = sent.messageId;
      await this.appendAudit("support_ops.reply_sent", "Sent a support reply through the approved policy or courtesy lane.", {
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        replyMessageId: sent.messageId,
        decision: effectiveDisposition.decision,
        lane: replyPlan.lane,
        memberCareReason: replyPlan.memberCareReason,
      });
    }
    if (replyDraftedForReview) {
      await this.appendAudit("support_ops.reply_drafted", "Drafted a support reply for manual or separate-sender follow-up.", {
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        decision: effectiveDisposition.decision,
        reason: replyDraftReason,
        lane: replyPlan.lane,
        memberCareReason: replyPlan.memberCareReason,
      });
    }

    const snapshot: SupportCaseSnapshot = {
      supportRequestId: initialIngest.supportRequestId,
      provider: message.provider,
      mailbox: message.mailbox,
      conversationKey,
      sourceThreadId: message.threadId,
      sourceThreadIds,
      sourceMessageId: message.messageId,
      latestSourceMessageId: message.messageId,
      threadDriftFlag,
      senderEmail: message.senderEmail,
      senderVerifiedUid: risk.senderVerifiedUid,
      subject: truncateText(message.subject, 200),
      decision: effectiveDisposition.decision,
      riskState: risk.state,
      riskReasons: [...risk.reasons].slice(0, 20),
      automationState: finalAutomationState,
      queueBucket: finalQueueBucket,
      unread: finalQueueBucket !== "resolved" && finalQueueBucket !== "awaiting_info",
      memberCareState: finalMemberCareState,
      memberCareReason: replyPlan.memberCareReason,
      lastCareTouchAt: finalLastCareTouchAt,
      careTouchCount: finalCareTouchCount,
      lastOperatorActionAt: finalLastOperatorActionAt,
      nextRecommendedAction: replyPlan.nextRecommendedAction,
      supportSummary: replyPlan.supportSummary,
      emberMemoryScope: emberWorking?.emberMemoryScope ?? buildEmberMemoryScope(supportChannelName(message.provider), conversationKey),
      emberSummary: emberWorking?.emberSummary ?? replyPlan.supportSummary,
      confusionState: confusion.state,
      confusionReason: confusion.reason,
      humanHandoff,
      policyResolution: policy,
      replyDraft: replyPlan.shouldSend ? truncateText(replyPlan.body, 8_000) : null,
      proposalId,
      proposalCapabilityId,
      lastReceivedAt: message.receivedAt,
      updatedAt: nowIso,
      rawSnapshot: {
        conversationKey,
        sourceThreadIds,
        threadDriftFlag,
        subject: truncateText(message.subject, 200),
        senderEmail: message.senderEmail,
        senderName: message.senderName,
        snippet: truncateText(message.snippet, 500),
        policy,
        risk,
        ingest: initialIngest,
        sentReplyMessageId,
        replyDraftedForReview,
        replyDraftReason,
        replayNeedsHumanReview,
        replyLane: replyPlan.lane,
        memberCareState: finalMemberCareState,
        memberCareReason: replyPlan.memberCareReason,
        nextRecommendedAction: replyPlan.nextRecommendedAction,
        supportSummary: replyPlan.supportSummary,
        emberMemoryScope: emberWorking?.emberMemoryScope ?? buildEmberMemoryScope(supportChannelName(message.provider), conversationKey),
        emberSummary: emberWorking?.emberSummary ?? replyPlan.supportSummary,
        confusionState: confusion.state,
        confusionReason: confusion.reason,
        humanHandoff,
        messageCount,
      },
    };

    await this.options.store.saveCaseSnapshot(snapshot);
    if (this.emberMemory?.recordResolved && finalQueueBucket === "resolved") {
      await this.emberMemory.recordResolved({
        channel: supportChannelName(message.provider),
        conversationKey,
        senderEmail: message.senderEmail,
        senderName: message.senderName,
        supportRequestId: initialIngest.supportRequestId,
        supportSummary: replyPlan.supportSummary,
        nextRecommendedAction: replyPlan.nextRecommendedAction,
        confusionState: confusion.state,
        confusionReason: confusion.reason,
        humanHandoff,
        issueType,
        successfulReply: replyPlan.shouldSend ? replyPlan.body : null,
      }).catch((error) => {
        this.options.logger.warn("support_ops_ember_resolved_failed", {
          supportRequestId: initialIngest.supportRequestId,
          conversationKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    await this.options.store.saveMessageRecord({
      provider: message.provider,
      mailbox: message.mailbox,
      messageId: message.messageId,
      threadId: message.threadId,
      supportRequestId: initialIngest.supportRequestId,
      receivedAt: message.receivedAt,
      status: "processed",
      decision: effectiveDisposition.decision,
      riskState: risk.state,
      rawPayload: {
        subject: truncateText(message.subject, 200),
        senderEmail: message.senderEmail,
        conversationKey,
        decision: effectiveDisposition.decision,
        queueBucket: finalQueueBucket,
        proposalId,
        proposalCapabilityId,
        threadDriftFlag,
        memberCareState: finalMemberCareState,
      },
    });

    await this.appendAudit("support_ops.message_processed", "Processed support mailbox message into the support queue.", {
      supportRequestId: initialIngest.supportRequestId,
      conversationKey,
      sourceMessageId: message.messageId,
      sourceThreadId: message.threadId,
      sourceThreadIds,
      decision: effectiveDisposition.decision,
      riskState: risk.state,
      policySlug: policy.policySlug,
      proposalId,
      proposalCapabilityId,
      replySent: shouldSendReply,
      replyDrafted: replyDraftedForReview,
      replyLane: replyPlan.lane,
      replayed: initialIngest.replayed,
      queueBucket: finalQueueBucket,
      memberCareState: finalMemberCareState,
      memberCareReason: replyPlan.memberCareReason,
      threadDriftFlag,
    });

    if (newThreadDriftDetected) {
      await this.appendAudit("support_ops.thread_drift_detected", "Merged support email into an existing conversation despite provider thread drift.", {
        supportRequestId: initialIngest.supportRequestId,
        conversationKey,
        sourceThreadIds,
        sourceMessageId: message.messageId,
      });
      await this.emitLoopSignal({
        loopKey: "support.email.thread-drift",
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        action: "ack",
        note: "Support email conversation merged across multiple provider thread ids.",
        metadata: {
          conversationKey,
          sourceThreadIds,
          policySlug: policy.policySlug,
        },
      });
    }

    if (finalQueueBucket === "security_hold") {
      await this.appendAudit("support_ops.security_hold", "Placed support email into security hold for human review.", {
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        reasons: risk.reasons,
      });
      await this.emitLoopSignal({
        loopKey: "support.email.security-hold",
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        action: "escalate",
        note: "Support email entered security hold and needs human review.",
        metadata: {
          conversationKey,
          reasons: risk.reasons,
          policySlug: policy.policySlug,
        },
      });
    }

    if (proposalCreated) {
      await this.emitLoopSignal({
        loopKey: "support.email.approval-override",
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        action: "ack",
        note: "Support email required an approval-gated exception path.",
        metadata: {
          conversationKey,
          proposalId,
          proposalCapabilityId,
          policySlug: policy.policySlug,
        },
      });
    }

    if (finalMemberCareState === "due" || finalMemberCareState === "staff_follow_up") {
      await this.emitLoopSignal({
        loopKey: "support.email.warm-touch-due",
        supportRequestId: initialIngest.supportRequestId,
        sourceMessageId: message.messageId,
        action: "ack",
        note: "Support case needs a warm-touch follow-up or staff care response.",
        metadata: {
          conversationKey,
          memberCareState: finalMemberCareState,
          memberCareReason: replyPlan.memberCareReason,
          queueBucket: finalQueueBucket,
        },
      });
    }

    return {
      replySent: shouldSendReply,
      replyDrafted: replyDraftedForReview,
      proposalCreated,
    };
  }

  private buildIngestPayload(input: {
    message: SupportMailboxMessage;
    conversationKey: string;
    threadDriftFlag: boolean;
    policy: SupportPolicyResolution;
    risk: SupportRiskAssessment;
    decision: SupportDecision;
    automationState: SupportAutomationState;
    memberCareState: SupportMemberCareState;
    memberCareReason: SupportMemberCareReason | null;
    lastCareTouchAt: string | null;
    careTouchCount: number | null;
    lastOperatorActionAt: string | null;
    nextRecommendedAction: string | null;
    supportSummary: string | null;
    emberMemoryScope: string | null;
    emberSummary: string | null;
    confusionState: SupportCaseSnapshot["confusionState"];
    confusionReason: string | null;
    humanHandoff: boolean;
    replyDraft: string | null;
    proposalId: string | null;
    proposalCapabilityId: string | null;
  }): SupportEmailIngestPayload {
    return {
      uid: input.risk.senderVerifiedUid,
      subject: truncateText(input.message.subject, 200),
      body: truncateText(input.message.bodyText || input.message.snippet || "(no message body)", 12_000),
      category: truncateText(input.policy.policySlug ?? "email-support", 80),
      status: "new",
      urgency: "non-urgent",
      displayName: truncateText(input.message.senderName, 200) || null,
      email: truncateText(input.message.senderEmail, 320) || null,
      senderEmail: truncateText(input.message.senderEmail, 320) || null,
      senderVerifiedUid: input.risk.senderVerifiedUid,
      sourceProvider: input.message.provider,
      conversationKey: truncateText(input.conversationKey, 240),
      sourceThreadId: truncateText(input.message.threadId, 240),
      sourceMessageId: truncateText(input.message.messageId, 240) || null,
      latestSourceMessageId: truncateText(input.message.messageId, 240) || null,
      threadDriftFlag: input.threadDriftFlag,
      memberVisibleThreadId: truncateText(input.message.threadId, 240) || null,
      riskState: input.risk.state,
      riskReasons: input.risk.reasons.slice(0, 20).map((entry) => truncateText(entry, 240)),
      decision: input.decision,
      automationState: input.automationState,
      memberCareState: input.memberCareState,
      memberCareReason: input.memberCareReason,
      lastCareTouchAt: input.lastCareTouchAt,
      careTouchCount: input.careTouchCount,
      lastOperatorActionAt: input.lastOperatorActionAt,
      nextRecommendedAction: input.nextRecommendedAction ? truncateText(input.nextRecommendedAction, 320) : null,
      supportSummary: input.supportSummary ? truncateText(input.supportSummary, 600) : null,
      emberMemoryScope: input.emberMemoryScope ? truncateText(input.emberMemoryScope, 320) : null,
      emberSummary: input.emberSummary ? truncateText(input.emberSummary, 600) : null,
      confusionState: input.confusionState,
      confusionReason: input.confusionReason ? truncateText(input.confusionReason, 160) : null,
      humanHandoff: input.humanHandoff,
      latestInboundSubject: truncateText(input.message.subject, 200),
      latestInboundBody: truncateText(input.message.bodyText || input.message.snippet, 12_000) || null,
      replyDraft: input.replyDraft ? truncateText(input.replyDraft, 8_000) : null,
      proposalId: input.proposalId,
      proposalCapabilityId: input.proposalCapabilityId,
      policyResolution: {
        resolvedPolicySlug: input.policy.policySlug,
        resolvedPolicyVersion: input.policy.policyVersion,
        discrepancyFlag: input.policy.discrepancyFlag,
        escalationReason: input.policy.escalationReason,
        intentId: input.policy.intentId,
        requiredSignals: input.policy.requiredSignals,
        missingSignals: input.policy.missingSignals,
        allowedLowRiskActions: input.policy.allowedLowRiskActions,
        blockedActions: input.policy.blockedActions,
        matchedTerms: input.policy.matchedTerms,
        replyTemplate: input.policy.replyTemplate,
        difficultProcessGuidance: input.policy.difficultProcessGuidance,
        practiceEvidenceIds: input.policy.practiceEvidenceIds,
        warmTouchPlaybook: input.policy.warmTouchPlaybook,
      },
    };
  }

  private async createProposal(input: {
    supportRequestId: string;
    message: SupportMailboxMessage;
    policy: SupportPolicyResolution;
    plan: SupportProposalPlan;
    ownerUid: string;
  }): Promise<{ proposalId: string | null; proposalCapabilityId: string | null; created: boolean }> {
    const requestInput = {
      tenantId: this.options.tenantId,
      supportRequestId: input.supportRequestId,
      sourceThreadId: input.message.threadId,
      sourceMessageId: input.message.messageId,
      senderEmail: input.message.senderEmail,
      policySlug: input.policy.policySlug,
      idempotencyKey: stableHashDeep({
        supportRequestId: input.supportRequestId,
        sourceThreadId: input.message.threadId,
        sourceMessageId: input.message.messageId,
        capabilityId: input.plan.capabilityId,
      }).slice(0, 32),
    };
    const created = await this.options.capabilityRuntime.create(
      {
        actorType: "system",
        actorId: "studio-brain",
        ownerUid: input.ownerUid,
        tenantId: this.options.tenantId,
        effectiveScopes: ["capability:*:execute"],
      },
      {
        capabilityId: input.plan.capabilityId,
        rationale: input.plan.rationale,
        previewSummary: input.plan.previewSummary,
        requestInput,
        expectedEffects: input.plan.expectedEffects,
        requestedBy: input.ownerUid,
      }
    );
    const proposalId = created.proposal?.id ?? null;
    const proposalCapabilityId = created.proposal?.capabilityId ?? input.plan.capabilityId;
    if (proposalId) {
      await this.appendAudit("support_ops.proposal_created", "Created approval-gated support proposal.", {
        supportRequestId: input.supportRequestId,
        sourceMessageId: input.message.messageId,
        proposalId,
        proposalCapabilityId,
      });
    }
    return {
      proposalId,
      proposalCapabilityId,
      created: Boolean(proposalId),
    };
  }

  private async defaultIngestSupportRequest(payload: SupportEmailIngestPayload): Promise<SupportCaseIngestResult> {
    const ingestBearerToken = await this.resolveIngestBearerToken();
    const response = await fetch(`${this.functionsBaseUrl}/${this.ingestRoute}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ingestBearerToken}`,
        ...(this.ingestAdminToken ? { "x-admin-token": this.ingestAdminToken } : {}),
      },
      body: JSON.stringify(payload),
    });
    const rawText = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      parsed = { message: rawText };
    }
    if (!response.ok || parsed.ok !== true) {
      const message = typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : `Support ingest failed (${response.status}).`;
      throw new Error(message);
    }
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
    const supportRequestId = typeof data.supportRequestId === "string" ? data.supportRequestId : "";
    if (!supportRequestId) {
      throw new Error("Support ingest response did not include supportRequestId.");
    }
    return {
      supportRequestId,
      created: data.created === true,
      matchedExisting: data.matchedExisting === true,
      replayed: data.replayed === true,
    };
  }

  private async emitLoopSignal(input: {
    loopKey: string;
    supportRequestId?: string | null;
    sourceMessageId?: string | null;
    action: "ack" | "escalate";
    note: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.recordLoopSignal) return;
    try {
      await this.recordLoopSignal(input);
    } catch (error) {
      this.options.logger.warn("support_ops_loop_signal_failed", {
        loopKey: input.loopKey,
        supportRequestId: input.supportRequestId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async appendAudit(
    action: string,
    rationale: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.options.eventStore.append({
      actorType: "system",
      actorId: "studio-brain",
      action,
      rationale,
      target: "local",
      approvalState: "exempt",
      inputHash: stableHashDeep(metadata),
      outputHash: null,
      metadata,
    });
  }
}
