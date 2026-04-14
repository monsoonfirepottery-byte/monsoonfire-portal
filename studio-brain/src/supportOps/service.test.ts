import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRuntime, defaultCapabilities } from "../capabilities/runtime";
import type { EventStore } from "../stores/interfaces";
import { SupportOpsService, decideSupportAction } from "./service";
import type {
  SupportCaseSnapshot,
  SupportDeadLetter,
  SupportMailboxMessage,
  SupportMailboxReader,
  SupportReplySender,
  SupportMailboxSyncResult,
  SupportMailboxSyncState,
  SupportMessageRecord,
  SupportPolicyResolution,
  SupportProvider,
  SupportQueueSummary,
  SupportRiskAssessment,
} from "./types";
import type { SupportOpsStore } from "./store";

class MemoryEventStore implements EventStore {
  readonly rows: Array<Parameters<EventStore["append"]>[0] & { id: string; at: string }> = [];

  async append(event: Parameters<EventStore["append"]>[0]) {
    const row = {
      ...event,
      id: `audit-${this.rows.length + 1}`,
      at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async listRecent(limit: number) {
    return this.rows.slice(-Math.max(1, limit)).reverse();
  }
}

class MemorySupportOpsStore implements SupportOpsStore {
  mailboxState: SupportMailboxSyncState | null = null;
  readonly processedMessageIds = new Set<string>();
  readonly messageRecords = new Map<string, SupportMessageRecord>();
  readonly caseSnapshots = new Map<string, SupportCaseSnapshot>();
  readonly deadLetters: SupportDeadLetter[] = [];

  async getMailboxState(provider: SupportProvider, mailbox: string) {
    if (!this.mailboxState) return null;
    if (this.mailboxState.provider !== provider || this.mailboxState.mailbox !== mailbox) return null;
    return this.mailboxState;
  }

  async saveMailboxState(state: SupportMailboxSyncState) {
    this.mailboxState = state;
  }

  async hasProcessedMessage(_provider: SupportProvider, messageId: string) {
    return this.processedMessageIds.has(messageId);
  }

  async saveMessageRecord(record: SupportMessageRecord) {
    this.messageRecords.set(record.messageId, record);
    if (record.status === "processed") {
      this.processedMessageIds.add(record.messageId);
    }
  }

  async getCaseSnapshot(supportRequestId: string) {
    return this.caseSnapshots.get(supportRequestId) ?? null;
  }

  async saveCaseSnapshot(snapshot: SupportCaseSnapshot) {
    this.caseSnapshots.set(snapshot.supportRequestId, snapshot);
  }

  async listRecentCases(limit: number) {
    return [...this.caseSnapshots.values()].slice(0, Math.max(1, limit));
  }

  async getQueueSummary(): Promise<SupportQueueSummary> {
    return {
      unread: 0,
      awaitingInfo: 0,
      awaitingApproval: 0,
      securityHold: 0,
      staffReview: 0,
      warmTouchesDue: 0,
      splitThreadSuspects: 0,
      totalOpen: this.caseSnapshots.size,
      oldestOpenAt: null,
      slaAging: {
        fresh: this.caseSnapshots.size,
        warning: 0,
        overdue: 0,
      },
    };
  }

  async addDeadLetter(input: {
    provider: SupportProvider;
    mailbox: string;
    messageId: string | null;
    errorMessage: string;
    rawPayload: Record<string, unknown>;
    attemptCount?: number;
  }) {
    const row: SupportDeadLetter = {
      id: `dead-${this.deadLetters.length + 1}`,
      provider: input.provider,
      mailbox: input.mailbox,
      messageId: input.messageId,
      errorMessage: input.errorMessage,
      attemptCount: input.attemptCount ?? 1,
      rawPayload: input.rawPayload,
      createdAt: new Date().toISOString(),
    };
    this.deadLetters.push(row);
    return row;
  }

  async listDeadLetters(limit: number) {
    return this.deadLetters.slice(0, Math.max(1, limit));
  }
}

class MemoryMailboxReader implements SupportMailboxReader {
  constructor(private readonly messages: SupportMailboxMessage[]) {}

  async listMessages(): Promise<SupportMailboxSyncResult> {
    return {
      messages: this.messages,
      nextCursor: "cursor-1",
      latestCursor: "cursor-1",
    };
  }
}

class MemoryReplySender implements SupportReplySender {
  readonly replies: Array<{
    to: string;
    subject: string;
    body: string;
    inReplyTo: string | null;
    references: string[];
  }> = [];

  async sendReply(input: {
    mailbox: string;
    threadId: string;
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
    references?: string[];
  }) {
    this.replies.push({
      to: input.to,
      subject: input.subject,
      body: input.body,
      inReplyTo: input.inReplyTo ?? null,
      references: [...(input.references ?? [])],
    });
    return { messageId: `reply-${this.replies.length}` };
  }
}

function buildMessage(overrides: Partial<SupportMailboxMessage> = {}): SupportMailboxMessage {
  return {
    provider: "gmail",
    mailbox: "support@monsoonfire.com",
    messageId: "gmail-message-1",
    rfcMessageId: "<message-1@member.example.com>",
    threadId: "gmail-thread-1",
    historyId: "1001",
    subject: "Kiln timing question",
    snippet: "Need a current estimate",
    bodyText: "What is the current timing for my firing batch?",
    senderEmail: "member@example.com",
    senderName: "Member",
    receivedAt: "2026-04-12T17:00:00.000Z",
    references: [],
    inReplyTo: null,
    attachments: [],
    linkDomains: [],
    labels: ["INBOX"],
    rawHeaders: {},
    ...overrides,
  };
}

function buildPolicy(overrides: Partial<SupportPolicyResolution> = {}): SupportPolicyResolution {
  return {
    intentId: "support.policy.firing-scheduling",
    policySlug: "firing-scheduling",
    policyVersion: "2026-04-02",
    discrepancyFlag: false,
    escalationReason: null,
    matchedTerms: ["firing", "timing"],
    requiredSignals: [],
    missingSignals: [],
    allowedLowRiskActions: ["share current estimate bands and queue-based timing"],
    blockedActions: [],
    replyTemplate: "Provide the current estimate band and note when staff confirmation is required.",
    difficultProcessGuidance: [],
    practiceEvidenceIds: [],
    practiceEvidence: [],
    warmTouchPlaybook: {
      tone: "Warm and steady.",
      acknowledge: "Thanks for the update and for staying flexible.",
      boundary: "Pickup timing can shift and same-day pickup is not guaranteed until staff confirms it.",
      nextStep: "We’ll confirm the next safe step in this same thread.",
      triggers: ["pickup coordination", "clarification"],
    },
    ...overrides,
  };
}

function buildRisk(overrides: Partial<SupportRiskAssessment> = {}): SupportRiskAssessment {
  return {
    state: "clear",
    reasons: [],
    senderVerifiedUid: "user_123",
    senderMatchedAccount: true,
    forwarded: false,
    suspiciousLinks: [],
    suspiciousAttachments: [],
    blockedActionRequested: false,
    accessSecretRequested: false,
    manualOverrideLanguage: false,
    ...overrides,
  };
}

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test("decideSupportAction escalates verified refund requests into approval-gated proposals", () => {
  const decision = decideSupportAction({
    message: buildMessage({ subject: "Refund request", bodyText: "Please refund this charge." }),
    policy: buildPolicy({
      policySlug: "payments-refunds",
      blockedActions: ["issue refunds or credits directly"],
    }),
    risk: buildRisk({
      blockedActionRequested: true,
    }),
  });

  assert.equal(decision.decision, "proposal_required");
  assert.equal(decision.queueBucket, "awaiting_approval");
  assert.equal(decision.proposalCapabilityId, "support.billing.adjustment");
});

test("decideSupportAction places forwarded access-secret requests into security hold", () => {
  const decision = decideSupportAction({
    message: buildMessage({ subject: "FW: need the gate code", bodyText: "Forwarded message asking for the gate code." }),
    policy: buildPolicy({
      policySlug: "studio-access",
      blockedActions: ["share door codes outside the approved path"],
    }),
    risk: buildRisk({
      state: "high_risk",
      senderVerifiedUid: null,
      senderMatchedAccount: false,
      forwarded: true,
      blockedActionRequested: true,
      accessSecretRequested: true,
      reasons: ["forwarded_or_third_party_context", "access_secret_requested"],
    }),
  });

  assert.equal(decision.decision, "security_hold");
  assert.equal(decision.queueBucket, "security_hold");
  assert.equal(decision.proposalCapabilityId, null);
});

test("SupportOpsService auto-replies once and skips replayed local messages on later syncs", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([buildMessage()]);
  const replySender = new MemoryReplySender();
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);
  const ingestCalls: string[] = [];

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender,
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () => buildPolicy(),
    riskAssessor: async () => buildRisk(),
    ingestSupportRequest: async () => {
      ingestCalls.push("ingest");
      return {
        supportRequestId: "support-1",
        created: ingestCalls.length === 1,
        matchedExisting: ingestCalls.length > 1,
        replayed: false,
      };
    },
  });

  const first = await service.syncMailbox();
  const second = await service.syncMailbox();

  assert.equal(first.processed, 1);
  assert.equal(first.repliesSent, 1);
  assert.equal(first.replyDrafts, 0);
  assert.equal(second.skipped, 1);
  assert.equal(replySender.replies.length, 1);
  assert.equal(replySender.replies[0]?.inReplyTo, "<message-1@member.example.com>");
  assert.deepEqual(replySender.replies[0]?.references, ["<message-1@member.example.com>"]);
  assert.equal(store.caseSnapshots.get("support-1")?.queueBucket, "resolved");
  assert.equal(store.messageRecords.get("gmail-message-1")?.status, "processed");
});

