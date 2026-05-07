import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  artifactEvidence,
  buildPacket,
  parseArgs,
  statusFromSummary
} from "./work_verification_packet.mjs";

const schema = JSON.parse(readFileSync(resolve("schemas/ops/work-verification-packet.v1.schema.json"), "utf8"));

function withTempRepo(callback) {
  const dir = mkdtempSync(join(tmpdir(), "work-verification-"));
  try {
    callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parseArgs accepts no-write and ledger options", () => {
  const options = parseArgs(["--ledger", "output/example.jsonl", "--last=3", "--base", "origin/main", "--json", "--no-write"]);

  assert.equal(options.last, 3);
  assert.equal(options.base, "origin/main");
  assert.equal(options.json, true);
  assert.equal(options.write, false);
  assert.ok(options.ledger.endsWith("output\\example.jsonl") || options.ledger.endsWith("output/example.jsonl"));
});

test("artifactEvidence records metadata without exposing content", () => {
  withTempRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "output", "ops"), { recursive: true });
    writeFileSync(join(repoRoot, "output", "ops", "artifact.json"), JSON.stringify({
      schema: "example.v1",
      status: "pass",
      generatedAt: "2026-05-07T00:00:00.000Z",
      secretLike: "do-not-echo"
    }));

    const evidence = artifactEvidence("output/ops/artifact.json", repoRoot);

    assert.equal(evidence.exists, true);
    assert.equal(evidence.schema, "example.v1");
    assert.equal(evidence.status, "pass");
    assert.equal(evidence.generatedAt, "2026-05-07T00:00:00.000Z");
    assert.equal(evidence.shareable, true);
    assert.equal(Object.values(evidence).includes("do-not-echo"), false);

    mkdirSync(join(repoRoot, "secrets"), { recursive: true });
    writeFileSync(join(repoRoot, "secrets", "api-key.json"), JSON.stringify({ schema: "secret.v1", value: "do-not-echo" }));
    const sensitive = artifactEvidence("secrets/api-key.json", repoRoot);

    assert.equal(sensitive.exists, true);
    assert.equal(sensitive.shareable, false);
    assert.equal(sensitive.sha256, null);
    assert.equal(sensitive.schema, null);
    assert.equal(sensitive.path.includes("api-key"), false);
    assert.equal(Object.values(sensitive).includes("do-not-echo"), false);
  });
});

test("buildPacket summarizes ledger commands and artifacts", () => {
  withTempRepo((repoRoot) => {
    mkdirSync(join(repoRoot, "output", "ops", "work-verification"), { recursive: true });
    writeFileSync(join(repoRoot, "output", "ops", "work-verification", "report.json"), JSON.stringify({
      schema: "report.v1",
      status: "pass",
      generatedAt: "2026-05-07T00:00:00.000Z"
    }));
    const row = {
      schema: "studiobrain-admin-slice-ledger.v1",
      sliceId: "slice-1",
      runId: "run",
      lane: "portal-ops",
      title: "Test slice",
      status: "completed",
      changedFiles: ["scripts/example.mjs", "secrets/prod-token.txt"],
      commands: [{ command: "node --test example", status: "pass" }],
      artifacts: [{ path: "output/ops/work-verification/report.json" }],
      usefulness: { score: 0.8 }
    };
    writeFileSync(join(repoRoot, "ledger.jsonl"), `${JSON.stringify(row)}\n`);

    const packet = buildPacket({
      repoRoot,
      ledger: join(repoRoot, "ledger.jsonl"),
      last: 5,
      base: "origin/main",
      outputDir: join(repoRoot, "output", "ops", "work-verification"),
      includeGit: false
    });

    assert.equal(packet.schema, schema.properties.schema.const);
    assert.equal(packet.status, "warn");
    assert.equal(packet.summary.sliceCount, 1);
    assert.equal(packet.summary.commandCount, 1);
    assert.equal(packet.summary.sensitivePathCount, 1);
    assert.equal(packet.artifacts[0].schema, "report.v1");
    assert.equal(packet.changedFiles.includes("scripts/example.mjs"), true);
    assert.equal(packet.changedFiles.some((path) => path.startsWith("[redacted-sensitive-path:")), true);
  });
});

test("statusFromSummary fails on command failures and warns on missing evidence", () => {
  assert.equal(statusFromSummary({ commandFailures: 1, missingArtifacts: 0, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0 }), "fail");
  assert.equal(statusFromSummary({ commandFailures: 0, artifactFailures: 1, missingArtifacts: 0, artifactWarnings: 0, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0 }), "fail");
  assert.equal(statusFromSummary({ commandFailures: 0, artifactFailures: 0, missingArtifacts: 1, artifactWarnings: 0, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0 }), "warn");
  assert.equal(statusFromSummary({ commandFailures: 0, artifactFailures: 0, missingArtifacts: 0, artifactWarnings: 1, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0 }), "warn");
  assert.equal(statusFromSummary({ commandFailures: 0, artifactFailures: 0, missingArtifacts: 0, artifactWarnings: 0, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0, sensitivePathCount: 1 }), "warn");
  assert.equal(statusFromSummary({ commandFailures: 0, artifactFailures: 0, missingArtifacts: 0, artifactWarnings: 0, commandWarnings: 0, commandSkipped: 0, noOpRows: 0, gitDirtyFiles: 0, sensitivePathCount: 0 }), "pass");
});
