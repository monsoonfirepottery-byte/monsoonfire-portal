import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeWikiCompetitionRisk,
  detectContradictions,
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
  assert.equal(pack.budget.excludedWarningBacklogItems, 1);
  assert.match(pack.generatedText, /## Operating Layer Contract/);
  assert.match(pack.generatedText, /unverified wiki claims: planning_hint_only/);
  assert.match(pack.generatedText, /human-gated-claims-summary/);
  assert.match(renderContextPack(pack), /memory_relationship: not_a_competing_memory_source/);

  const risk = analyzeWikiCompetitionRisk([
    { claimId: "claim_verified", status: "VERIFIED", requiresHumanApproval: false },
    { claimId: "claim_unverified", status: "EXTRACTED", requiresHumanApproval: true },
  ], pack, []);
  assert.equal(risk.status, "contained");
  assert.equal(risk.includedUnverifiedClaims, 0);
});

test("wiki context pack keeps broad excluded warnings as a compact startup digest", () => {
  const claims = [
    {
      claimId: "claim_verified",
      status: "OPERATIONAL_TRUTH",
      subjectKey: "wiki:decision:membership-eol",
      objectText: "Membership and reservation systems are decommissioning in May 2026 with EOL on May 31, 2026.",
      agentAllowedUse: "operational_context",
      sourceRefs: [{ sourcePath: "wiki/40_decisions/membership.md", lineStart: 1 }],
    },
    ...Array.from({ length: 120 }, (_, index) => ({
      claimId: `claim_unverified_${index}`,
      status: "EXTRACTED",
      claimKind: index % 2 === 0 ? "policy" : "procedure",
      subjectKey: index % 2 === 0 ? `policy-doc:docs/policies/${index}.md` : `package-script:wiki:test-${index}`,
      objectText: `Unverified wiki backlog claim ${index}`,
      agentAllowedUse: "planning_context",
      requiresHumanApproval: index % 2 === 0,
      sourceRefs: [{ sourcePath: index % 2 === 0 ? "docs/policies/example.md" : "package.json" }],
    })),
  ];

  const pack = generateContextPack(claims, [], {
    outcomeUsefulness: { verdict: "useful", total: 3, helpful: 3, staleOrMisleading: 0, totalMinutesSaved: 0, usefulnessScore: 1 },
  });

  assert.equal(pack.items.length, 1);
  assert.equal(pack.budget.totalWarningItems < 50, true);
  assert.equal(pack.budget.excludedWarningBacklogItems, 120);
  assert.match(pack.generatedText, /unverified-claims-excluded-category/);
  assert.doesNotMatch(pack.generatedText, /claim_unverified_119/);
  assert.equal(pack.generatedText.length < 4000, true);
});

test("stale membership-required language cannot become startup operational truth", () => {
  const claims = [
    {
      claimId: "claim_safe_eol",
      status: "OPERATIONAL_TRUTH",
      subjectKey: "wiki:decision:membership-eol",
      objectText: "Monsoon Fire is decommissioning membership and reservation systems during May 2026. Both systems reach end-of-life on May 31, 2026.",
      agentAllowedUse: "operational_context",
      sourceRefs: [{ sourcePath: "wiki/40_decisions/membership-eol.md", lineStart: 1 }],
    },
    {
      claimId: "claim_stale_membership",
      status: "OPERATIONAL_TRUTH",
      subjectKey: "monsoon-fire:membership-required",
      objectText: "Membership is required before booking reservations.",
      agentAllowedUse: "operational_context",
      sourceRefs: [{ sourcePath: "website/membership.html", lineStart: 1 }],
    },
  ];

  const pack = generateContextPack(claims, [], {
    outcomeUsefulness: { verdict: "useful", total: 3, helpful: 3, staleOrMisleading: 0, totalMinutesSaved: 0, usefulnessScore: 1 },
  });

  assert.deepEqual(pack.items.map((item) => item.itemId), ["claim_safe_eol"]);
  assert.equal(pack.budget.staleMembershipOperationalExcludedCount, 1);
  assert.equal(pack.budget.membershipEolOperationalTruthClaims, 1);
  assert.match(pack.generatedText, /stale-membership-operational-claim-excluded/);
});

test("membership contradiction scan detects old membership-required copy if it reappears", () => {
  const index = {
    tenantScope: "monsoonfire-main",
    sources: [
      { sourceId: "src_old", sourcePath: "website/membership.html", authorityClass: "repo" },
      { sourceId: "src_new", sourcePath: "wiki/40_decisions/membership-eol.md", authorityClass: "policy" },
    ],
    chunks: [
      {
        sourceId: "src_old",
        chunkId: "chk_old",
        sourcePath: "website/membership.html",
        lineStart: 1,
        lineEnd: 2,
        content: "Membership is required before booking reservations. Active studio members can access member-only benefits.",
      },
      {
        sourceId: "src_new",
        chunkId: "chk_new",
        sourcePath: "wiki/40_decisions/membership-eol.md",
        lineStart: 1,
        lineEnd: 2,
        content: "Monsoon Fire membership and reservation systems are being decommissioned in May 2026.",
      },
    ],
  };

  const scan = detectContradictions(index, []);
  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "membership-required-vs-decommission"), true);
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
