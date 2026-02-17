import { stableHashDeep } from "../../stores/hash";
import type { AuditEvent } from "../../stores/interfaces";

export type IntakeCategory = "illegal_content" | "weaponization" | "ip_infringement" | "fraud_risk" | "unknown";
export type IntakeDisposition = "allow" | "manual_review";

export type IntakeClassification = {
  intakeId: string;
  category: IntakeCategory;
  disposition: IntakeDisposition;
  confidence: number;
  blocked: boolean;
  reasonCode: string;
  summary: string;
};

export type IntakeOverrideDecision = "override_granted" | "override_denied";

const RULES: Array<{ category: IntakeCategory; matcher: RegExp; reasonCode: string; confidence: number }> = [
  {
    category: "illegal_content",
    matcher: /(counterfeit|forg(?:e|ery)|stolen\s+goods|illicit|contraband)/i,
    reasonCode: "illegal_content_detected",
    confidence: 0.93,
  },
  {
    category: "weaponization",
    matcher: /(weapon|explosive|bomb|ghost\s*gun|silencer)/i,
    reasonCode: "weaponization_detected",
    confidence: 0.95,
  },
  {
    category: "ip_infringement",
    matcher: /(disney|marvel|nike|copy\s*logo|exact\s*replica|trademark)/i,
    reasonCode: "ip_infringement_detected",
    confidence: 0.88,
  },
  {
    category: "fraud_risk",
    matcher: /(stolen\s*card|chargeback\s*bypass|fake\s*identity|launder|wash\s*money)/i,
    reasonCode: "fraud_risk_detected",
    confidence: 0.9,
  },
];

export function classifyIntakeRisk(input: {
  actorId: string;
  ownerUid: string;
  capabilityId: string;
  rationale: string;
  previewSummary: string;
  requestInput: Record<string, unknown>;
}): IntakeClassification {
  const summary = `${input.previewSummary} ${input.rationale} ${JSON.stringify(input.requestInput)}`.slice(0, 4000);
  const matched = RULES.find((rule) => rule.matcher.test(summary));
  const category: IntakeCategory = matched?.category ?? "unknown";
  const blocked = category !== "unknown";
  return {
    intakeId: stableHashDeep({
      actorId: input.actorId,
      ownerUid: input.ownerUid,
      capabilityId: input.capabilityId,
      summary,
    }).slice(0, 24),
    category,
    disposition: blocked ? "manual_review" : "allow",
    confidence: matched?.confidence ?? 0.4,
    blocked,
    reasonCode: matched?.reasonCode ?? "unknown",
    summary: summary.slice(0, 240),
  };
}

export function hasOverrideGrant(recentEvents: AuditEvent[], intakeId: string): boolean {
  for (const row of recentEvents) {
    if (row.action !== "intake.override_granted") continue;
    if (row.metadata?.intakeId === intakeId) return true;
  }
  return false;
}

export function buildIntakeQueue(recentEvents: AuditEvent[], limit = 50): Array<Record<string, unknown>> {
  const rows = recentEvents.filter((row) => row.action === "intake.routed_to_review").slice(0, Math.max(1, limit));
  return rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      intakeId: metadata.intakeId,
      category: metadata.category,
      reasonCode: metadata.reasonCode,
      capabilityId: metadata.capabilityId,
      actorId: metadata.actorId,
      ownerUid: metadata.ownerUid,
      at: row.at,
      summary: metadata.summary,
    };
  });
}

export function isValidOverrideTransition(decision: IntakeOverrideDecision, reasonCode: string): boolean {
  if (!reasonCode.trim()) return false;
  if (decision === "override_granted") return /^staff_override_/i.test(reasonCode);
  if (decision === "override_denied") return /^policy_/i.test(reasonCode);
  return false;
}
