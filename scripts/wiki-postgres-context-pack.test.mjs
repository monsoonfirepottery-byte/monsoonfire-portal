import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeWikiCompetitionRisk,
  extractClaims,
  generateContextPack,
  renderContextPack,
} from "./lib/wiki-postgres-utils.mjs";

test("wiki context pack declares operating-layer boundaries and excludes unverified claims", () => {
  const pack = generateContextPack([
    {
      claimId: "claim_verified",
      status: "VERIFIED",
      subjectKey: "source-of-truth:example",
      objectText: "Verified context is safe for planning.",
      agentAllowedUse: "planning_context",
      sourceRefs: [{ sourcePath: "docs/example.md", lineStart: 1 }],
    },
    {
      claimId: "claim_unverified",
      status: "EXTRACTED",
      subjectKey: "policy-doc:example",
      objectText: "Unverified context must stay out of included items.",
      agentAllowedUse: "planning_context",
      requiresHumanApproval: true,
    },
  ], [], { outcomeUsefulness: { verdict: "useful", total: 3, helpful: 3, staleOrMisleading: 0, totalMinutesSaved: 15, usefulnessScore: 1 } });

  assert.equal(pack.operatingLayerRole, "compiled_operating_layer");
  assert.equal(pack.servesSystem, "studio-brain");
  assert.equal(pack.memoryRelationship, "not_a_competing_memory_source");
  assert.deepEqual(pack.truthBoundary.operationalClaimsRequireStatus, ["VERIFIED", "OPERATIONAL_TRUTH"]);
  assert.deepEqual(pack.items.map((item) => item.itemId), ["claim_verified"]);
  assert.equal(pack.budget.totalClaims, 2);
  assert.equal(pack.budget.unverifiedClaimExcludedCount, 1);
  assert.equal(pack.budget.humanApprovalClaimCount, 1);
  assert.match(pack.generatedText, /## Operating Layer Contract/);
  assert.match(pack.generatedText, /unverified wiki claims: planning_hint_only/);
  assert.match(renderContextPack(pack), /memory_relationship: not_a_competing_memory_source/);

  const risk = analyzeWikiCompetitionRisk([
    { claimId: "claim_verified", status: "VERIFIED", requiresHumanApproval: false },
    { claimId: "claim_unverified", status: "EXTRACTED", requiresHumanApproval: true },
  ], pack, []);
  assert.equal(risk.status, "contained");
  assert.equal(risk.includedUnverifiedClaims, 0);
});

test("wiki decision frontmatter becomes operational context without human-gate leakage", () => {
  const sourcePath = "wiki/40_decisions/2026-05-04-test-decision.md";
  const content = `---
schema: wiki-page.v1
id: wiki:decision:test-operational-context
title: Test Operational Context
kind: decision
status: OPERATIONAL_TRUTH
confidence: 0.96
owner: policy
source_refs: ["docs/epics/example.md#L1"]
last_verified: 2026-05-04
last_changed_by: codex
agent_allowed_use: operational_context
---

# Test Operational Context

Studio Brain may use this existing wiki decision as operational context.
`;
  const index = {
    tenantScope: "monsoonfire-main",
    sources: [{
      sourceId: "src_decision",
      sourcePath,
      authorityClass: "repo",
    }],
    chunks: [{
      sourceId: "src_decision",
      chunkId: "chk_decision",
      sourcePath,
      lineStart: 1,
      lineEnd: 18,
      content,
    }],
  };

  const extraction = extractClaims(index);
  assert.equal(extraction.claims.length, 1);
  assert.equal(extraction.claims[0].status, "OPERATIONAL_TRUTH");
  assert.equal(extraction.claims[0].agentAllowedUse, "operational_context");
  assert.equal(extraction.claims[0].requiresHumanApproval, false);
  assert.equal(extraction.claims[0].metadata.statusSource, "wiki-decision-frontmatter");
  assert.deepEqual(extraction.claims[0].sourceRefs.map((ref) => ref.sourcePath), [sourcePath, "docs/epics/example.md"]);

  const pack = generateContextPack(extraction.claims, []);
  assert.equal(pack.budget.operationalTruthClaims, 1);
  assert.equal(pack.items.length, 1);
  assert.match(pack.generatedText, /Studio Brain may use this existing wiki decision as operational context/);
});
