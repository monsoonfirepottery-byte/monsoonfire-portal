"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyIntakeRisk = classifyIntakeRisk;
exports.hasOverrideGrant = hasOverrideGrant;
exports.buildIntakeQueue = buildIntakeQueue;
exports.isValidOverrideTransition = isValidOverrideTransition;
const hash_1 = require("../../stores/hash");
const RULES = [
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
function classifyIntakeRisk(input) {
    const summary = `${input.previewSummary} ${input.rationale} ${JSON.stringify(input.requestInput)}`.slice(0, 4000);
    const matched = RULES.find((rule) => rule.matcher.test(summary));
    const category = matched?.category ?? "unknown";
    const blocked = category !== "unknown";
    return {
        intakeId: (0, hash_1.stableHashDeep)({
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
function hasOverrideGrant(recentEvents, intakeId) {
    for (const row of recentEvents) {
        if (row.action !== "intake.override_granted")
            continue;
        if (row.metadata?.intakeId === intakeId)
            return true;
    }
    return false;
}
function buildIntakeQueue(recentEvents, limit = 50) {
    const rows = recentEvents.filter((row) => row.action === "intake.routed_to_review").slice(0, Math.max(1, limit));
    return rows.map((row) => {
        const metadata = (row.metadata ?? {});
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
function isValidOverrideTransition(decision, reasonCode) {
    if (!reasonCode.trim())
        return false;
    if (decision === "override_granted")
        return /^staff_override_/i.test(reasonCode);
    if (decision === "override_denied")
        return /^policy_/i.test(reasonCode);
    return false;
}
