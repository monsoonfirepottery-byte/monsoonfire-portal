import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildDbProbeReport,
  buildExportDriftReport,
  buildIdleTaskQueueReport,
  contentDenyReason,
  detectContradictions,
  extractClaims,
  generateContextPack,
  summarizeWikiOutcomeUsefulness,
  sourceDenyReason,
  validateClaimTransition,
  validateWikiScaffold,
} from "./lib/wiki-postgres-utils.mjs";

function syntheticIndex(chunks) {
  const sources = [];
  const indexedChunks = chunks.map((chunk, index) => {
    const sourcePath = chunk.sourcePath || `docs/source-${index}.md`;
    let source = sources.find((entry) => entry.sourcePath === sourcePath);
    if (!source) {
      source = {
        sourceId: `src_${sources.length}`,
        tenantScope: "test",
        sourcePath,
        sourceKind: "repo-file",
        authorityClass: chunk.authorityClass || "repo",
      };
      sources.push(source);
    }
    return {
      sourceId: source.sourceId,
      chunkId: `chk_${index}`,
      tenantScope: "test",
      sourcePath,
      lineStart: chunk.lineStart || 1,
      lineEnd: chunk.lineEnd || 1,
      headingPath: chunk.headingPath || [],
      content: chunk.content,
      contentHash: `hash_${index}`,
    };
  });

  return {
    schema: "wiki-source-index.v1",
    tenantScope: "test",
    sources,
    chunks: indexedChunks,
    denied: [],
  };
}

test("wiki scaffold and schemas are present", () => {
  const report = validateWikiScaffold();

  assert.equal(report.status, "pass");
  assert.equal(report.summary.failed, 0);
});

test("source screens deny secret paths and token-like content", () => {
  assert.match(sourceDenyReason("secrets/studio-brain.env"), /^not-approved-source-root|^deny-prefix:secrets\//);
  assert.match(contentDenyReason(`"refresh_${"token"}": "abcdefghijklmnopqrstuvwxyz1234567890"`), /^secret-pattern:/);
  assert.match(contentDenyReason(`Authorization: ${"Bearer"} abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN`), /^secret-pattern:/);
});

test("deterministic extraction gives AGENTS guardrails source refs and stable fingerprints", () => {
  const index = syntheticIndex([
    {
      sourcePath: "AGENTS.md",
      authorityClass: "policy",
      content: "- Agents must cite source before modifying verified wiki pages.\n- Prefer dry-run mode before writes.",
      lineStart: 10,
      lineEnd: 11,
    },
  ]);

  const first = extractClaims(index, { tenantScope: "test" });
  const second = extractClaims(index, { tenantScope: "test" });

  assert.equal(first.claims.length, 2);
  assert.deepEqual(first.claims.map((claim) => claim.claimFingerprint), second.claims.map((claim) => claim.claimFingerprint));
  assert.equal(first.claims.every((claim) => claim.sourceRefs.length === 1), true);
  assert.equal(first.claims.every((claim) => claim.status === "EXTRACTED"), true);
});

test("package script extraction does not silently evict matching scripts", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const expectedScripts = Object.keys(pkg.scripts || {})
    .filter((name) => /^(studio:ops|open-memory|wiki:|audit:|policy:|codex:)/.test(name));
  const index = syntheticIndex([
    {
      sourcePath: "package.json",
      content: JSON.stringify({ scripts: pkg.scripts }, null, 2),
      lineStart: 1,
      lineEnd: 80,
    },
  ]);

  const extraction = extractClaims(index, { tenantScope: "test" });
  const extractedScripts = new Set(
    extraction.claims
      .filter((claim) => claim.subjectKey.startsWith("package-script:"))
      .map((claim) => claim.subjectKey.replace(/^package-script:/, "")),
  );

  assert.equal(expectedScripts.length > 160, true);
  assert.deepEqual(expectedScripts.filter((name) => !extractedScripts.has(name)), []);
});

test("context packs include verified truth and warn on excluded claims", () => {
  const verified = {
    claimId: "claim_verified",
    status: "VERIFIED",
    agentAllowedUse: "planning_context",
    objectText: "Verified Studio Brain context is available.",
    subjectKey: "studio-brain",
  };
  const extracted = {
    claimId: "claim_extracted",
    status: "EXTRACTED",
    agentAllowedUse: "planning_context",
    objectText: "Unverified claim should not be included.",
    subjectKey: "unverified",
  };

  const pack = generateContextPack([verified, extracted], [], { tenantScope: "test" });

  assert.match(pack.generatedText, /Verified Studio Brain context is available/);
  assert.doesNotMatch(pack.generatedText, /Unverified claim should not be included/);
  assert.equal(pack.items.length, 1);
  assert.equal(pack.warnings.some((warning) => warning.claimId === "claim_extracted"), true);
  assert.equal(pack.warnings[0].type, "unverified-claims-excluded-summary");
  assert.equal(pack.warnings[0].total, 1);
  assert.equal(pack.budget.totalWarningItems, 1);
});