test("SupportOpsService creates approval proposals without sending automatic replies for blocked writes", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([
    buildMessage({
      subject: "Need a refund",
      bodyText: "Please refund this membership charge.",
      messageId: "gmail-message-2",
      threadId: "gmail-thread-2",
    }),
  ]);
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender: new MemoryReplySender(),
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () =>
      buildPolicy({
        policySlug: "payments-refunds",
        blockedActions: ["issue refunds or credits directly"],
      }),
    riskAssessor: async () =>
      buildRisk({
        blockedActionRequested: true,
      }),
    ingestSupportRequest: async () => ({
      supportRequestId: "support-2",
      created: true,
      matchedExisting: false,
      replayed: false,
    }),
  });

  const report = await service.syncMailbox();
  const proposals = await capabilityRuntime.listProposals(10);

  assert.equal(report.proposalsCreated, 1);
  assert.equal(report.repliesSent, 0);
  assert.equal(report.replyDrafts, 0);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.capabilityId, "support.billing.adjustment");
  assert.equal(store.caseSnapshots.get("support-2")?.queueBucket, "awaiting_approval");
});

test("SupportOpsService drafts policy-safe replies when reply delivery is disabled", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([
    buildMessage({
      subject: "Status update",
      bodyText: "Can you share the current firing estimate?",
      messageId: "gmail-message-3",
      threadId: "gmail-thread-3",
    }),
  ]);
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender: null,
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () => buildPolicy(),
    riskAssessor: async () => buildRisk(),
    ingestSupportRequest: async () => ({
      supportRequestId: "support-3",
      created: true,
      matchedExisting: false,
      replayed: false,
    }),
  });

  const report = await service.syncMailbox();
  const snapshot = store.caseSnapshots.get("support-3");

  assert.equal(report.processed, 1);
  assert.equal(report.repliesSent, 0);
  assert.equal(report.replyDrafts, 1);
  assert.equal(snapshot?.queueBucket, "staff_review");
  assert.equal(snapshot?.automationState, "staff_review");
  assert.match(snapshot?.replyDraft ?? "", /Monsoon Fire support case support-3/i);
  assert.equal(audit.rows.some((row) => row.action === "support_ops.reply_drafted"), true);
});

