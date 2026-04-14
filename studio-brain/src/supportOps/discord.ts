import crypto from "node:crypto";
import {
  SUPPORT_AGENT_PERSONA,
  buildSupportAgentSystemPrompt,
  type SupportAgentPersona,
} from "./persona";
import { resolveSupportPolicy } from "./policyResolver";
import { assessSupportRisk } from "./risk";
import { buildSupportConversationKey, decideSupportAction, determineProposalCapabilityId } from "./service";
import type {
  SupportDecision,
  SupportMailboxMessage,
  SupportPolicyResolution,
  SupportProvider,
  SupportRiskAssessment,
} from "./types";

const DISCORD_PROVIDER = "discord" as SupportProvider;
const NUANCED_QUESTION_PATTERN = /\b(sorry|apolog(?:y|ize|ies)|confused|not sure|any chance|would it be okay|does that work|could i|can i|thank you|thanks)\b/i;

export type SupportDiscordQuestionInput = {
  channelId: string;
  threadId?: string | null;
  messageId?: string | null;
  guildId?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  question: string;
  receivedAt?: string | null;
};

export type SupportDiscordDraft = {
  persona: Pick<
    SupportAgentPersona,
    "id" | "displayName" | "shortBio" | "disclosureShort" | "avatarAssetPath" | "avatarAlt"
  >;
  reply: string;
  replyMode: "template" | "model" | "human_review";
  usedModel: boolean;
  model: { provider: "openai"; version: string } | null;
  policySlug: string | null;
  decision: SupportDecision;
  humanReviewRequired: boolean;
  riskState: SupportRiskAssessment["state"];
  riskReasons: string[];
  proposalCapabilityId: string | null;
  supportSummary: string;
  conversationKey: string;
};

