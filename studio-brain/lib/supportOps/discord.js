"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportAgentProfile = getSupportAgentProfile;
exports.draftDiscordSupportReply = draftDiscordSupportReply;
const node_crypto_1 = __importDefault(require("node:crypto"));
const persona_1 = require("./persona");
const policyResolver_1 = require("./policyResolver");
const risk_1 = require("./risk");
const service_1 = require("./service");
const DISCORD_PROVIDER = "discord";
const NUANCED_QUESTION_PATTERN = /\b(sorry|apolog(?:y|ize|ies)|confused|not sure|any chance|would it be okay|does that work|could i|can i|thank you|thanks)\b/i;
function clean(value) {
    return String(value ?? "").trim();
}
function clip(value, max) {
    const normalized = clean(value);
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function listToEnglish(values) {
    const items = values.map((value) => clean(value)).filter(Boolean);
    if (items.length === 0)
        return "";
    if (items.length === 1)
        return items[0];
    if (items.length === 2)
        return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function titleFromSlug(value) {
    if (!value)
        return "support";
    return value
        .split(/[-_\s]+/g)
        .filter(Boolean)
        .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
        .join(" ");
}
function supportBoundary(policySlug) {
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
function summarizeQuestion(input) {
    const name = clip(input.senderName || "Unknown sender", 80);
    const latest = clip(input.question, 220);
    return clip(`${name} | ${titleFromSlug(input.policy.policySlug)} | Latest: ${latest} | Decision: ${input.decision}`, 500);
}
function extractLinkDomains(text) {
    const domains = new Set();
    const matches = text.matchAll(/https?:\/\/([^\s/]+)/gi);
    for (const match of matches) {
        const domain = clean(match[1]).toLowerCase();
        if (domain)
            domains.add(domain);
    }
    return [...domains];
}
function buildDiscordSupportMessage(input) {
    const question = clean(input.question);
    const threadId = clean(input.threadId) || clean(input.channelId);
    const messageId = clean(input.messageId) || `discord-${node_crypto_1.default.randomUUID()}`;
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
function shouldUseModelDraft(input) {
    if (!input.policy.policySlug)
        return false;
    if (input.risk.state === "high_risk")
        return false;
    if (input.decision === "security_hold")
        return false;
    if (input.decision === "proposal_required")
        return false;
    if (input.risk.blockedActionRequested)
        return false;
    if (input.risk.accessSecretRequested)
        return false;
    if (input.risk.manualOverrideLanguage)
        return false;
    if (input.risk.forwarded)
        return false;
    if (input.policy.missingSignals.length > 0)
        return false;
    const normalized = clean(input.question);
    return normalized.length >= 180 || normalized.includes("?") || NUANCED_QUESTION_PATTERN.test(normalized);
}
function buildTemplateReply(input) {
    const acknowledge = input.policy.warmTouchPlaybook?.acknowledge
        || "Thanks for checking in here.";
    const boundary = input.policy.warmTouchPlaybook?.boundary
        || supportBoundary(input.policy.policySlug);
    const nextStep = input.policy.warmTouchPlaybook?.nextStep
        || "If you want, keep replying here and I’ll help route the next safe next step.";
    if (input.decision === "security_hold"
        || input.risk.state === "high_risk"
        || input.risk.blockedActionRequested
        || input.risk.accessSecretRequested
        || input.risk.manualOverrideLanguage
        || input.risk.forwarded) {
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
async function runNuancedModelDraft(input) {
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
                                (0, persona_1.buildSupportAgentSystemPrompt)("discord"),
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
    const payload = (await response.json());
    const text = clean(payload.output_text)
        || clean(payload.output
            ?.flatMap((part) => part.content ?? [])
            .map((part) => part.text ?? "")
            .join(" "));
    return text || null;
}
function getSupportAgentProfile() {
    return {
        id: persona_1.SUPPORT_AGENT_PERSONA.id,
        displayName: persona_1.SUPPORT_AGENT_PERSONA.displayName,
        fromName: persona_1.SUPPORT_AGENT_PERSONA.fromName,
        signatureRole: persona_1.SUPPORT_AGENT_PERSONA.signatureRole,
        disclosureShort: persona_1.SUPPORT_AGENT_PERSONA.disclosureShort,
        profileIntro: persona_1.SUPPORT_AGENT_PERSONA.profileIntro,
        shortBio: persona_1.SUPPORT_AGENT_PERSONA.shortBio,
        toneTraits: [...persona_1.SUPPORT_AGENT_PERSONA.toneTraits],
        touchpoints: [...persona_1.SUPPORT_AGENT_PERSONA.touchpoints],
        avatarAssetPath: persona_1.SUPPORT_AGENT_PERSONA.avatarAssetPath,
        avatarAlt: persona_1.SUPPORT_AGENT_PERSONA.avatarAlt,
        artDirection: persona_1.SUPPORT_AGENT_PERSONA.artDirection,
        draftingPolicy: { ...persona_1.SUPPORT_AGENT_PERSONA.draftingPolicy },
        startup: {
            ...persona_1.SUPPORT_AGENT_PERSONA.startup,
            carePromises: [...persona_1.SUPPORT_AGENT_PERSONA.startup.carePromises],
            startupChecklist: [...persona_1.SUPPORT_AGENT_PERSONA.startup.startupChecklist],
            warmTouchMoments: [...persona_1.SUPPORT_AGENT_PERSONA.startup.warmTouchMoments],
            escalationTriggers: [...persona_1.SUPPORT_AGENT_PERSONA.startup.escalationTriggers],
            channelPacks: {
                email: { ...persona_1.SUPPORT_AGENT_PERSONA.startup.channelPacks.email },
                discord: { ...persona_1.SUPPORT_AGENT_PERSONA.startup.channelPacks.discord },
                human_review: { ...persona_1.SUPPORT_AGENT_PERSONA.startup.channelPacks.human_review },
            },
            profileCard: { ...persona_1.SUPPORT_AGENT_PERSONA.startup.profileCard },
            fileReferences: [...persona_1.SUPPORT_AGENT_PERSONA.startup.fileReferences],
        },
    };
}
async function draftDiscordSupportReply(input, options = {}) {
    const channelId = clean(input.channelId);
    const question = clean(input.question);
    if (!channelId) {
        throw new Error("channelId is required.");
    }
    if (!question) {
        throw new Error("question is required.");
    }
    const message = buildDiscordSupportMessage(input);
    const conversationKey = (0, service_1.buildSupportConversationKey)(message);
    const policy = (0, policyResolver_1.resolveSupportPolicy)(message);
    const risk = await (0, risk_1.assessSupportRisk)(message, policy);
    const disposition = (0, service_1.decideSupportAction)({ message, policy, risk });
    const proposalCapabilityId = (0, service_1.determineProposalCapabilityId)(message, policy);
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
    const model = clean(options.model) || persona_1.SUPPORT_AGENT_PERSONA.draftingPolicy.suggestedModel;
    const shouldUseModel = Boolean(apiKey)
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
            id: persona_1.SUPPORT_AGENT_PERSONA.id,
            displayName: persona_1.SUPPORT_AGENT_PERSONA.displayName,
            shortBio: persona_1.SUPPORT_AGENT_PERSONA.shortBio,
            disclosureShort: persona_1.SUPPORT_AGENT_PERSONA.disclosureShort,
            avatarAssetPath: persona_1.SUPPORT_AGENT_PERSONA.avatarAssetPath,
            avatarAlt: persona_1.SUPPORT_AGENT_PERSONA.avatarAlt,
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
