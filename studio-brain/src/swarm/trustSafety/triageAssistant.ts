import type { AuditEvent } from "../../stores/interfaces";

export type TriageSuggestion = {
  severity: "low" | "medium" | "high";
  category: "broken_link" | "incorrect_info" | "spam" | "safety" | "harassment_hate" | "copyright" | "other";
  reasonCode: string;
  confidence: number;
  model: {
    provider: "rules";
    version: string;
  };
  provenance: string[];
  suggestionOnly: true;
};

const VERSION = "ts-assistant-rules-v1";

const RULES: Array<{
  matcher: RegExp;
  severity: TriageSuggestion["severity"];
  category: TriageSuggestion["category"];
  reasonCode: string;
  confidence: number;
  provenance: string;
}> = [
  {
    matcher: /(self[-\s]?harm|threat|danger|violence|weapon)/i,
    severity: "high",
    category: "safety",
    reasonCode: "safety_escalated",
    confidence: 0.9,
    provenance: "matched_safety_risk_terms",
  },
  {
    matcher: /(harass|hate|slur|abuse|discrimination)/i,
    severity: "high",
    category: "harassment_hate",
    reasonCode: "harassment_confirmed",
    confidence: 0.88,
    provenance: "matched_harassment_hate_terms",
  },
  {
    matcher: /(copyright|dmca|trademark|license|ip)/i,
    severity: "medium",
    category: "copyright",
    reasonCode: "copyright_claim_received",
    confidence: 0.84,
    provenance: "matched_ip_terms",
  },
  {
    matcher: /(spam|scam|bot|promo|unsolicited)/i,
    severity: "medium",
    category: "spam",
    reasonCode: "spam_confirmed",
    confidence: 0.8,
    provenance: "matched_spam_terms",
  },
  {
    matcher: /(broken\s+link|404|dead\s+link|wrong\s+url)/i,
    severity: "low",
    category: "broken_link",
    reasonCode: "broken_link_confirmed",
    confidence: 0.78,
    provenance: "matched_link_integrity_terms",
  },
  {
    matcher: /(incorrect|misinfo|wrong\s+info|outdated|inaccurate)/i,
    severity: "medium",
    category: "incorrect_info",
    reasonCode: "incorrect_info_confirmed",
    confidence: 0.75,
    provenance: "matched_accuracy_terms",
  },
];

export function buildTriageSuggestion(input: {
  note: string;
  targetTitle?: string;
  targetType?: string;
}): TriageSuggestion {
  const summary = `${input.targetType ?? ""} ${input.targetTitle ?? ""} ${input.note ?? ""}`.slice(0, 4000);
  const matches = RULES.filter((row) => row.matcher.test(summary));
  if (!matches.length) {
    return {
      severity: "low",
      category: "other",
      reasonCode: "insufficient_context",
      confidence: 0.45,
      model: { provider: "rules", version: VERSION },
      provenance: ["default_fallback_low_signal"],
      suggestionOnly: true,
    };
  }
  const best = [...matches].sort((a, b) => b.confidence - a.confidence)[0];
  return {
    severity: best.severity,
    category: best.category,
    reasonCode: best.reasonCode,
    confidence: best.confidence,
    model: { provider: "rules", version: VERSION },
    provenance: Array.from(new Set(matches.map((row) => row.provenance))),
    suggestionOnly: true,
  };
}

export function computeSuggestionFeedbackStats(rows: AuditEvent[]): {
  accepted: number;
  rejected: number;
  mismatchRatePct: number;
} {
  const feedback = rows.filter((row) => row.action === "trust_safety.triage_suggestion_feedback");
  const accepted = feedback.filter((row) => row.metadata?.decision === "accepted").length;
  const rejected = feedback.filter((row) => row.metadata?.decision === "rejected").length;
  const compared = feedback.filter((row) => typeof row.metadata?.mismatch === "boolean");
  const mismatches = compared.filter((row) => row.metadata?.mismatch === true).length;
  const mismatchRatePct = compared.length ? Math.round((mismatches / compared.length) * 100) : 0;
  return { accepted, rejected, mismatchRatePct };
}
