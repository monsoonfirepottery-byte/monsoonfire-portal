import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { auditWikiStartupPack } from "./wiki-startup-pack-audit.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function contextPack(overrides = {}) {
  return {
    schema: "wiki-context-pack-report.v1",
    status: "pass",
    contextPack: {
      schema: "wiki-context-pack.v1",
      contextPackId: "ctx_test",
      packKey: "studio-brain-wiki",
      snapshotHash: "snapshot_test",
      operatingLayerRole: "compiled_operating_layer",
      servesSystem: "studio-brain",
      memoryRelationship: "not_a_competing_memory_source",
      sourceOfTruthMode: "compiled_from_repo_and_postgres_claims",
      generatedText: "# pack\n\n- verified claim\n",
      items: [{ itemId: "claim_verified", itemType: "claim" }],
      warnings: [],
      budget: {
        chars: 25,
        verifiedClaims: 1,
        warningCount: 0,
        startupWarningItems: 0,
        totalWarningItems: 0,
        excludedWarningBacklogItems: 0,
        humanApprovalClaimCount: 0,
        activeContradictionCount: 0,
        outcomeVerdict: "useful",
      },
      ...overrides,
    },
  };
}

test("wiki startup pack audit passes for small verified sourced packs", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-pack-pass-"));
  try {
    writeJson(join(root, "output/wiki/context-refresh.json"), contextPack());
    writeJsonl(join(root, "wiki/00_source_index/extracted-facts.jsonl"), [
      {
        claimId: "claim_verified",
        status: "VERIFIED",
        requiresHumanApproval: false,
        sourceRefs: [{ sourcePath: "docs/runbooks/example.md", lineStart: 1, lineEnd: 2 }],
      },
    ]);

    const report = auditWikiStartupPack({
      repoRoot: root,
      artifact: "output/audit.json",
      markdown: "output/audit.md",
      maxChars: 100,
    });

    assert.equal(report.schema, "wiki-startup-pack-audit.v1");
    assert.equal(report.status, "pass");
    assert.equal(report.startupEligible, true);
    assert.equal(report.metrics.includedUnverifiedClaims, 0);
    assert.equal(report.operatingLayer.memoryRelationship, "not_a_competing_memory_source");
    assert.match(readFileSync(join(root, "output/audit.md"), "utf8"), /Startup eligible: true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki startup pack audit fails when human-gated claims are included", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-pack-human-gate-"));
  try {
    writeJson(join(root, "output/wiki/context-refresh.json"), contextPack());
    writeJsonl(join(root, "wiki/00_source_index/extracted-facts.jsonl"), [
      {
        claimId: "claim_verified",
        status: "VERIFIED",
        requiresHumanApproval: true,
        sourceRefs: [{ sourcePath: "docs/policies/example.md", lineStart: 1, lineEnd: 2 }],
      },
    ]);

    const report = auditWikiStartupPack({
      repoRoot: root,
      artifact: "output/audit.json",
      markdown: "output/audit.md",
    });

    assert.equal(report.status, "fail");
    assert.equal(report.startupEligible, false);
    assert.equal(report.findings.some((finding) => finding.code === "context-pack-includes-human-gated-claims"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki startup pack audit warns when pack is honest but not startup-eligible", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-pack-warn-"));
  try {
    writeJson(join(root, "output/wiki/context-refresh.json"), contextPack({
      generatedText: "# pack\n\nWarnings only.\n",
      items: [],
      warnings: [{ type: "unverified-claims-excluded-summary", total: 80, shown: 10, omitted: 70 }],
      budget: {
        chars: 24,
        verifiedClaims: 0,
        warningCount: 1,
        startupWarningItems: 80,
        totalWarningItems: 80,
        excludedWarningBacklogItems: 80,
        activeContradictionCount: 0,
        outcomeVerdict: "insufficient_real_usage",
      },
    }));
    writeJsonl(join(root, "wiki/00_source_index/extracted-facts.jsonl"), [
      { claimId: "claim_gated", status: "EXTRACTED", requiresHumanApproval: true, sourceRefs: [] },
    ]);

    const report = auditWikiStartupPack({
      repoRoot: root,
      artifact: "output/audit.json",
      markdown: "output/audit.md",
      maxWarningItems: 50,
    });

    assert.equal(report.status, "warn");
    assert.equal(report.startupEligible, false);
    assert.equal(report.metrics.humanGatedClaims, 1);
    assert.equal(report.findings.some((finding) => finding.code === "no-verified-startup-claims"), true);
    assert.equal(report.findings.some((finding) => finding.code === "startup-warning-volume-too-high"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki startup pack audit allows bounded verified core with broad excluded backlog", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-pack-bounded-core-"));
  try {
    writeJson(join(root, "output/wiki/context-refresh.json"), contextPack({
      warnings: [
        { type: "unverified-claims-excluded-summary", total: 80, shown: 10, omitted: 70 },
        { type: "unverified-claim-excluded", claimId: "claim_gated", requiresHumanApproval: true },
      ],
      budget: {
        chars: 80,
        verifiedClaims: 1,
        warningCount: 2,
        startupWarningItems: 2,
        totalWarningItems: 2,
        excludedWarningBacklogItems: 80,
        humanApprovalClaimCount: 1,
        activeContradictionCount: 0,
        outcomeVerdict: "useful",
      },
    }));
    writeJsonl(join(root, "wiki/00_source_index/extracted-facts.jsonl"), [
      {
        claimId: "claim_verified",
        status: "VERIFIED",
        requiresHumanApproval: false,
        sourceRefs: [{ sourcePath: "docs/runbooks/example.md", lineStart: 1, lineEnd: 2 }],
      },
      { claimId: "claim_gated", status: "EXTRACTED", requiresHumanApproval: true, sourceRefs: [] },
    ]);

    const report = auditWikiStartupPack({
      repoRoot: root,
      artifact: "output/audit.json",
      markdown: "output/audit.md",
      maxWarningItems: 50,
    });

    assert.equal(report.status, "pass");
    assert.equal(report.startupEligible, true);
    assert.equal(report.metrics.startupWarningItems, 2);
    assert.equal(report.metrics.excludedWarningBacklogItems, 80);
    assert.equal(report.findings.some((finding) => finding.code === "startup-warning-volume-too-high"), false);
    assert.equal(report.findings.some((finding) => finding.code === "human-gated-claims-await-approval"), true);
    assert.equal(report.strictGate.status, "pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
