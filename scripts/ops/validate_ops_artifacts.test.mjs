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
    assert.equal(pass.status, "pass");
    assert.equal(fail.status, "fail");
    assert.ok(fail.checks[0].errors.some((error) => error.includes("expected const")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
