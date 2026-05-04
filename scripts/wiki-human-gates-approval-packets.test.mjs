import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildWikiHumanGateApprovalPackets } from "./wiki-human-gates-approval-packets.mjs";

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

test("wiki human gate approval packets prepare review context without approval effects", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-human-gates-packets-"));
  try {
    const source = "wiki/00_source_index/extracted-facts.jsonl";
    writeJsonl(join(root, source), [
      {
        claimId: "claim_policy",
        claimKind: "policy",
        truthStatus: "known_truth",
        confidence: 0.82,
        subjectKey: "policy-doc:docs/policies/accessibility.md",
        predicateKey: "available",
        objectText: "policy needs approval",
        owner: "policy",
        authorityClass: "policy",
        agentAllowedUse: "cite_only",
        requiresHumanApproval: true,
        humanApprovalReason: "policy-or-customer-facing-claim",
        sourceRefs: [
          {
            sourcePath: "docs/policies/accessibility.md",
            lineStart: 1,
            lineEnd: 42,
            refRole: "supports",
          },
        ],
      },
      {
        claimId: "claim_ready",
        claimKind: "procedure",
        subjectKey: "package-script:wiki:validate",
        objectText: "not gated",
        requiresHumanApproval: false,
      },
    ]);

    const report = buildWikiHumanGateApprovalPackets({
      repoRoot: root,
      source,
      artifact: "output/wiki/human-gates-approval-packets.json",
      markdown: "output/wiki/human-gates-approval-packets.md",
    });

    assert.equal(report.schema, "wiki-human-gates-approval-packets.v1");
    assert.equal(report.servesSystem, "studio-brain");
    assert.equal(report.operatingLayerImpact, "prepares_human_review_without_promotion");
    assert.equal(report.approvalEffects, "none");
    assert.equal(report.summary.claims, 1);
    assert.equal(report.summary.approvalEffects, "none");
    assert.equal(report.packets[0].reviewStatus, "pending_human_review");
    assert.deepEqual(report.packets[0].allowedOutcomes, ["approve_with_citation", "reject", "keep_gated"]);
    assert.match(report.packets[0].nonApprovalGuard, /does not approve/);
    assert.equal(report.packets[0].evidence.primarySourcePath, "docs/policies/accessibility.md");
    assert.equal(report.packets[0].evidence.sourceRefs[0].lineStart, 1);
    assert.match(readFileSync(join(root, "output/wiki/human-gates-approval-packets.md"), "utf8"), /Approval effects: none/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki human gate approval packets fail for missing extracted facts", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-human-gates-packets-missing-"));
  try {
    assert.throws(
      () =>
        buildWikiHumanGateApprovalPackets({
          repoRoot: root,
          source: "missing.jsonl",
          artifact: "output/wiki/human-gates-approval-packets.json",
          markdown: "output/wiki/human-gates-approval-packets.md",
        }),
      /does not exist/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