test("context pack warning samples report omitted uncertainty", () => {
  const verified = {
    claimId: "claim_verified",
    status: "VERIFIED",
    agentAllowedUse: "planning_context",
    objectText: "Verified Studio Brain context is available.",
    subjectKey: "studio-brain",
  };
  const extractedClaims = Array.from({ length: 12 }, (_, index) => ({
    claimId: `claim_extracted_${index}`,
    status: "EXTRACTED",
    agentAllowedUse: "planning_context",
    objectText: `Unverified claim ${index}.`,
    subjectKey: `unverified:${index}`,
  }));
  const contradiction = {
    contradictionId: "contradiction_one",
    status: "open",
    conflictKey: "sample-conflict",
    severity: "medium",
  };

  const pack = generateContextPack([verified, ...extractedClaims], [contradiction], { tenantScope: "test" });

  assert.match(pack.generatedText, /unverified-claims-excluded-summary: 12 total; showing 10; omitted 2/);
  assert.match(pack.generatedText, /active-contradictions-summary: 1 total; showing 1; omitted 0/);
  assert.equal(pack.budget.warningCount, 13);
  assert.equal(pack.budget.totalWarningItems, 13);
  assert.equal(pack.budget.unverifiedClaimExcludedCount, 12);
  assert.equal(pack.budget.activeContradictionCount, 1);
});