type DraftDiscordSupportReplyOptions = {
  apiKey?: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
  emberContextSummary?: string | null;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function clip(value: unknown, max: number): string {
  const normalized = clean(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function listToEnglish(values: string[]): string {
  const items = values.map((value) => clean(value)).filter(Boolean);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function titleFromSlug(value: string | null): string {
  if (!value) return "support";
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function supportBoundary(policySlug: string | null): string {
  switch (policySlug) {
    case "firing-scheduling":
      return "Pickup timing can shift, and same-day pickup is not guaranteed until the studio confirms the window.";
    case "payments-refunds":
      return "Refunds, credits, and billing exceptions are never finalized automatically in Discord.";
    case "storage-abandoned-work":
      return "Storage timing stays tied to the recorded pickup-ready timeline and grace windows.";
    case "studio-access":
      return "Access logistics can be coordinated here, but access exceptions and codes are never granted automatically.";
    case "damage-responsibility":
      return "Damage questions stay in documentation-first review until the evidence is reconciled.";
    case "accessibility":
      return "Accessibility requests stay open until the accommodation path is confirmed with operations.";
    default:
      return "Any exception, refund, queue change, or access change still needs human confirmation.";
  }
}

function summarizeQuestion(input: {
  senderName?: string | null;
  policy: SupportPolicyResolution;
  question: string;
  decision: SupportDecision;
}): string {
  const name = clip(input.senderName || "Unknown sender", 80);
  const latest = clip(input.question, 220);
  return clip(
    `${name} | ${titleFromSlug(input.policy.policySlug)} | Latest: ${latest} | Decision: ${input.decision}`,
    500,
  );
}

function extractLinkDomains(text: string): string[] {
  const domains = new Set<string>();
  const matches = text.matchAll(/https?:\/\/([^\s/]+)/gi);
  for (const match of matches) {
    const domain = clean(match[1]).toLowerCase();
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function buildDiscordSupportMessage(input: SupportDiscordQuestionInput): SupportMailboxMessage {
  const question = clean(input.question);
  const threadId = clean(input.threadId) || clean(input.channelId);
  const messageId = clean(input.messageId) || `discord-${crypto.randomUUID()}`;
  const receivedAt = clean(input.receivedAt) || new Date().toISOString();
  return {
    provider: DISCORD_PROVIDER,
    mailbox: `discord:${clean(input.channelId)}`,
    messageId,
    rfcMessageId: null,
    threadId,
    historyId: null,
    subject: clip(question.split(/\r?\n/, 1)[0] || "Discord support question", 120),
    snippet: clip(question, 240),
    bodyText: clip(question, 8_000),
    senderEmail: clean(input.senderEmail) || null,
    senderName: clean(input.senderName) || null,
    receivedAt,
    references: [],
    inReplyTo: null,
    attachments: [],
    linkDomains: extractLinkDomains(question),
    labels: ["DISCORD"],
    rawHeaders: {
      discordChannelId: clean(input.channelId),
      discordThreadId: clean(input.threadId),
      discordGuildId: clean(input.guildId),
      discordSenderId: clean(input.senderId),
    },
  };
}

function shouldUseModelDraft(input: {
  question: string;
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  decision: SupportDecision;
  proposalCapabilityId: string | null;
}): boolean {
  if (!input.policy.policySlug) return false;
  if (input.risk.state === "high_risk") return false;
  if (input.decision === "security_hold") return false;
  if (input.decision === "proposal_required") return false;
  if (input.risk.blockedActionRequested) return false;
  if (input.risk.accessSecretRequested) return false;
  if (input.risk.manualOverrideLanguage) return false;
  if (input.risk.forwarded) return false;
  if (input.policy.missingSignals.length > 0) return false;
  const normalized = clean(input.question);
  return normalized.length >= 180 || normalized.includes("?") || NUANCED_QUESTION_PATTERN.test(normalized);
}

function buildTemplateReply(input: {
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  decision: SupportDecision;
}): { reply: string; replyMode: SupportDiscordDraft["replyMode"]; humanReviewRequired: boolean } {
  const acknowledge =
    input.policy.warmTouchPlaybook?.acknowledge
    || "Thanks for checking in here.";
  const boundary =
    input.policy.warmTouchPlaybook?.boundary
    || supportBoundary(input.policy.policySlug);
  const nextStep =
    input.policy.warmTouchPlaybook?.nextStep
    || "If you want, keep replying here and I’ll help route the next safe next step.";

  if (
    input.decision === "security_hold"
    || input.risk.state === "high_risk"
    || input.risk.blockedActionRequested
    || input.risk.accessSecretRequested
    || input.risk.manualOverrideLanguage
    || input.risk.forwarded
  ) {
    return {
      reply: `${acknowledge} I can help with routine studio questions in Discord, but this request needs human review before anything sensitive, account-specific, or exception-based is answered.`,
      replyMode: "human_review",
      humanReviewRequired: true,
    };
  }

  if (!input.policy.policySlug) {
    return {
      reply: `${acknowledge} I can help with routine studio support here, but I need a human teammate to look at this question before I say more.`,
      replyMode: "human_review",
      humanReviewRequired: true,
    };
  }

  if (input.decision === "proposal_required") {
    return {
      reply: `${acknowledge} I can note the question here, but I cannot approve or promise that in Discord. A human teammate needs to review it first.`,
      replyMode: "human_review",
      humanReviewRequired: true,
    };
  }

  if (input.policy.missingSignals.length > 0) {
    return {
      reply: `${acknowledge} I can help once I have ${listToEnglish(input.policy.missingSignals)}. ${boundary}`,
      replyMode: "template",
      humanReviewRequired: false,
    };
  }

  return {
    reply: `${acknowledge} ${boundary} ${nextStep}`,
    replyMode: "template",
    humanReviewRequired: false,
  };
}

async function runNuancedModelDraft(input: {
  question: string;
  policy: SupportPolicyResolution;
  risk: SupportRiskAssessment;
  templateReply: string;
  emberContextSummary?: string | null;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  const response = await input.fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                buildSupportAgentSystemPrompt("discord"),
                "Write one concise Discord reply in 2 to 4 sentences.",
                "Be warm, calm, and plainspoken.",
                "Do not pretend to be human.",
                "Do not promise refunds, access codes, exceptions, guarantees, or staff-only outcomes.",
                "If human review is needed, say so plainly and briefly.",
                "Do not mention policy slugs, JSON, risk classifications, or internal tooling.",
                "No markdown bullets, no signature block, no emojis.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Member question: ${clip(input.question, 1_200)}`,
                `Policy path: ${input.policy.policySlug ?? "unresolved"}`,
                `Allowed low-risk actions: ${listToEnglish(input.policy.allowedLowRiskActions) || "none"}`,
                `Blocked actions: ${listToEnglish(input.policy.blockedActions) || "none"}`,
                `Warm-touch boundary: ${input.policy.warmTouchPlaybook?.boundary ?? supportBoundary(input.policy.policySlug)}`,
                `Warm-touch next step: ${input.policy.warmTouchPlaybook?.nextStep ?? "A human teammate can follow up if needed."}`,
                `Risk state: ${input.risk.state}`,
                input.emberContextSummary ? `Existing Ember context: ${clip(input.emberContextSummary, 800)}` : "",
                `Baseline safe reply: ${input.templateReply}`,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 220,
    }),
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    clean(payload.output_text)
    || clean(
      payload.output
        ?.flatMap((part) => part.content ?? [])
        .map((part) => part.text ?? "")
        .join(" "),
    );
  return text || null;
}

export function getSupportAgentProfile(): Pick<
  SupportAgentPersona,
  | "id"
  | "displayName"
  | "fromName"
  | "signatureRole"
  | "disclosureShort"
  | "profileIntro"
  | "shortBio"
  | "toneTraits"
  | "touchpoints"
  | "avatarAssetPath"
  | "avatarAlt"
  | "artDirection"
  | "draftingPolicy"
  | "startup"
> {
  return {
    id: SUPPORT_AGENT_PERSONA.id,
    displayName: SUPPORT_AGENT_PERSONA.displayName,
    fromName: SUPPORT_AGENT_PERSONA.fromName,
    signatureRole: SUPPORT_AGENT_PERSONA.signatureRole,
    disclosureShort: SUPPORT_AGENT_PERSONA.disclosureShort,
    profileIntro: SUPPORT_AGENT_PERSONA.profileIntro,
    shortBio: SUPPORT_AGENT_PERSONA.shortBio,
    toneTraits: [...SUPPORT_AGENT_PERSONA.toneTraits],
    touchpoints: [...SUPPORT_AGENT_PERSONA.touchpoints],
    avatarAssetPath: SUPPORT_AGENT_PERSONA.avatarAssetPath,
    avatarAlt: SUPPORT_AGENT_PERSONA.avatarAlt,
    artDirection: SUPPORT_AGENT_PERSONA.artDirection,
    draftingPolicy: { ...SUPPORT_AGENT_PERSONA.draftingPolicy },
    startup: {
      ...SUPPORT_AGENT_PERSONA.startup,
      carePromises: [...SUPPORT_AGENT_PERSONA.startup.carePromises],
      startupChecklist: [...SUPPORT_AGENT_PERSONA.startup.startupChecklist],
      warmTouchMoments: [...SUPPORT_AGENT_PERSONA.startup.warmTouchMoments],
      escalationTriggers: [...SUPPORT_AGENT_PERSONA.startup.escalationTriggers],
      channelPacks: {
        email: { ...SUPPORT_AGENT_PERSONA.startup.channelPacks.email },
        discord: { ...SUPPORT_AGENT_PERSONA.startup.channelPacks.discord },
        human_review: { ...SUPPORT_AGENT_PERSONA.startup.channelPacks.human_review },
      },
      profileCard: { ...SUPPORT_AGENT_PERSONA.startup.profileCard },
      fileReferences: [...SUPPORT_AGENT_PERSONA.startup.fileReferences],
    },
  };
}

export async function draftDiscordSupportReply(
  input: SupportDiscordQuestionInput,
  options: DraftDiscordSupportReplyOptions = {},
): Promise<SupportDiscordDraft> {
  const channelId = clean(input.channelId);
  const question = clean(input.question);
  if (!channelId) {
    throw new Error("channelId is required.");
  }
  if (!question) {
    throw new Error("question is required.");
  }

  const message = buildDiscordSupportMessage(input);
  const conversationKey = buildSupportConversationKey(message);
  const policy = resolveSupportPolicy(message);
  const risk = await assessSupportRisk(message, policy);
  const disposition = decideSupportAction({ message, policy, risk });
  const proposalCapabilityId = determineProposalCapabilityId(message, policy);
  const summary = summarizeQuestion({
    senderName: input.senderName,
    policy,
    question,
    decision: disposition.decision,
  });

  const baseReply = buildTemplateReply({
    policy,
    risk,
    decision: disposition.decision,
  });

  const apiKey = clean(options.apiKey ?? process.env.STUDIO_BRAIN_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY);
  const model = clean(options.model) || SUPPORT_AGENT_PERSONA.draftingPolicy.suggestedModel;
  const shouldUseModel =
    Boolean(apiKey)
    && baseReply.replyMode === "template"
    && shouldUseModelDraft({
      question,
      policy,
      risk,
      decision: disposition.decision,
      proposalCapabilityId,
    });

  let reply = baseReply.reply;
  let usedModel = false;
  if (shouldUseModel) {
    const drafted = await runNuancedModelDraft({
      question,
      policy,
      risk,
      templateReply: baseReply.reply,
      emberContextSummary: options.emberContextSummary ?? null,
      apiKey,
      model,
      fetchImpl: options.fetchImpl ?? fetch,
    });
    if (drafted) {
      reply = drafted;
      usedModel = true;
    }
  }

  return {
    persona: {
      id: SUPPORT_AGENT_PERSONA.id,
      displayName: SUPPORT_AGENT_PERSONA.displayName,
      shortBio: SUPPORT_AGENT_PERSONA.shortBio,
      disclosureShort: SUPPORT_AGENT_PERSONA.disclosureShort,
      avatarAssetPath: SUPPORT_AGENT_PERSONA.avatarAssetPath,
      avatarAlt: SUPPORT_AGENT_PERSONA.avatarAlt,
    },
    reply,
    replyMode: usedModel ? "model" : baseReply.replyMode,
    usedModel,
    model: usedModel ? { provider: "openai", version: model } : null,
    policySlug: policy.policySlug,
    decision: disposition.decision,
    humanReviewRequired: baseReply.humanReviewRequired,
    riskState: risk.state,
    riskReasons: [...risk.reasons],
    proposalCapabilityId,
    supportSummary: summary,
    conversationKey,
  };
}
