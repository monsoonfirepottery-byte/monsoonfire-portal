import test from "node:test";
import assert from "node:assert/strict";
import { buildTriageSuggestion, computeSuggestionFeedbackStats } from "./triageAssistant";
import type { AuditEvent } from "../../stores/interfaces";

test("buildTriageSuggestion ranks safety terms as high severity", () => {
  const suggestion = buildTriageSuggestion({
    note: "User posted threat language and possible self-harm instruction.",
    targetTitle: "Thread",
    targetType: "blog_post",
  });
  assert.equal(suggestion.severity, "high");
  assert.equal(suggestion.category, "safety");
  assert.equal(suggestion.suggestionOnly, true);
});

test("buildTriageSuggestion never returns auto action intent", () => {
  const suggestion = buildTriageSuggestion({
    note: "No clear violation details.",
    targetTitle: "Update",
    targetType: "studio_update",
  });
  assert.equal(suggestion.suggestionOnly, true);
  assert.ok(suggestion.reasonCode.length > 0);
});

test("computeSuggestionFeedbackStats calculates mismatch rate", () => {
  const rows: AuditEvent[] = [
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
  const stats = computeSuggestionFeedbackStats(rows);
  assert.equal(stats.accepted, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.mismatchRatePct, 50);
});
