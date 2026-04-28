import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDbProbeReport,
  contentDenyReason,
  detectContradictions,
  extractClaims,
  generateContextPack,
  sourceDenyReason,
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
