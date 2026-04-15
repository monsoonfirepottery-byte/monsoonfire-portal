import crypto from "node:crypto";
import { getPgPool } from "../db/postgres";
import type {
  SupportCaseSnapshot,
  SupportDeadLetter,
  SupportMemberCareReason,
  SupportMemberCareState,
  SupportMailboxSyncState,
  SupportMessageRecord,
  SupportProvider,
  SupportQueueSummary,
} from "./types";

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  return fallback;
}

function hydrateCaseSnapshot(row: Record<string, unknown>): SupportCaseSnapshot {
  const rawSnapshot = toJsonObject(row.raw_snapshot);
  const nestedRawSnapshot = toJsonObject(rawSnapshot.rawSnapshot);
  const sourceThreadIds = toStringArray(rawSnapshot.sourceThreadIds);
  const conversationKey =
    toNullableString(rawSnapshot.conversationKey)
    ?? toNullableString(row.conversation_key)
    ?? toNullableString(row.source_thread_id)
    ?? "support-conversation";

  return {
    supportRequestId: String(row.support_request_id ?? rawSnapshot.supportRequestId ?? ""),
    provider: String(row.source_provider ?? rawSnapshot.provider ?? "gmail") as SupportProvider,
    mailbox: String(row.mailbox ?? rawSnapshot.mailbox ?? ""),
    conversationKey,
    sourceThreadId: String(row.source_thread_id ?? rawSnapshot.sourceThreadId ?? ""),
    sourceThreadIds:
      sourceThreadIds.length > 0
        ? sourceThreadIds
        : [String(row.source_thread_id ?? rawSnapshot.sourceThreadId ?? "")].filter(Boolean),
    sourceMessageId: toNullableString(row.source_message_id ?? rawSnapshot.sourceMessageId),
    latestSourceMessageId: toNullableString(row.latest_source_message_id ?? rawSnapshot.latestSourceMessageId),
    threadDriftFlag: toBoolean(row.thread_drift_flag ?? rawSnapshot.threadDriftFlag, false),
    senderEmail: toNullableString(row.sender_email ?? rawSnapshot.senderEmail),
    senderVerifiedUid: toNullableString(row.sender_verified_uid ?? rawSnapshot.senderVerifiedUid),
    subject: String(rawSnapshot.subject ?? ""),
    decision: String(row.decision ?? rawSnapshot.decision ?? "staff_review") as SupportCaseSnapshot["decision"],
    riskState: String(row.risk_state ?? rawSnapshot.riskState ?? "possible_security_risk") as SupportCaseSnapshot["riskState"],
    riskReasons: toStringArray(rawSnapshot.riskReasons),
    automationState: String(
      row.automation_state ?? rawSnapshot.automationState ?? "staff_review"
    ) as SupportCaseSnapshot["automationState"],
    queueBucket: String(row.queue_bucket ?? rawSnapshot.queueBucket ?? "staff_review") as SupportCaseSnapshot["queueBucket"],
    unread: toBoolean(row.unread ?? rawSnapshot.unread, true),
    memberCareState: String(
      row.member_care_state ?? rawSnapshot.memberCareState ?? "none"
    ) as SupportMemberCareState,
    memberCareReason: toNullableString(
      row.member_care_reason ?? rawSnapshot.memberCareReason
    ) as SupportMemberCareReason | null,
    lastCareTouchAt: toNullableString(row.last_care_touch_at ?? rawSnapshot.lastCareTouchAt),
    careTouchCount: toInteger(row.care_touch_count ?? rawSnapshot.careTouchCount, 0),
    lastOperatorActionAt: toNullableString(
      row.last_operator_action_at ?? rawSnapshot.lastOperatorActionAt
    ),
    nextRecommendedAction: toNullableString(
      row.next_recommended_action ?? rawSnapshot.nextRecommendedAction
    ),
    supportSummary: toNullableString(row.support_summary ?? rawSnapshot.supportSummary),
    emberMemoryScope: toNullableString(row.ember_memory_scope ?? rawSnapshot.emberMemoryScope),
    emberSummary: toNullableString(row.ember_summary ?? rawSnapshot.emberSummary),
    confusionState: String(
      row.confusion_state ?? rawSnapshot.confusionState ?? "none"
    ) as SupportCaseSnapshot["confusionState"],
    confusionReason: toNullableString(row.confusion_reason ?? rawSnapshot.confusionReason),
    humanHandoff: toBoolean(row.human_handoff ?? rawSnapshot.humanHandoff, false),
    linkedMemoryReviewCaseIds: toStringArray(rawSnapshot.linkedMemoryReviewCaseIds),
    policyResolution:
      (rawSnapshot.policyResolution && typeof rawSnapshot.policyResolution === "object"
        ? rawSnapshot.policyResolution
        : {}) as SupportCaseSnapshot["policyResolution"],
    replyDraft: toNullableString(row.reply_draft ?? rawSnapshot.replyDraft),
    proposalId: toNullableString(row.proposal_id ?? rawSnapshot.proposalId),
    proposalCapabilityId: toNullableString(
      row.proposal_capability_id ?? rawSnapshot.proposalCapabilityId
    ),
    lastReceivedAt: toIso(row.last_received_at ?? rawSnapshot.lastReceivedAt ?? new Date().toISOString()),
    updatedAt: toIso(row.updated_at ?? rawSnapshot.updatedAt ?? new Date().toISOString()),
    rawSnapshot: Object.keys(nestedRawSnapshot).length > 0 ? nestedRawSnapshot : rawSnapshot,
  };
}