test("service pricing policy becomes operational context without website edits", () => {
  const index = syntheticIndex([
    {
      sourcePath: "docs/policies/service-pricing-and-membership-decommission.md",
      authorityClass: "policy",
      content: [
        "Monsoon Fire has decommissioned all membership tiers.",
        "Kiln firing service pricing has three lanes: low fire, mid fire, and custom.",
        "Each kiln service lane is priced by the half shelf. Monsoon Fire does not use volume pricing.",
      ].join("\n"),
    },
  ]);

  const extraction = extractClaims(index, { tenantScope: "test" });
  const pack = generateContextPack(extraction.claims, [], { tenantScope: "test" });

  assert.equal(extraction.claims.length, 2);
  assert.equal(extraction.claims.every((claim) => claim.status === "OPERATIONAL_TRUTH"), true);
  assert.equal(extraction.claims.every((claim) => claim.agentAllowedUse === "operational_context"), true);
  assert.match(pack.generatedText, /decommissioned all membership tiers/);
  assert.match(pack.generatedText, /low fire, mid fire, and custom/);
  assert.match(pack.generatedText, /docs\/policies\/service-pricing-and-membership-decommission\.md#L1/);
});

test("context pack labels resolved contradiction as source drift", () => {
  const winner = {
    claimId: "claim_membership_truth",
    status: "OPERATIONAL_TRUTH",
    agentAllowedUse: "operational_context",
    objectText: "Membership tiers are decommissioned.",
    subjectKey: "monsoon-fire:membership-tiers",
  };
  const contradiction = {
    contradictionId: "contradiction_membership",
    status: "open",
    conflictKey: "membership-required-vs-decommission",
    severity: "hard",
    claimAId: null,
    claimBId: winner.claimId,
    recommendedAction: "Update stale sources.",
  };

  const pack = generateContextPack([winner], [contradiction], { tenantScope: "test" });

  assert.equal(pack.warnings[0].type, "active-contradictions-summary");
  assert.equal(pack.warnings.find((warning) => warning.type === "source-drift-after-operational-truth")?.conflictKey, "membership-required-vs-decommission");
  assert.match(pack.generatedText, /source-drift-after-operational-truth: membership-required-vs-decommission/);
  assert.doesNotMatch(pack.generatedText, /open-contradiction: membership-required-vs-decommission/);
});

test("claim lifecycle guard blocks operational truth without approval metadata", () => {
  const candidate = {
    status: "OPERATIONAL_TRUTH",
    metadata: {},
  };

  assert.equal(validateClaimTransition(null, candidate).allowed, false);
  assert.equal(validateClaimTransition({ status: "OPERATIONAL_TRUTH" }, { status: "EXTRACTED", metadata: {} }).allowed, false);
  assert.equal(
    validateClaimTransition(null, {
      status: "OPERATIONAL_TRUTH",
      metadata: { approvedBy: "human-owner", approvedAt: "2026-04-28" },
    }).allowed,
    true,
  );
});

test("blocked source drift is first-class when stale evidence is isolated to paused redesign surfaces", () => {
  const index = syntheticIndex([
    {
      sourcePath: "website/data/faq.json",
      content: "Memberships are required before customers may access studio services.",
    },
    {
      sourcePath: "docs/policies/service-pricing-and-membership-decommission.md",
      authorityClass: "policy",
      content: "Monsoon Fire has decommissioned all membership tiers and uses straight pricing for services only.",
    },
  ]);
  const extraction = extractClaims(index, { tenantScope: "test" });
  const scan = detectContradictions(index, extraction.claims);
  const contradiction = scan.contradictions.find((entry) => entry.conflictKey === "membership-required-vs-decommission");
  const pack = generateContextPack(extraction.claims, scan.contradictions, {
    tenantScope: "test",
    outcomeUsefulness: { total: 0, helpful: 0, staleOrMisleading: 0, blocked: 0, totalMinutesSaved: 0, usefulnessScore: 0, verdict: "insufficient_real_usage" },
  });

  assert.equal(contradiction.status, "blocked");
  assert.equal(contradiction.metadata.blockedReason, "losing-side evidence is isolated to paused website/portal redesign surfaces");
  assert.match(pack.generatedText, /blocked-source-drift-after-operational-truth: membership-required-vs-decommission/);
});

test("contradiction scan emits review records instead of editing claims", () => {
  const index = syntheticIndex([
    {
      sourcePath: "docs/policies/membership.md",
      content: "Memberships are required before customers may access the studio.",
    },
    {
      sourcePath: "docs/plans/current-business-plan.md",
      content: "Memberships are being phased out and the access model will remove membership gates.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.summary.hard, 1);
  assert.equal(scan.contradictions[0].conflictKey, "membership-required-vs-decommission");
  assert.match(scan.contradictions[0].markdownPath, /wiki\/50_contradictions\//);
  assert.deepEqual(scan.contradictions[0].metadata.evidencePathCounts.a, [
    { sourcePath: "docs/policies/membership.md", count: 1 },
  ]);
  assert.deepEqual(scan.contradictions[0].metadata.evidencePathCounts.b, [
    { sourcePath: "docs/plans/current-business-plan.md", count: 1 },
  ]);
  assert.deepEqual(scan.contradictions[0].metadata.evidenceSurfaceCounts.a, [
    { surface: "docs", count: 1 },
  ]);
});

test("membership contradiction scan ignores generic current-plan and credit language", () => {
  const index = syntheticIndex([
    {
      sourcePath: "scripts/lib/planning-control-plane.mjs",
      content: "The agent critiques the current plan and proposed concrete edits before revision.",
    },
    {
      sourcePath: "docs/policies/payments-refunds.md",
      content: "Confirmed studio-side firing mistakes may be resolved with generous firing credits after review.",
    },
    {
      sourcePath: "docs/sprints/SPRINT_06_DEVICE_RELEASE.md",
      content: "Staff-targeted notification excludes member-only users.",
    },
    {
      sourcePath: "docs/SCHEMA_SUPPORT.md",
      content: 'category: "Account" | "Membership" | "Billing" (required)',
    },
    {
      sourcePath: "docs/plans/current-business-plan.md",
      content: "Memberships are being phased out and the access model will remove membership gates.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "membership-required-vs-decommission"), false);
});

test("membership contradiction scan keeps member-only feature evidence", () => {
  const index = syntheticIndex([
    {
      sourcePath: "website/data/faq.json",
      content: "Potter of the Month is a member-only feature rather than an open nomination.",
    },
    {
      sourcePath: "docs/plans/current-business-plan.md",
      content: "Memberships are being phased out and the access model will remove membership gates.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "membership-required-vs-decommission"), true);
});

test("membership contradiction scan keeps membership-context current-plan evidence", () => {
  const index = syntheticIndex([
    {
      sourcePath: "docs/SCHEMA_SUPPORT.md",
      content: "How do I change membership? Send a request with your current plan and the change you want.",
    },
    {
      sourcePath: "docs/plans/current-business-plan.md",
      content: "Memberships are being phased out and the access model will remove membership gates.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "membership-required-vs-decommission"), true);
});

test("volume contradiction scan ignores guardrail and no-volume policy text", () => {
  const index = syntheticIndex([
    {
      sourcePath: "docs/runbooks/PRICING_COMMUNITY_SHELF_QA.md",
      content: "Repo grep for `by volume`, `useVolumePricing`, `volumeIn3`, `per cubic inch` returns no billing-path matches.",
    },
    {
      sourcePath: "scripts/check-pricing-and-intake-policy.mjs",
      content: "assertNoMatches('volume field usage', 'useVolumePricing|volumeIn3', sourceTargets);",
    },
    {
      sourcePath: "website/data/faq.json",
      content: "We do not bill by kiln volume and no volume pricing is used.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "volume-pricing-vs-no-volume-billing"), false);
});

test("volume contradiction scan still catches active positive volume pricing", () => {
  const index = syntheticIndex([
    {
      sourcePath: "website/data/faq.json",
      content: "Custom loads are priced by volume for larger pieces.",
    },
    {
      sourcePath: "docs/policies/service-pricing-and-membership-decommission.md",
      content: "Monsoon Fire does not use volume pricing or cubic-inch pricing.",
    },
  ]);

  const scan = detectContradictions(index, []);

  assert.equal(scan.contradictions.some((entry) => entry.conflictKey === "volume-pricing-vs-no-volume-billing"), true);
});

test("export drift report compares deterministic wiki exports without writing", () => {
  const index = syntheticIndex([
    {
      sourcePath: "docs/policies/service-pricing-and-membership-decommission.md",
      authorityClass: "policy",
      content: "Monsoon Fire has decommissioned all membership tiers.",
    },
  ]);
  const extraction = extractClaims(index, { tenantScope: "test" });
  const report = buildExportDriftReport({
    tenantScope: "test",
    index,
    extraction,
    scan: detectContradictions(index, extraction.claims),
    outcomeUsefulness: { total: 0, helpful: 0, staleOrMisleading: 0, blocked: 0, totalMinutesSaved: 0, usefulnessScore: 0, verdict: "insufficient_real_usage" },
  });

  assert.equal(report.schema, "wiki-export-drift-report.v1");
  assert.ok(report.exports.some((entry) => entry.path.endsWith("wiki/00_source_index/source-map.md")));
  assert.equal(report.manifestRows.every((row) => row.exportHash), true);
});

test("idle task queue makes blocked contradictions visible but not ready", () => {
  const index = syntheticIndex([
    {
      sourcePath: "website/data/faq.json",
      content: "Memberships are required before customers may access studio services.",
    },
    {
      sourcePath: "docs/policies/service-pricing-and-membership-decommission.md",
      authorityClass: "policy",
      content: "Monsoon Fire has decommissioned all membership tiers and uses straight pricing for services only.",
    },
  ]);
  const extraction = extractClaims(index, { tenantScope: "test" });
  const scan = detectContradictions(index, extraction.claims);
  const queue = buildIdleTaskQueueReport({
    tenantScope: "test",
    index,
    extraction,
    scan,
    outcomeUsefulness: { total: 0, helpful: 0, staleOrMisleading: 0, blocked: 0, totalMinutesSaved: 0, usefulnessScore: 0, verdict: "insufficient_real_usage" },
  });

  assert.equal(queue.schema, "wiki-idle-task-queue-report.v1");
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.tasks.some((task) => task.taskKey === "wiki-contradiction:membership-required-vs-decommission" && task.status === "blocked"), true);
  const contextTask = queue.tasks.find((task) => task.taskKey === "wiki-context-pack-refresh");
  assert.equal(contextTask.metadata.totalWarningItems, 1);
  assert.equal(contextTask.metadata.activeContradictionCount, 1);
  assert.match(queue.lease.strategy, /FOR UPDATE SKIP LOCKED/);
});

test("context pack usefulness scores only wiki-relevant outcomes", () => {
  const summary = summarizeWikiOutcomeUsefulness([
    { outcome: "helpful", minutesSaved: 12, notes: "Wiki context pack avoided a stale contradiction." },
    { outcome: "stale", minutesSaved: 0, notes: "Wiki source drift was misleading." },
    { outcome: "helpful", minutesSaved: 6, notes: "Unrelated runtime contract packet." },
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.helpful, 1);
  assert.equal(summary.staleOrMisleading, 1);
});

test("db probe report covers hot wiki read paths", () => {
  const report = buildDbProbeReport();
  const names = report.queries.map((query) => query.name);

  assert.deepEqual(names, [
    "context-pack-latest",
    "verified-claim-search",
    "open-contradictions",
    "ready-idle-tasks",
    "source-freshness",
  ]);
});
