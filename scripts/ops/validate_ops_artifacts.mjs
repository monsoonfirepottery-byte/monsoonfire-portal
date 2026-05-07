#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "artifact-validation");
const DEFAULT_ARTIFACTS = [
  {
    id: "tooling-quality-report",
    artifact: "output/ops/tooling-quality/tooling-quality-latest.json",
    schema: "schemas/ops/tooling-quality-report.v1.schema.json",
  },
  {
    id: "installed-tool-inventory",
    artifact: "output/ops/effectivity/installed-tool-inventory-latest.json",
    schema: "schemas/ops/installed-tool-inventory.v1.schema.json",
  },
  {
    id: "admin-effectivity-audit",
    artifact: "output/ops/effectivity/admin-effectivity-audit-latest.json",
    schema: "schemas/ops/admin-effectivity-audit.v1.schema.json",
  },
  {
    id: "ops-work-packet",
    artifact: "output/ops/swarm/latest-work-packet.json",
    schema: "schemas/ops/ops-work-packet.v1.schema.json",
  },
  {
    id: "swarm-lane-preflight",
    artifact: "output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json",
    schema: "schemas/ops/swarm-lane-preflight.v1.schema.json",
  },
  {
    id: "artifact-schema-validation",
    artifact: "output/ops/artifact-validation/artifact-schema-validation-latest.json",
    schema: "schemas/ops/artifact-schema-validation.v1.schema.json",
  },
];

function usage() {
  return `Studio Brain ops artifact schema validator

Usage:
  node scripts/ops/validate_ops_artifacts.mjs [--json] [--write]

Options:
  --json                    Print JSON report.
  --write                   Write timestamped and latest reports under output/ops/artifact-validation.
  --output-dir <path>       Default: output/ops/artifact-validation.
  --artifact <id:path:schema>  Validate an additional artifact/schema pair.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(REPO_ROOT, path)).replace(/\\/g, "/");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readFlagValue(argv, index, flag) {
  const value = argv[index];
  if (value === flag) {
    if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (value.startsWith(`${flag}=`)) {
    return { matched: true, value: value.slice(flag.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    artifacts: [...DEFAULT_ARTIFACTS],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    const outputDir = readFlagValue(argv, index, "--output-dir");
    if (outputDir.matched) {
      options.outputDir = resolve(REPO_ROOT, outputDir.value);
      index = outputDir.nextIndex;
      continue;
    }
    const artifact = readFlagValue(argv, index, "--artifact");
    if (artifact.matched) {
      const [id, artifactPath, schemaPath] = artifact.value.split(":");
      if (!id || !artifactPath || !schemaPath) throw new Error("--artifact must use id:path:schema.");
      options.artifacts.push({ id, artifact: artifactPath, schema: schemaPath });
      index = artifact.nextIndex;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function validateJsonSchema(value, schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => typeMatches(value, type))) {
      errors.push(`${path}: expected type ${expected.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.format === "date-time" && typeof value === "string" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: expected date-time string`);
  }

  if ((typeof value === "number" || Number.isInteger(value)) && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path}: expected minimum ${schema.minimum}`);
  }

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => validateJsonSchema(value, candidate, path).length === 0)) {
    errors.push(`${path}: did not match anyOf schema`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: missing required property`);
    }
    const properties = schema.properties || {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(value[key], propertySchema, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key}: unexpected property`);
      }
    }
  }

  return errors;
}

function validateArtifact(definition) {
  const artifactPath = resolve(REPO_ROOT, definition.artifact);
  const schemaPath = resolve(REPO_ROOT, definition.schema);
  const check = {
    id: clean(definition.id),
    artifact: repoRelative(artifactPath),
    schema: repoRelative(schemaPath),
    status: "missing",
    errors: [],
  };

  if (!existsSync(schemaPath)) {
    return { ...check, status: "fail", errors: [`schema missing: ${repoRelative(schemaPath)}`] };
  }
  if (!existsSync(artifactPath)) {
    return check;
  }

  try {
    const artifact = readJson(artifactPath);
    const schema = readJson(schemaPath);
    const errors = validateJsonSchema(artifact, schema);
    return { ...check, status: errors.length ? "fail" : "pass", errors };
  } catch (error) {
    return {
      ...check,
      status: "fail",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function buildReport(options = {}) {
  const generatedAt = nowIso();
  const checks = options.artifacts.map(validateArtifact);
  const failed = checks.filter((check) => check.status === "fail").length;
  const missing = checks.filter((check) => check.status === "missing").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const status = failed > 0 ? "fail" : missing > 0 ? "warn" : "pass";
  const runId = `ops-artifact-validation-${generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  return {
    schema: "studiobrain-ops-artifact-schema-validation.v1",
    generatedAt,
    runId,
    status,
    readOnly: true,
    summary: {
      checks: checks.length,
      passed,
      missing,
      failed,
    },
    checks,
  };
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const report = buildReport(options);
  const artifact = resolve(options.outputDir, `${report.runId}.json`);
  const latest = resolve(options.outputDir, "artifact-schema-validation-latest.json");
  if (options.write) {
    writeJson(artifact, report);
    writeJson(latest, report);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ...report,
      artifacts: options.write ? { jsonPath: artifact, latestPath: latest } : null,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`ops artifact schema validation: ${report.status}\n`);
    process.stdout.write(`checks: ${report.summary.checks}, passed=${report.summary.passed}, missing=${report.summary.missing}, failed=${report.summary.failed}\n`);
  }
  if (report.status === "fail") process.exitCode = 1;
  return report;
}

export { buildReport, validateJsonSchema };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
