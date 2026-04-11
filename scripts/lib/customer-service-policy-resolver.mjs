import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");

export const DEFAULT_RESOLUTION_CONTRACT_PATH = resolve(
  repoRoot,
  ".governance",
  "customer-service-policies",
  "policy-resolution-contract.json"
);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )
  );
}

function normalizeSignalMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function termScore(text, term) {
  const normalizedText = normalizeLower(text);
  const normalizedTerm = normalizeLower(term);
  if (!normalizedText || !normalizedTerm) return 0;
  if (normalizedText.includes(normalizedTerm)) {
    return normalizedTerm.includes(" ") ? 6 : 4;
  }
  const tokens = normalizedTerm
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 4);
  if (tokens.length > 1 && tokens.every((token) => normalizedText.includes(token))) {
    return 2;
  }
  return 0;
}

function collectMatchedTerms(text, terms) {
  const matches = [];
  let score = 0;
  for (const term of normalizeStringArray(terms)) {
    const currentScore = termScore(text, term);
    if (currentScore > 0) {
      matches.push(term);
      score += currentScore;
    }
  }
  return {
    matchedTerms: matches,
    score,
  };
}

function collectMissingSignals(requiredSignals, providedSignals) {
  const signalMap = normalizeSignalMap(providedSignals);
  return normalizeStringArray(requiredSignals).filter((signal) => {
    const directValue = signalMap[signal];
    if (typeof directValue === "boolean") return false;
    if (typeof directValue === "number") return false;
    if (typeof directValue === "string") return directValue.trim().length === 0;
    return directValue == null;
  });
}

function collectBlockedActions(requestedAction, blockedActions) {
  const normalizedAction = normalizeLower(requestedAction);
  if (!normalizedAction) return [];
  return normalizeStringArray(blockedActions).filter((blocked) => {
    const normalizedBlocked = normalizeLower(blocked);
    return normalizedAction.includes(normalizedBlocked) || normalizedBlocked.includes(normalizedAction);
  });
}

export async function loadCustomerServiceResolutionContract(
  contractPath = DEFAULT_RESOLUTION_CONTRACT_PATH
) {
  return JSON.parse(await readFile(contractPath, "utf8"));
}

export function resolveCustomerServiceIntent(contract, input) {
  const text = normalizeText(input?.text);
  const requestedAction = normalizeText(input?.requestedAction);
  const providedSignals = normalizeSignalMap(input?.providedSignals);
  const intents = Array.isArray(contract?.intents) ? contract.intents : [];

  const matches = intents
    .map((intent) => {
      const { matchedTerms, score } = collectMatchedTerms(text, intent?.matchTerms || []);
      const missingSignals = collectMissingSignals(intent?.requiredSignals || [], providedSignals);
      const blockedBy = collectBlockedActions(requestedAction, intent?.blockedActions || []);
      return {
        intentId: normalizeText(intent?.intentId),
        label: normalizeText(intent?.label),
        policySlugs: normalizeStringArray(intent?.policySlugs || []),
        policyVersion: normalizeText(intent?.policyVersion),
        score,
        matchedTerms,
        missingSignals,
        requiresEscalation: blockedBy.length > 0,
        blockedBy,
        discrepancyFlag: normalizeText(intent?.discrepancyStatus) === "needs_reconciliation",
        approvedReplyShape: intent?.approvedReplyShape || null,
        allowedLowRiskActions: normalizeStringArray(intent?.allowedLowRiskActions || []),
        blockedActions: normalizeStringArray(intent?.blockedActions || []),
      };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.intentId.localeCompare(right.intentId));

  const topMatch = matches[0] || null;

  return {
    text,
    requestedAction,
    matchCount: matches.length,
    topMatch,
    matches,
  };
}
