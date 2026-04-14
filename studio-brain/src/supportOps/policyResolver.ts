import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupportMailboxMessage, SupportPolicyResolution, SupportWarmTouchPlaybook } from "./types";

type PolicyIntent = {
  intentId: string;
  label: string;
  policySlugs: string[];
  policyVersion: string | null;
  matchTerms: string[];
  requiredSignals: string[];
  escalateWhen: string[];
  allowedLowRiskActions: string[];
  blockedActions: string[];
  approvedReplyShape?: {
    template?: string;
  };
  warmTouchPlaybook?: SupportWarmTouchPlaybook | null;
  discrepancyStatus?: string | null;
};

type PolicyResolutionContract = {
  intents: PolicyIntent[];
};

type PolicyArtifact = {
  id: string;
  kind: string;
  policySlugs?: string[];
  observedPractice?: string | null;
  canonicalConcern?: string | null;
};

type PolicyInventory = {
  artifacts: PolicyArtifact[];
};

let cachedBundle:
  | {
      intents: PolicyIntent[];
      practiceByPolicy: Map<string, PolicyArtifact[]>;
    }
  | null = null;

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function repoRootPath(...segments: string[]): string {
  return resolve(__dirname, "..", "..", "..", ...segments);
}

function loadBundle(): { intents: PolicyIntent[]; practiceByPolicy: Map<string, PolicyArtifact[]> } {
  if (cachedBundle) return cachedBundle;
  const resolution = readJsonFile<PolicyResolutionContract>(
    repoRootPath(".governance", "customer-service-policies", "policy-resolution-contract.json")
  );
  const inventory = readJsonFile<PolicyInventory>(
    repoRootPath(".governance", "customer-service-policies", "policy-inventory.json")
  );
  const practiceByPolicy = new Map<string, PolicyArtifact[]>();
  for (const artifact of inventory.artifacts ?? []) {
    if (artifact.kind !== "practice-evidence") continue;
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

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractSignal(signal: string, text: string): boolean {
  const normalized = signal.toLowerCase();
  if (normalized.includes("date") || normalized.includes("deadline") || normalized.includes("window")) {
    return /\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|today|tomorrow|week)\b/i.test(
      text
    );
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
  if (keywords.length === 0) return false;
  return keywords.some((keyword) => text.includes(keyword));
}

function scoreIntent(intent: PolicyIntent, text: string): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matchedTerms: string[] = [];
  for (const rawTerm of intent.matchTerms ?? []) {
    const term = normalizeText(String(rawTerm ?? ""));
    if (!term || term.length < 3) continue;
    if (!text.includes(term)) continue;
    matchedTerms.push(term);
    score += term.includes(" ") ? 3 : term.length >= 8 ? 2 : 1;
    if (matchedTerms.length >= 12) break;
  }
  return { score, matchedTerms };
}

function emptyResolution(): SupportPolicyResolution {
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

export function resolveSupportPolicy(message: SupportMailboxMessage): SupportPolicyResolution {
  const bundle = loadBundle();
  const combinedText = normalizeText(
    [message.subject, message.snippet, message.bodyText, message.senderEmail ?? "", message.attachments.map((row) => row.filename).join(" ")]
      .filter(Boolean)
      .join(" ")
  );
  let best: PolicyIntent | null = null;
  let bestScore = 0;
  let matchedTerms: string[] = [];

  for (const intent of bundle.intents) {
    const candidate = scoreIntent(intent, combinedText);
    if (candidate.score <= bestScore) continue;
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