export interface SupportOpsStore {
  getMailboxState(provider: SupportProvider, mailbox: string): Promise<SupportMailboxSyncState | null>;
  saveMailboxState(state: SupportMailboxSyncState): Promise<void>;
  hasProcessedMessage(provider: SupportProvider, messageId: string): Promise<boolean>;
  saveMessageRecord(record: SupportMessageRecord): Promise<void>;
  getCaseSnapshot(supportRequestId: string): Promise<SupportCaseSnapshot | null>;
  saveCaseSnapshot(snapshot: SupportCaseSnapshot): Promise<void>;
  listRecentCases(limit: number): Promise<SupportCaseSnapshot[]>;
  getQueueSummary(): Promise<SupportQueueSummary>;
  addDeadLetter(input: {
    provider: SupportProvider;
    mailbox: string;
    messageId: string | null;
    errorMessage: string;
    rawPayload: Record<string, unknown>;
    attemptCount?: number;
  }): Promise<SupportDeadLetter>;
  listDeadLetters(limit: number): Promise<SupportDeadLetter[]>;
}

export class PostgresSupportOpsStore implements SupportOpsStore {
  async getMailboxState(provider: SupportProvider, mailbox: string): Promise<SupportMailboxSyncState | null> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT provider, mailbox, history_cursor, last_sync_at, last_success_at, consecutive_failures, backoff_until, last_error, metadata
       FROM brain_support_mailbox_state
       WHERE provider = $1 AND mailbox = $2`,
      [provider, mailbox]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0] as Record<string, unknown>;
    return {
      provider: String(row.provider ?? provider) as SupportProvider,
      mailbox: String(row.mailbox ?? mailbox),
      historyCursor: row.history_cursor ? String(row.history_cursor) : null,
      lastSyncAt: row.last_sync_at ? toIso(row.last_sync_at) : null,
      lastSuccessAt: row.last_success_at ? toIso(row.last_success_at) : null,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      backoffUntil: row.backoff_until ? toIso(row.backoff_until) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      metadata: toJsonObject(row.metadata),
    };
  }

  async saveMailboxState(state: SupportMailboxSyncState): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_support_mailbox_state
       (provider, mailbox, history_cursor, last_sync_at, last_success_at, consecutive_failures, backoff_until, last_error, metadata)
       VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7::timestamptz,$8,$9::jsonb)
       ON CONFLICT (provider, mailbox) DO UPDATE SET
         history_cursor = EXCLUDED.history_cursor,
         last_sync_at = EXCLUDED.last_sync_at,
         last_success_at = EXCLUDED.last_success_at,
         consecutive_failures = EXCLUDED.consecutive_failures,
         backoff_until = EXCLUDED.backoff_until,
         last_error = EXCLUDED.last_error,
         metadata = EXCLUDED.metadata`,
      [
        state.provider,
        state.mailbox,
        state.historyCursor,
        state.lastSyncAt,
        state.lastSuccessAt,
        state.consecutiveFailures,
        state.backoffUntil,
        state.lastError,
        JSON.stringify(state.metadata ?? {}),
      ]
    );
  }

  async hasProcessedMessage(provider: SupportProvider, messageId: string): Promise<boolean> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT provider_message_id
       FROM brain_support_mailbox_messages
       WHERE provider = $1 AND provider_message_id = $2
       LIMIT 1`,
      [provider, messageId]
    );
    return Boolean(result.rowCount);
  }

  async saveMessageRecord(record: SupportMessageRecord): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_support_mailbox_messages
       (provider, mailbox, provider_message_id, provider_thread_id, support_request_id, received_at, status, decision, risk_state, raw_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10::jsonb,now(),now())
       ON CONFLICT (provider, provider_message_id) DO UPDATE SET
         mailbox = EXCLUDED.mailbox,
         provider_thread_id = EXCLUDED.provider_thread_id,
         support_request_id = EXCLUDED.support_request_id,
         received_at = EXCLUDED.received_at,
         status = EXCLUDED.status,
         decision = EXCLUDED.decision,
         risk_state = EXCLUDED.risk_state,
         raw_payload = EXCLUDED.raw_payload,
         updated_at = now()`,
      [
        record.provider,
        record.mailbox,
        record.messageId,
        record.threadId,
        record.supportRequestId,
        record.receivedAt,
        record.status,
        record.decision,
        record.riskState,
        JSON.stringify(record.rawPayload),
      ]
    );
  }

  async getCaseSnapshot(supportRequestId: string): Promise<SupportCaseSnapshot | null> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT
         support_request_id,
         source_provider,
         mailbox,
         conversation_key,
         source_thread_id,
         source_message_id,
         latest_source_message_id,
         thread_drift_flag,
         sender_email,
         sender_verified_uid,
         decision,
         risk_state,
         automation_state,
         queue_bucket,
         unread,
         member_care_state,
         member_care_reason,
         last_care_touch_at,
         care_touch_count,
         last_operator_action_at,
         next_recommended_action,
         support_summary,
         ember_memory_scope,
         ember_summary,
         confusion_state,
         confusion_reason,
         human_handoff,
         reply_draft,
         proposal_id,
         proposal_capability_id,
         last_received_at,
         updated_at,
         raw_snapshot
       FROM brain_support_cases
       WHERE support_request_id = $1
       LIMIT 1`,
      [supportRequestId]
    );
    if (!result.rowCount) return null;
    return hydrateCaseSnapshot(result.rows[0] as Record<string, unknown>);
  }

  async saveCaseSnapshot(snapshot: SupportCaseSnapshot): Promise<void> {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO brain_support_cases
       (
         support_request_id, source_provider, mailbox, conversation_key, source_thread_id, source_message_id, latest_source_message_id,
         thread_drift_flag, sender_email, sender_verified_uid, policy_slug, policy_version, decision, risk_state, automation_state,
         queue_bucket, unread, member_care_state, member_care_reason, last_care_touch_at, care_touch_count,
         last_operator_action_at, next_recommended_action, support_summary, ember_memory_scope, ember_summary, confusion_state,
         confusion_reason, human_handoff, reply_draft, proposal_id, proposal_capability_id, last_received_at, updated_at, raw_snapshot
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::timestamptz,$21,$22::timestamptz,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33::timestamptz,$34::timestamptz,$35::jsonb)
       ON CONFLICT (support_request_id) DO UPDATE SET
         source_provider = EXCLUDED.source_provider,
         mailbox = EXCLUDED.mailbox,
         conversation_key = EXCLUDED.conversation_key,
         source_thread_id = EXCLUDED.source_thread_id,
         source_message_id = EXCLUDED.source_message_id,
         latest_source_message_id = EXCLUDED.latest_source_message_id,
         thread_drift_flag = EXCLUDED.thread_drift_flag,
         sender_email = EXCLUDED.sender_email,
         sender_verified_uid = EXCLUDED.sender_verified_uid,
         policy_slug = EXCLUDED.policy_slug,
         policy_version = EXCLUDED.policy_version,
         decision = EXCLUDED.decision,
         risk_state = EXCLUDED.risk_state,
         automation_state = EXCLUDED.automation_state,
         queue_bucket = EXCLUDED.queue_bucket,
         unread = EXCLUDED.unread,
         member_care_state = EXCLUDED.member_care_state,
         member_care_reason = EXCLUDED.member_care_reason,
         last_care_touch_at = EXCLUDED.last_care_touch_at,
         care_touch_count = EXCLUDED.care_touch_count,
         last_operator_action_at = EXCLUDED.last_operator_action_at,
         next_recommended_action = EXCLUDED.next_recommended_action,
         support_summary = EXCLUDED.support_summary,
         ember_memory_scope = EXCLUDED.ember_memory_scope,
         ember_summary = EXCLUDED.ember_summary,
         confusion_state = EXCLUDED.confusion_state,
         confusion_reason = EXCLUDED.confusion_reason,
         human_handoff = EXCLUDED.human_handoff,
         reply_draft = EXCLUDED.reply_draft,
         proposal_id = EXCLUDED.proposal_id,
         proposal_capability_id = EXCLUDED.proposal_capability_id,
         last_received_at = EXCLUDED.last_received_at,
         updated_at = EXCLUDED.updated_at,
         raw_snapshot = EXCLUDED.raw_snapshot`,
      [
        snapshot.supportRequestId,
        snapshot.provider,
        snapshot.mailbox,
        snapshot.conversationKey,
        snapshot.sourceThreadId,
        snapshot.sourceMessageId,
        snapshot.latestSourceMessageId,
        snapshot.threadDriftFlag,
        snapshot.senderEmail,
        snapshot.senderVerifiedUid,
        snapshot.policyResolution.policySlug,
        snapshot.policyResolution.policyVersion,
        snapshot.decision,
        snapshot.riskState,
        snapshot.automationState,
        snapshot.queueBucket,
        snapshot.unread,
        snapshot.memberCareState,
        snapshot.memberCareReason,
        snapshot.lastCareTouchAt,
        snapshot.careTouchCount,
        snapshot.lastOperatorActionAt,
        snapshot.nextRecommendedAction,
        snapshot.supportSummary,
        snapshot.emberMemoryScope,
        snapshot.emberSummary,
        snapshot.confusionState,
        snapshot.confusionReason,
        snapshot.humanHandoff,
        snapshot.replyDraft,
        snapshot.proposalId,
        snapshot.proposalCapabilityId,
        snapshot.lastReceivedAt,
        snapshot.updatedAt,
        JSON.stringify(snapshot),
      ]
    );
  }

  async listRecentCases(limit: number): Promise<SupportCaseSnapshot[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await pool.query(
      `SELECT
         support_request_id,
         source_provider,
         mailbox,
         conversation_key,
         source_thread_id,
         source_message_id,
         latest_source_message_id,
         thread_drift_flag,
         sender_email,
         sender_verified_uid,
         decision,
         risk_state,
         automation_state,
         queue_bucket,
         unread,
         member_care_state,
         member_care_reason,
         last_care_touch_at,
         care_touch_count,
         last_operator_action_at,
         next_recommended_action,
         support_summary,
         ember_memory_scope,
         ember_summary,
         confusion_state,
         confusion_reason,
         human_handoff,
         reply_draft,
         proposal_id,
         proposal_capability_id,
         last_received_at,
         updated_at,
         raw_snapshot
       FROM brain_support_cases
       ORDER BY updated_at DESC
       LIMIT $1`,
      [bounded]
    );
    return result.rows.map((row) => hydrateCaseSnapshot(row as Record<string, unknown>));
  }

  async getQueueSummary(): Promise<SupportQueueSummary> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT queue_bucket, unread, last_received_at, thread_drift_flag, member_care_state, last_care_touch_at, raw_snapshot
       FROM brain_support_cases
       WHERE queue_bucket <> 'resolved'`
    );
    let unread = 0;
    let awaitingInfo = 0;
    let awaitingApproval = 0;
    let securityHold = 0;
    let staffReview = 0;
    let warmTouchesDue = 0;
    let splitThreadSuspects = 0;
    let fresh = 0;
    let warning = 0;
    let overdue = 0;
    let oldestOpenAt: string | null = null;
    const nowMs = Date.now();

    for (const row of result.rows as Record<string, unknown>[]) {
      const bucket = String(row.queue_bucket ?? "");
      const unreadFlag = row.unread === true;
      const lastReceivedAt = row.last_received_at ? toIso(row.last_received_at) : null;
      const memberCareState = String(row.member_care_state ?? "none");
      const lastCareTouchAt = row.last_care_touch_at ? toIso(row.last_care_touch_at) : null;
      const rawSnapshot = toJsonObject(row.raw_snapshot);
      const messageCount = toInteger(rawSnapshot.messageCount, 1);
      if (unreadFlag) unread += 1;
      if (bucket === "awaiting_info") awaitingInfo += 1;
      if (bucket === "awaiting_approval") awaitingApproval += 1;
      if (bucket === "security_hold") securityHold += 1;
      if (bucket === "staff_review" || bucket === "unread") staffReview += 1;
      if (row.thread_drift_flag === true) splitThreadSuspects += 1;
      if (lastReceivedAt) {
        if (!oldestOpenAt || lastReceivedAt < oldestOpenAt) oldestOpenAt = lastReceivedAt;
        const ageHours = (nowMs - Date.parse(lastReceivedAt)) / 3_600_000;
        if (ageHours >= 24) overdue += 1;
        else if (ageHours >= 4) warning += 1;
        else fresh += 1;
        const careTouchedAfterLatestInbound =
          Boolean(lastCareTouchAt) && Date.parse(String(lastCareTouchAt)) >= Date.parse(lastReceivedAt);
        const repeatedFollowUpWithoutFreshTouch = messageCount >= 2 && !careTouchedAfterLatestInbound;
        const hitsWarningBandWithoutCare =
          ageHours >= 4 && memberCareState !== "sent" && memberCareState !== "drafted";
        if (memberCareState === "due" || repeatedFollowUpWithoutFreshTouch || hitsWarningBandWithoutCare) {
          warmTouchesDue += 1;
        }
      }
    }

    return {
      unread,
      awaitingInfo,
      awaitingApproval,
      securityHold,
      staffReview,
      warmTouchesDue,
      splitThreadSuspects,
      totalOpen: result.rowCount ?? 0,
      oldestOpenAt,
      slaAging: {
        fresh,
        warning,
        overdue,
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
  }): Promise<SupportDeadLetter> {
    const pool = getPgPool();
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const attemptCount = Math.max(1, Math.trunc(input.attemptCount ?? 1));
    await pool.query(
      `INSERT INTO brain_support_dead_letters
       (id, provider, mailbox, provider_message_id, error_message, raw_payload, attempt_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::timestamptz)`,
      [id, input.provider, input.mailbox, input.messageId, input.errorMessage, JSON.stringify(input.rawPayload), attemptCount, createdAt]
    );
    return {
      id,
      provider: input.provider,
      mailbox: input.mailbox,
      messageId: input.messageId,
      errorMessage: input.errorMessage,
      attemptCount,
      rawPayload: input.rawPayload,
      createdAt,
    };
  }

  async listDeadLetters(limit: number): Promise<SupportDeadLetter[]> {
    const pool = getPgPool();
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await pool.query(
      `SELECT id, provider, mailbox, provider_message_id, error_message, raw_payload, attempt_count, created_at
       FROM brain_support_dead_letters
       ORDER BY created_at DESC
       LIMIT $1`,
      [bounded]
    );
    return result.rows.map((row) => ({
      id: String(row.id ?? ""),
      provider: String(row.provider ?? "gmail") as SupportProvider,
      mailbox: String(row.mailbox ?? ""),
      messageId: row.provider_message_id ? String(row.provider_message_id) : null,
      errorMessage: String(row.error_message ?? ""),
      rawPayload: toJsonObject(row.raw_payload),
      attemptCount: Number(row.attempt_count ?? 1),
      createdAt: toIso(row.created_at),
    }));
  }
}