test("SupportOpsService preserves existing reference chains when sending replies", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([
    buildMessage({
      messageId: "gmail-message-4",
      rfcMessageId: "<message-4@member.example.com>",
      threadId: "gmail-thread-4",
      references: ["<root@member.example.com>", "<previous@member.example.com>"],
    }),
  ]);
  const replySender = new MemoryReplySender();
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender,
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () => buildPolicy(),
    riskAssessor: async () => buildRisk(),
    ingestSupportRequest: async () => ({
      supportRequestId: "support-4",
      created: true,
      matchedExisting: false,
      replayed: false,
    }),
  });

  await service.syncMailbox();

  assert.equal(replySender.replies[0]?.inReplyTo, "<message-4@member.example.com>");
  assert.deepEqual(replySender.replies[0]?.references, [
    "<root@member.example.com>",
    "<previous@member.example.com>",
    "<message-4@member.example.com>",
  ]);
});

test("SupportOpsService sends courtesy-safe warm replies for low-risk unverified pickup coordination", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([
    buildMessage({
      provider: "namecheap_private_email",
      messageId: "mail-5",
      threadId: "thread-5",
      senderEmail: "bweil9902@yahoo.com",
      senderName: "Betsy",
      subject: "Re: Any chance?",
      bodyText: "Sorry, could I do 8 PM instead or porch drop-off if that is easier?",
    }),
  ]);
  const replySender = new MemoryReplySender();
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender,
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    provider: "namecheap_private_email",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () => buildPolicy(),
    riskAssessor: async () =>
      buildRisk({
        state: "possible_security_risk",
        reasons: ["sender_unverified"],
        senderVerifiedUid: null,
        senderMatchedAccount: false,
      }),
    ingestSupportRequest: async () => ({
      supportRequestId: "support-5",
      created: true,
      matchedExisting: false,
      replayed: false,
    }),
  });

  const report = await service.syncMailbox();
  const snapshot = store.caseSnapshots.get("support-5");

  assert.equal(report.repliesSent, 1);
  assert.equal(report.replyDrafts, 0);
  assert.equal(snapshot?.queueBucket, "staff_review");
  assert.equal(snapshot?.memberCareState, "sent");
  assert.equal(snapshot?.memberCareReason, "pickup_coordination");
  assert.equal(snapshot?.threadDriftFlag, false);
  assert.match(replySender.replies[0]?.body ?? "", /Thanks for the update/i);
  assert.match(replySender.replies[0]?.body ?? "", /same-day pickup is not guaranteed/i);
  assert.match(replySender.replies[0]?.body ?? "", /Ember/);
});

