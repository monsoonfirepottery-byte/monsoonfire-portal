import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { listWikiHumanGates } from "./wiki-human-gates-list.mjs";

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

test("wiki human gates list groups approval-required claims", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-human-gates-"));
  try {
    const source = "wiki/00_source_index/extracted-facts.jsonl";
    writeJsonl(join(root, source), [
      {
        claimId: "claim_policy",
        claimKind: "policy",
        subjectKey: "policy-doc:docs/policies/accessibility.md",
        requiresHumanApproval: true,
        objectText: "policy needs approval",
        sourceRefs: [{ sourcePath: "docs/policies/accessibility.md" }],
      },
      {
        claimId: "claim_script",
        claimKind: "procedure",
        subjectKey: "package-script:policy:sot:check",
        requiresHumanApproval: true,
        objectText: "script needs approval",
        sourceRefs: [{ sourcePath: "package.json" }],
      },
      {
        claimId: "claim_ready",
        claimKind: "procedure",
        subjectKey: "package-script:wiki:validate",
        requiresHumanApproval: false,
        objectText: "not gated",
        sourceRefs: [{ sourcePath: "package.json" }],
      },
    ]);

    const report = listWikiHumanGates({
      repoRoot: root,
      source,
      artifact: "output/wiki/human-gates.json",
      markdown: "output/wiki/human-gates.md",
    });

    assert.equal(report.schema, "wiki-human-gates-report.v1");
    assert.equal(report.summary.claims, 2);
    assert.equal(report.summary.byCategory["policy-doc"], 1);
    assert.equal(report.summary.byCategory["package-procedure"], 1);
    assert.deepEqual(report.items.map((item) => item.claimId).sort(), ["claim_policy", "claim_script"]);
    assert.match(readFileSync(join(root, "output/wiki/human-gates.md"), "utf8"), /claim_policy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki human gates list fails for missing extracted facts", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-human-gates-missing-"));
  try {
    assert.throws(
      () =>
        listWikiHumanGates({
          repoRoot: root,
          source: "missing.jsonl",
          artifact: "output/wiki/human-gates.json",
          markdown: "output/wiki/human-gates.md",
        }),
      /does not exist/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
