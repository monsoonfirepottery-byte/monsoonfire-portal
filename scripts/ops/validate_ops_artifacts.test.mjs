import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReport, validateJsonSchema } from "./validate_ops_artifacts.mjs";

test("validateJsonSchema handles required properties, const, enum, arrays, and unexpected properties", () => {
  const schema = {
    type: "object",
    required: ["schema", "items"],
    properties: {
      schema: { const: "example.v1" },
      status: { enum: ["pass", "warn"] },
      items: { type: "array", items: { type: "integer", minimum: 1 } },
    },
    additionalProperties: false,
  };

  assert.deepEqual(validateJsonSchema({ schema: "example.v1", status: "pass", items: [1, 2] }, schema), []);
  const errors = validateJsonSchema({ schema: "wrong", status: "fail", items: [0], extra: true }, schema);
  assert.ok(errors.some((error) => error.includes("expected const")));
  assert.ok(errors.some((error) => error.includes("expected one of")));
  assert.ok(errors.some((error) => error.includes("expected minimum")));
  assert.ok(errors.some((error) => error.includes("unexpected property")));
});

test("buildReport treats missing artifacts as warnings and schema mismatch as failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-schema-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const validPath = join(dir, "valid.json");
    const invalidPath = join(dir, "invalid.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema"],
      properties: { schema: { const: "artifact.v1" } },
      additionalProperties: false,
    }));
    writeFileSync(validPath, JSON.stringify({ schema: "artifact.v1" }));
    writeFileSync(invalidPath, JSON.stringify({ schema: "artifact.v2" }));

    const warn = buildReport({ artifacts: [{ id: "missing", artifact: join(dir, "missing.json"), schema: schemaPath }] });
    const pass = buildReport({ artifacts: [{ id: "valid", artifact: validPath, schema: schemaPath }] });
    const fail = buildReport({ artifacts: [{ id: "invalid", artifact: invalidPath, schema: schemaPath }] });

    assert.equal(warn.status, "warn");
    assert.equal(warn.summary.warned, 0);
    assert.equal(pass.status, "pass");
    assert.equal(fail.status, "fail");
    assert.ok(fail.checks[0].errors.some((error) => error.includes("expected const")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport warns when an artifact is schema-valid but stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-stale-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const stalePath = join(dir, "stale.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema", "generatedAt"],
      properties: {
        schema: { const: "artifact.v1" },
        generatedAt: { type: "string", format: "date-time" }
      },
      additionalProperties: false,
    }));
    writeFileSync(stalePath, JSON.stringify({ schema: "artifact.v1", generatedAt: "2026-05-07T08:00:00.000Z" }));

    const report = buildReport({
      artifacts: [{ id: "stale", artifact: stalePath, schema: schemaPath }],
      now: "2026-05-07T12:00:00.000Z",
      maxAgeHours: 1
    });

    assert.equal(report.status, "warn");
    assert.equal(report.summary.warned, 1);
    assert.ok(report.checks[0].warnings.some((warning) => warning.includes("generatedAt is stale")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport applies per-artifact freshness thresholds before global defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-tier-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const stalePath = join(dir, "stale.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema", "generatedAt"],
      properties: {
        schema: { const: "artifact.v1" },
        generatedAt: { type: "string", format: "date-time" }
      },
      additionalProperties: false,
    }));
    writeFileSync(stalePath, JSON.stringify({ schema: "artifact.v1", generatedAt: "2026-05-07T08:00:00.000Z" }));

    const report = buildReport({
      artifacts: [{ id: "loop", artifact: stalePath, schema: schemaPath, freshnessTier: "loop", maxAgeHours: 3 }],
      now: "2026-05-07T12:00:00.000Z",
      maxAgeHours: 24
    });

    assert.equal(report.status, "warn");
    assert.equal(report.checks[0].freshnessTier, "loop");
    assert.equal(report.checks[0].maxAgeHours, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport carries registry producer and consumer metadata into checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-metadata-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const artifactPath = join(dir, "artifact.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema"],
      properties: { schema: { const: "artifact.v1" } },
      additionalProperties: false,
    }));
    writeFileSync(artifactPath, JSON.stringify({ schema: "artifact.v1" }));

    const report = buildReport({
      artifacts: [{
        id: "metadata",
        artifact: artifactPath,
        schema: schemaPath,
        freshnessTier: "loop",
        producerCommand: "node scripts/ops/example.mjs --json --write",
        producerStep: "example",
        safeWriteRoot: "output/ops/example",
        consumers: ["consumer-a"],
        requiredFor: ["review"],
      }]
    });

    assert.equal(report.status, "pass");
    assert.equal(report.checks[0].producerStep, "example");
    assert.equal(report.checks[0].safeWriteRoot, "output/ops/example");
    assert.deepEqual(report.checks[0].consumers, ["consumer-a"]);
    assert.deepEqual(report.checks[0].requiredFor, ["review"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport fails when latest artifactPath points nowhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-latest-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const latestPath = join(dir, "latest.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema", "generatedAt", "artifactPath"],
      properties: {
        schema: { const: "artifact.v1" },
        generatedAt: { type: "string", format: "date-time" },
        artifactPath: { type: "string" }
      },
      additionalProperties: false,
    }));
    writeFileSync(latestPath, JSON.stringify({
      schema: "artifact.v1",
      generatedAt: "2026-05-07T12:00:00.000Z",
      artifactPath: "output/ops/missing-timestamped-artifact.json"
    }));

    const report = buildReport({
      artifacts: [{ id: "latest", artifact: latestPath, schema: schemaPath }],
      now: "2026-05-07T12:00:00.000Z",
      maxAgeHours: 24
    });

    assert.equal(report.status, "fail");
    assert.ok(report.checks[0].errors.some((error) => error.includes("artifactPath points to a missing artifact")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport warns when a git-scoped artifact was generated from an older head", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-git-head-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const latestPath = join(dir, "latest.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema", "generatedAt", "scope"],
      properties: {
        schema: { const: "artifact.v1" },
        generatedAt: { type: "string", format: "date-time" },
        scope: {
          type: "object",
          required: ["head"],
          properties: { head: { type: "string" } },
          additionalProperties: false,
        }
      },
      additionalProperties: false,
    }));
    writeFileSync(latestPath, JSON.stringify({
      schema: "artifact.v1",
      generatedAt: "2026-05-07T12:00:00.000Z",
      scope: { head: "old1234" }
    }));

    const report = buildReport({
      artifacts: [{ id: "git-head", artifact: latestPath, schema: schemaPath, gitHeadField: "scope.head" }],
      now: "2026-05-07T12:00:00.000Z",
      currentGitHead: "new5678",
      maxAgeHours: 24
    });

    assert.equal(report.status, "warn");
    assert.equal(report.checks[0].gitHeadField, "scope.head");
    assert.equal(report.checks[0].artifactGitHead, "old1234");
    assert.equal(report.checks[0].currentGitHead, "new5678");
    assert.ok(report.checks[0].warnings.some((warning) => warning.includes("artifact git head is stale")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReport accepts matching long and short git heads", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-artifact-git-head-match-"));
  try {
    const schemaPath = join(dir, "schema.json");
    const latestPath = join(dir, "latest.json");
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      required: ["schema", "generatedAt", "scope"],
      properties: {
        schema: { const: "artifact.v1" },
        generatedAt: { type: "string", format: "date-time" },
        scope: {
          type: "object",
          required: ["head"],
          properties: { head: { type: "string" } },
          additionalProperties: false,
        }
      },
      additionalProperties: false,
    }));
    writeFileSync(latestPath, JSON.stringify({
      schema: "artifact.v1",
      generatedAt: "2026-05-07T12:00:00.000Z",
      scope: { head: "abc123456789" }
    }));

    const report = buildReport({
      artifacts: [{ id: "git-head", artifact: latestPath, schema: schemaPath, gitHeadField: "scope.head" }],
      now: "2026-05-07T12:00:00.000Z",
      currentGitHead: "abc12345",
      maxAgeHours: 24
    });

    assert.equal(report.status, "pass");
    assert.equal(report.checks[0].warnings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