test("SupportOpsService keeps Betsy-style thread drift on one case with one evolving summary", async () => {
  const store = new MemorySupportOpsStore();
  const mailboxReader = new MemoryMailboxReader([
    buildMessage({
      provider: "namecheap_private_email",
      messageId: "mail-6a",
      threadId: "thread-a",
      senderEmail: "bweil9902@yahoo.com",
      senderName: "Betsy Weil",
      subject: "Re: Any chance?",
      bodyText: "Could I come by Wednesday around 11?",
      receivedAt: "2026-04-13T14:01:00.000Z",
    }),
    buildMessage({
      provider: "namecheap_private_email",
      messageId: "mail-6b",
      threadId: "thread-b",
      senderEmail: "bweil9902@yahoo.com",
      senderName: "Betsy Weil",
      subject: "Re: Any chance?",
      bodyText: "Actually I booked 2 to 3 PM and should arrive around 2:30.",
      receivedAt: "2026-04-13T14:54:00.000Z",
    }),
    buildMessage({
      provider: "namecheap_private_email",
      messageId: "mail-6c",
      threadId: "thread-c",
      senderEmail: "bweil9902@yahoo.com",
      senderName: "Betsy Weil",
      subject: "Re: Any chance?",
      bodyText: "Would 8 PM tonight work, or porch drop-off? I think there are four pieces.",
      receivedAt: "2026-04-13T15:10:00.000Z",
    }),
  ]);
  const replySender = new MemoryReplySender();
  const audit = new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, audit);
  const supportRequestByConversation = new Map<string, string>();

  const service = new SupportOpsService({
    logger,
    store,
    mailboxReader,
    replySender,
    capabilityRuntime,
    eventStore: audit,
    mailbox: "support@monsoonfire.com",
    provider: "namecheap_private_email",
    tenantId: "monsoonfire-main",
    maxMessages: 10,
    policyResolver: () => buildPolicy(),
    riskAssessor: async () =>
      buildRisk({
        state: "possible_security_risk",
        reasons: ["sender_unverified"],
        senderVerifiedUid: null,
        senderMatchedAccount: false,
      }),
    ingestSupportRequest: async (payload) => {
      const conversationKey = String(payload.conversationKey ?? "");
      const supportRequestId = supportRequestByConversation.get(conversationKey) ?? "support-betsy";
      supportRequestByConversation.set(conversationKey, supportRequestId);
      return {
        supportRequestId,
        created: payload.sourceMessageId === "mail-6a",
        matchedExisting: payload.sourceMessageId !== "mail-6a",
        replayed: false,
      };
    },
  });

  const report = await service.syncMailbox();
  const snapshot = store.caseSnapshots.get("support-betsy");

  assert.equal(report.processed, 3);
  assert.equal(store.caseSnapshots.size, 1);
  assert.equal(snapshot?.conversationKey.length ? true : false, true);
  assert.equal(snapshot?.threadDriftFlag, true);
  assert.deepEqual(snapshot?.sourceThreadIds, ["thread-a", "thread-b", "thread-c"]);
  assert.match(snapshot?.supportSummary ?? "", /8 PM tonight/i);
  assert.equal(snapshot?.memberCareReason, "pickup_coordination");
  assert.equal(snapshot?.careTouchCount, 1);
  assert.equal(replySender.replies.length, 1);
  assert.equal(audit.rows.some((row) => row.action === "support_ops.thread_drift_detected"), true);
});
