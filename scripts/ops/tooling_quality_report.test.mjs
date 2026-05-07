import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildReport,
  parseArgs,
  parseActionlintOutput,
  parseShellCheckJson,
  statusFromSections
} from "./tooling_quality_report.mjs";

const schema = JSON.parse(readFileSync(resolve("schemas/ops/tooling-quality-report.v1.schema.json"), "utf8"));

function assertReportContract(report) {
  for (const key of schema.required) assert.ok(Object.hasOwn(report, key), `missing ${key}`);
  assert.equal(report.schema, schema.properties.schema.const);
  assert.ok(schema.properties.mode.enum.includes(report.mode));
  assert.ok(schema.properties.status.enum.includes(report.status));
  assert.equal(typeof report.allowInstall, "boolean");
  assert.equal(typeof report.summary.checkedFiles, "number");
  assert.equal(typeof report.summary.findings, "number");
  assert.equal(typeof report.summary.skipped, "number");
  for (const section of report.sections) {
    assert.ok(schema.properties.sections.items.properties.id.enum.includes(section.id));
    assert.ok(schema.properties.sections.items.properties.status.enum.includes(section.status));
    assert.equal(typeof section.tool, "string");
    assert.equal(typeof section.checkedFiles, "number");
    assert.ok(Array.isArray(section.findings));
    for (const finding of section.findings) {
      assert.equal(typeof finding.code, "string");
      assert.equal(typeof finding.message, "string");
    }
  }
}

test("parseArgs accepts explicit modes and allow-install flag", () => {
  const options = parseArgs(["--mode", "actionlint", "--allow-install", "--limit=2", "--json"]);

  assert.equal(options.mode, "actionlint");
  assert.equal(options.allowInstall, true);
  assert.equal(options.limit, 2);
  assert.equal(options.json, true);
});

test("parseActionlintOutput extracts structured workflow findings", () => {
  const findings = parseActionlintOutput(".github/workflows/ci.yml:12:7: property \"foo\" is not defined [expression]");

  assert.deepEqual(findings, [
    {
      file: ".github/workflows/ci.yml",
      line: 12,
      column: 7,
      code: "expression",
      message: "property \"foo\" is not defined"
    }
  ]);
});

test("parseShellCheckJson extracts structured findings", () => {
  const findings = parseShellCheckJson(JSON.stringify([
    {
      file: "scripts/example.sh",
      line: 3,
      column: 7,
      level: "error",
      code: 1017,
      message: "Literal carriage return."
    }
  ]));

  assert.deepEqual(findings, [
    {
      file: "scripts/example.sh",
      line: 3,
      column: 7,
      code: "SC1017",
      severity: "error",
      message: "Literal carriage return."
    }
  ]);
});

test("statusFromSections preserves worst section state", () => {
  assert.equal(statusFromSections([{ status: "pass" }, { status: "warn" }]), "warn");
  assert.equal(statusFromSections([{ status: "warn" }, { status: "fail" }]), "fail");
  assert.equal(statusFromSections([{ status: "pass" }]), "pass");
});

test("buildReport emits the documented tooling quality schema", () => {
  const report = buildReport({
    mode: "shell-lf",
    json: true,
    write: false,
    outputDir: resolve("output/ops/tooling-quality"),
    allowInstall: false,
    limit: 1
  });

  assertReportContract(report);
  assert.equal(report.mode, "shell-lf");
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].id, "shell-lf");
});
