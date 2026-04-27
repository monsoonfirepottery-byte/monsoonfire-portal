"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSupportPolicy = resolveSupportPolicy;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
let cachedBundle = null;
function readJsonFile(path) {
    return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
}
function repoRootPath(...segments) {
    return (0, node_path_1.resolve)(__dirname, "..", "..", "..", ...segments);
}
function loadBundle() {
    if (cachedBundle)
        return cachedBundle;
    const resolution = readJsonFile(repoRootPath(".governance", "customer-service-policies", "policy-resolution-contract.json"));
    const inventory = readJsonFile(repoRootPath(".governance", "customer-service-policies", "policy-inventory.json"));
    const practiceByPolicy = new Map();
    for (const artifact of inventory.artifacts ?? []) {
        if (artifact.kind !== "practice-evidence")
            continue;
        for (const policySlug of artifact.policySlugs ?? []) {
            const current = practiceByPolicy.get(policySlug) ?? [];
            current.push(artifact);
            practiceByPolicy.set(policySlug, current);
        }
    }
    cachedBundle = {
        intents: resolution.intents ?? [],
        practiceByPolicy,
    };
    return cachedBundle;
}
function normalizeText(value) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}
function extractSignal(signal, text) {
    const normalized = signal.toLowerCase();
    if (normalized.includes("date") || normalized.includes("deadline") || normalized.includes("window")) {
        return /\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|today|tomorrow|week)\b/i.test(text);
    }
    if (normalized.includes("payment reference") || normalized.includes("transaction")) {
        return /\b(invoice|receipt|charge|payment|txn|transaction|order|ref(?:erence)?|#\w+)\b/i.test(text);
    }
    if (normalized.includes("order") || normalized.includes("workflow status") || normalized.includes("reservation id")) {
        return /\b(order|reservation|booking|loan|batch|request|status|id)\b/i.test(text);
    }
    if (normalized.includes("email") || normalized.includes("account") || normalized.includes("requester")) {
        return /\b(email|account|member|profile|uid)\b/i.test(text);
    }
    if (normalized.includes("photo") || normalized.includes("evidence") || normalized.includes("witness")) {
        return /\b(photo|image|attached|evidence|witness)\b/i.test(text);
    }
    if (normalized.includes("piece") || normalized.includes("batch")) {
        return /\b(piece|pot|mug|bowl|batch|kiln)\b/i.test(text);
    }
    const keywords = normalized
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4);
    if (keywords.length === 0)
        return false;
    return keywords.some((keyword) => text.includes(keyword));
}
function scoreIntent(intent, text) {
    let score = 0;
    const matchedTerms = [];
    for (const rawTerm of intent.matchTerms ?? []) {
        const term = normalizeText(String(rawTerm ?? ""));
        if (!term || term.length < 3)
            continue;
        if (!text.includes(term))
            continue;
        matchedTerms.push(term);
        score += term.includes(" ") ? 3 : term.length >= 8 ? 2 : 1;
        if (matchedTerms.length >= 12)
            break;
    }
    return { score, matchedTerms };
}
function emptyResolution() {
    return {
        intentId: null,
        policySlug: null,
        policyVersion: null,
        discrepancyFlag: false,
        escalationReason: "policy_unresolved",
        matchedTerms: [],
        requiredSignals: [],
        missingSignals: [],
        allowedLowRiskActions: [],
        blockedActions: [],
        replyTemplate: null,
        difficultProcessGuidance: [],
        practiceEvidenceIds: [],
        practiceEvidence: [],
        warmTouchPlaybook: null,
    };
}
function resolveSupportPolicy(message) {
    const bundle = loadBundle();
    const combinedText = normalizeText([message.subject, message.snippet, message.bodyText, message.senderEmail ?? "", message.attachments.map((row) => row.filename).join(" ")]
        .filter(Boolean)
        .join(" "));
    let best = null;
    let bestScore = 0;
    let matchedTerms = [];
    for (const intent of bundle.intents) {
        const candidate = scoreIntent(intent, combinedText);
        if (candidate.score <= bestScore)
            continue;
        best = intent;
        bestScore = candidate.score;
        matchedTerms = candidate.matchedTerms;
    }
    if (!best || bestScore <= 0) {
        return emptyResolution();
    }
    const policySlug = best.policySlugs?.[0] ?? null;
    const practiceArtifacts = policySlug ? bundle.practiceByPolicy.get(policySlug) ?? [] : [];
    const requiredSignals = best.requiredSignals ?? [];
    const missingSignals = requiredSignals.filter((signal) => !extractSignal(signal, combinedText));
    const practiceEvidence = practiceArtifacts
        .map((artifact) => [artifact.observedPractice, artifact.canonicalConcern].filter(Boolean).join(" "))
        .filter(Boolean)
        .slice(0, 4);
    return {
        intentId: best.intentId,
        policySlug,
        policyVersion: best.policyVersion ?? null,
        discrepancyFlag: String(best.discrepancyStatus ?? "").toLowerCase() !== "clear",
        escalationReason: missingSignals.length > 0 ? "missing_required_signals" : null,
        matchedTerms: matchedTerms.slice(0, 8),
        requiredSignals,
        missingSignals,
        allowedLowRiskActions: (best.allowedLowRiskActions ?? []).slice(0, 8),
        blockedActions: (best.blockedActions ?? []).slice(0, 8),
        replyTemplate: best.approvedReplyShape?.template ?? null,
        difficultProcessGuidance: [
            ...practiceEvidence,
            ...((best.escalateWhen ?? []).map((entry) => `Escalate when: ${entry}`)),
        ].slice(0, 8),
        practiceEvidenceIds: practiceArtifacts.map((artifact) => artifact.id).slice(0, 8),
        practiceEvidence,
        warmTouchPlaybook: best.warmTouchPlaybook ?? null,
    };
}
