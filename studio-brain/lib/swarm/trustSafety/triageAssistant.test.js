"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const triageAssistant_1 = require("./triageAssistant");
(0, node_test_1.default)("buildTriageSuggestion ranks safety terms as high severity", () => {
    const suggestion = (0, triageAssistant_1.buildTriageSuggestion)({
        note: "User posted threat language and possible self-harm instruction.",
        targetTitle: "Thread",
        targetType: "blog_post",
    });
    strict_1.default.equal(suggestion.severity, "high");
    strict_1.default.equal(suggestion.category, "safety");
    strict_1.default.equal(suggestion.suggestionOnly, true);
});
(0, node_test_1.default)("buildTriageSuggestion never returns auto action intent", () => {
    const suggestion = (0, triageAssistant_1.buildTriageSuggestion)({
        note: "No clear violation details.",
        targetTitle: "Update",
        targetType: "studio_update",
    });
    strict_1.default.equal(suggestion.suggestionOnly, true);
    strict_1.default.ok(suggestion.reasonCode.length > 0);
});
(0, node_test_1.default)("computeSuggestionFeedbackStats calculates mismatch rate", () => {
    const rows = [
        {
            id: "1",
            at: "2026-02-13T00:00:00.000Z",
            actorType: "staff",
            actorId: "s1",
            action: "trust_safety.triage_suggestion_feedback",
            rationale: "accepted",
            target: "local",
            approvalState: "approved",
            inputHash: "a",
            outputHash: null,
            metadata: { decision: "accepted", mismatch: false },
        },
        {
            id: "2",
            at: "2026-02-13T00:01:00.000Z",
            actorType: "staff",
            actorId: "s1",
            action: "trust_safety.triage_suggestion_feedback",
            rationale: "rejected",
            target: "local",
            approvalState: "approved",
            inputHash: "b",
            outputHash: null,
            metadata: { decision: "rejected", mismatch: true },
        },
    ];
    const stats = (0, triageAssistant_1.computeSuggestionFeedbackStats)(rows);
    strict_1.default.equal(stats.accepted, 1);
    strict_1.default.equal(stats.rejected, 1);
    strict_1.default.equal(stats.mismatchRatePct, 50);
});
