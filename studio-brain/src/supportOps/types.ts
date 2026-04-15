export type SupportDecision =
  | "auto_reply"
  | "ask_missing_info"
  | "staff_review"
  | "proposal_required"
  | "security_hold";

export type SupportRiskState = "clear" | "possible_security_risk" | "high_risk";

export type SupportMemberCareState = "none" | "due" | "drafted" | "sent" | "staff_follow_up";

export type SupportMemberCareReason =
  | "pickup_coordination"
  | "delay_reassurance"
  | "apology"
  | "gratitude"
  | "clarification";

export type SupportConfusionState =
  | "none"
  | "apologetic"
  | "uncertain"
  | "frustrated"
  | "grateful"
  | "overwhelmed";

export type SupportAutomationState =
  | "pending"
  | "auto_replied"
  | "awaiting_info"
  | "staff_review"
  | "proposal_created"
  | "security_hold"
  | "dead_letter";

export type SupportQueueBucket =
  | "unread"
  | "awaiting_info"
  | "awaiting_approval"
  | "security_hold"
  | "staff_review"
  | "resolved";

export type SupportProvider = "gmail" | "namecheap_private_email" | (string & {});

export type SupportMailboxAttachment = {
  filename: string;
  mimeType: string;
  size: number | null;
};

export type SupportWarmTouchPlaybook = {
  tone: string | null;
  acknowledge: string | null;
  boundary: string | null;
  nextStep: string | null;
  triggers: string[];
};

export type SupportMailboxMessage = {
  provider: SupportProvider;
  mailbox: string;
  messageId: string;
  rfcMessageId: string | null;
  threadId: string;
  historyId: string | null;
  subject: string;
  snippet: string;
  bodyText: string;
  senderEmail: string | null;
  senderName: string | null;
  receivedAt: string;
  references: string[];
  inReplyTo: string | null;
  attachments: SupportMailboxAttachment[];
  linkDomains: string[];
  labels: string[];
  rawHeaders: Record<string, string>;
};

export type SupportPolicyResolution = {
  intentId: string | null;
  policySlug: string | null;
  policyVersion: string | null;
  discrepancyFlag: boolean;
  escalationReason: string | null;
  matchedTerms: string[];
  requiredSignals: string[];
  missingSignals: string[];
  allowedLowRiskActions: string[];
  blockedActions: string[];
  replyTemplate: string | null;
  difficultProcessGuidance: string[];
  practiceEvidenceIds: string[];
  practiceEvidence: string[];
  warmTouchPlaybook: SupportWarmTouchPlaybook | null;
};

export type SupportRiskAssessment = {
  state: SupportRiskState;
  reasons: string[];
  senderVerifiedUid: string | null;
  senderMatchedAccount: boolean;
  forwarded: boolean;
  suspiciousLinks: string[];
  suspiciousAttachments: string[];
  blockedActionRequested: boolean;
  accessSecretRequested: boolean;
  manualOverrideLanguage: boolean;
};

export type SupportReplyPlan = {
  shouldSend: boolean;
  subject: string;
  body: string;
  lane: "policy_safe" | "courtesy_safe" | "none";
  memberCareState: SupportMemberCareState;
  memberCareReason: SupportMemberCareReason | null;
  nextRecommendedAction: string;
  supportSummary: string;
};

export type SupportProposalPlan = {
  capabilityId: string;
  rationale: string;
  previewSummary: string;
  expectedEffects: string[];
};

export type SupportCaseSnapshot = {
  supportRequestId: string;
  provider: SupportProvider;
  mailbox: string;
  conversationKey: string;
  sourceThreadId: string;
  sourceThreadIds: string[];
  sourceMessageId: string | null;
  latestSourceMessageId: string | null;
  threadDriftFlag: boolean;
  senderEmail: string | null;
  senderVerifiedUid: string | null;
  subject: string;
  decision: SupportDecision;
  riskState: SupportRiskState;
  riskReasons: string[];
  automationState: SupportAutomationState;
  queueBucket: SupportQueueBucket;
  unread: boolean;
  memberCareState: SupportMemberCareState;
  memberCareReason: SupportMemberCareReason | null;
  lastCareTouchAt: string | null;
  careTouchCount: number;
  lastOperatorActionAt: string | null;
  nextRecommendedAction: string | null;
  supportSummary: string | null;
  emberMemoryScope: string | null;
  emberSummary: string | null;
  confusionState: SupportConfusionState;
  confusionReason: string | null;
  humanHandoff: boolean;
  linkedMemoryReviewCaseIds?: string[];
  policyResolution: SupportPolicyResolution;
  replyDraft: string | null;
  proposalId: string | null;
  proposalCapabilityId: string | null;
  lastReceivedAt: string;
  updatedAt: string;
  rawSnapshot: Record<string, unknown>;
};

export type SupportMailboxSyncState = {
  provider: SupportProvider;
  mailbox: string;
  historyCursor: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  backoffUntil: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
};

export type SupportDeadLetter = {
  id: string;
  provider: SupportProvider;
  mailbox: string;
  messageId: string | null;
  errorMessage: string;
  attemptCount: number;
  rawPayload: Record<string, unknown>;
  createdAt: string;
};

export type SupportQueueSummary = {
  unread: number;
  awaitingInfo: number;
  awaitingApproval: number;
  securityHold: number;
  staffReview: number;
  warmTouchesDue: number;
  splitThreadSuspects: number;
  totalOpen: number;
  oldestOpenAt: string | null;
  slaAging: {
    fresh: number;
    warning: number;
    overdue: number;
  };
};

export type SupportMessageRecord = {
  provider: SupportProvider;
  mailbox: string;
  messageId: string;
  threadId: string;
  supportRequestId: string | null;
  receivedAt: string;
  status: "received" | "processed" | "dead_letter";
  decision: SupportDecision | null;
  riskState: SupportRiskState | null;
  rawPayload: Record<string, unknown>;
};

export type SupportMailboxSyncResult = {
  messages: SupportMailboxMessage[];
  nextCursor: string | null;
  latestCursor: string | null;
};

export interface SupportMailboxReader {
  listMessages(input: {
    mailbox: string;
    cursor: string | null;
    maxMessages: number;
    query?: string;
    labelIds?: string[];
  }): Promise<SupportMailboxSyncResult>;
}

export interface SupportReplySender {
  sendReply(input: {
    mailbox: string;
    threadId: string;
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
    references?: string[];
  }): Promise<{ messageId: string | null }>;
}

export interface SupportMailboxAdapter extends SupportMailboxReader, SupportReplySender {}
