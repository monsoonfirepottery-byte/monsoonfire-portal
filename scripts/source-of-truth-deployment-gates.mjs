#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const DEFAULT_MATRIX = resolve(ROOT, "scripts/source-of-truth-deployment-gate-matrix.json");
const DEFAULT_ARTIFACT = "output/source-of-truth-deployment-gates/latest.json";

function run() {
  const args = parseArgs(process.argv.slice(2));
  const strict = args.strict;
  const emitJson = args.json;
  const artifactPath = resolve(ROOT, args.artifact || DEFAULT_ARTIFACT);

  const matrix = loadMatrix(resolve(ROOT, args.matrix || DEFAULT_MATRIX), args.matrixFallback);
  if (!matrix) {
    process.exit(1);
  }

  const requestedPhases = args.phases.length > 0 ? args.phases : ["staging", "beta-pilot", "production", "store-readiness"];
  const normalizedPhases = normalizePhaseSelection(requestedPhases);

  const report = {
    timestamp: new Date().toISOString(),
    strict,
    matrixPath: resolve(ROOT, args.matrix || DEFAULT_MATRIX),
    matrixVersion: matrix.schemaVersion || "unknown",
    phases: normalizedPhases,
    checks: [],
    summary: {
      status: "pass",
      checkedFiles: 0,
      errors: 0,
      warnings: 0,
      pass: 0,
    },
    files: {},
  };

  for (const phase of normalizedPhases) {
    const phaseMatrix = matrix.phases?.[phase];
    if (!phaseMatrix) {
      addFinding(
        report,
        "error",
        phase,
        "unknown-phase",
        `Unknown phase "${phase}".`,
        null,
        ["staging", "beta-pilot", "production", "store-readiness", "beta"],
      );
      continue;
    }
    addPhaseChecks(report, phase, phaseMatrix);
  }

  const errors = report.checks.filter((entry) => entry.severity === "error");
  const warnings = report.checks.filter((entry) => entry.severity === "warning");
  report.summary.errors = errors.length;
  report.summary.warnings = warnings.length;
  report.summary.pass = report.checks.filter((entry) => entry.status === "pass").length;

  if (report.summary.errors > 0 || (strict && report.summary.warnings > 0)) {
    report.summary.status = "fail";
  }

  if (emitJson) {
    mkdirSync(resolve(artifactPath, ".."), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.summary.status === "pass" ? 0 : 1);
  }

  for (const finding of report.checks) {
    const prefix = finding.status === "pass" ? "[PASS]" : `[${finding.severity.toUpperCase()}]`;
    process.stdout.write(`${prefix} [${finding.phase}] ${finding.id}\n`);
    process.stdout.write(`  file: ${finding.file}${finding.line ? `:${finding.line}` : ""}\n`);
    if (finding.message) process.stdout.write(`  ${finding.message}\n`);
    if (finding.category) {
      process.stdout.write(`  category: ${finding.category}\n`);
    }
    if (finding.expected !== undefined || finding.actual !== undefined) {
      process.stdout.write(`  expected: ${JSON.stringify(finding.expected)}\n`);
      process.stdout.write(`  actual: ${JSON.stringify(finding.actual)}\n`);
    }
  }

  if (report.summary.status === "fail") {
    process.exit(1);
  }
}

function addPhaseChecks(report, phaseName, phaseMatrix) {
  const requiredFiles = [...new Set([...(phaseMatrix.requiredFiles || []), ...(phaseMatrix.dependentFiles || [])])];
  for (const file of requiredFiles) {
    const resolved = resolve(ROOT, file);
    if (!existsSync(resolved)) {
      addFinding(
        report,
        "error",
        phaseName,
        `${phaseName}:required-file`,
        `Missing required file: ${file}`,
        "file present",
        file,
        {
          file,
          category: "required-file",
        },
      );
      continue;
    }

    if (!report.files[file]) {
      report.files[file] = {
        present: true,
        touchedBy: [],
      };
      report.summary.checkedFiles += 1;
    }
    report.files[file].touchedBy.push(`${phaseName}:required-file`);
  }

  const checks = Array.isArray(phaseMatrix.checks) ? phaseMatrix.checks : [];
  for (const check of checks) {
    if (!isValidCheck(check)) {
      addFinding(
        report,
        "error",
        phaseName,
        `${phaseName}:invalid-check`,
        `Invalid check definition for phase ${phaseName}: ${check && check.id ? check.id : "unknown"}`,
        "valid check schema",
        check || null,
        {
          file: check?.file || "",
          category: check?.category || "schema",
          line: check?.line,
        },
      );
      continue;
    }

    const resolved = resolve(ROOT, check.file);
    const raw = existsSync(resolved) ? readFileSync(resolved, "utf8") : "";
    const severity = check.severity === "warning" || check.severity === "error" ? check.severity : "error";
    const findingOptions = {
      file: check.file,
      category: check.category || "contract",
      line: check.line || null,
    };

    if (check.kind === "contains") {
      const passed = raw.includes(check.needle);
      addFinding(
        report,
        passed ? "pass" : severity,
        phaseName,
        check.id,
        check.message,
        check.needle,
        passed ? "found" : "missing",
        findingOptions,
      );
      continue;
    }

    if (check.kind === "contains-any") {
      const matched = check.options.find((value) => raw.includes(value));
      addFinding(
        report,
        matched ? "pass" : severity,
        phaseName,
        check.id,
        `${check.message} (${check.options.join(" | ")})`,
        check.options,
        matched || "none",
        findingOptions,
      );
      continue;
    }

    if (check.kind === "regex") {
      let pattern;
      try {
        pattern = new RegExp(check.pattern, "m");
      } catch {
        addFinding(
          report,
          severity,
          phaseName,
          check.id,
          `Invalid regex pattern in deployment gate check: ${check.pattern}`,
          check.pattern,
          "regex compile failed",
          findingOptions,
        );
        continue;
      }

      const matches = Array.from(raw.matchAll(pattern)).map((entry) => entry[0]);
      const passed = matches.length > 0;
      addFinding(
        report,
        passed ? "pass" : severity,
        phaseName,
        check.id,
        check.message,
        check.pattern,
        passed ? matches : [],
        findingOptions,
      );
      continue;
    }

    if (check.kind === "json-field") {
      if (!existsSync(resolved)) {
        addFinding(
          report,
          severity,
          phaseName,
          check.id,
          `JSON field check requires missing file: ${check.file}`,
          check.path,
          "missing",
          findingOptions,
        );
        continue;
      }

      const parsed = parseJsonPayload(resolved, raw);
      if (!parsed.ok) {
        addFinding(report, "error", phaseName, check.id, parsed.error, check.path, "invalid-json", {
          ...findingOptions,
        });
        continue;
      }

      const actual = getJsonPath(parsed.value, check.path);
      const operator = String(check.operator || "equals").trim() || "equals";
      const expected = check.expected;
      const passed = evaluateJsonCondition(operator, expected, actual);
      addFinding(
        report,
        passed ? "pass" : severity,
        phaseName,
        check.id,
        check.message,
        {
          operator,
          path: check.path,
          expected,
        },
        normalizeForOutput(actual),
        findingOptions,
      );
      continue;
    }

    if (check.kind === "json-age") {
      if (!existsSync(resolved)) {
        addFinding(
          report,
          severity,
          phaseName,
          check.id,
          `JSON age check requires missing file: ${check.file}`,
          "fresh artifact",
          "missing",
          findingOptions,
        );
        continue;
      }
      const age = evaluateJsonAge(resolved, check);
      addFinding(
        report,
        age.passed ? "pass" : severity,
        phaseName,
        check.id,
        age.message,
        {
          file: check.file,
          maxAgeMinutes: age.maxAgeMinutes,
        },
        {
          ageMinutes: age.ageMinutes,
          modifiedAt: age.modifiedAt,
        },
        {
          ...findingOptions,
          line: check.line || null,
        },
      );
    }
  }
}

function isValidCheck(check) {
  if (!check || typeof check !== "object") {
    return false;
  }
  if (!["contains", "contains-any", "regex", "json-field", "json-age"].includes(check.kind)) {
    return false;
  }
  if (typeof check.id !== "string" || check.id.trim() === "") {
    return false;
  }
  if (typeof check.file !== "string" || check.file.trim() === "") {
    return false;
  }
  if (check.kind === "contains") {
    return typeof check.needle === "string" && check.needle.length > 0;
  }
  if (check.kind === "contains-any") {
    return Array.isArray(check.options) && check.options.length > 0 && check.options.every((entry) => typeof entry === "string" && entry.length > 0);
  }
  if (check.kind === "json-field") {
    const operator = String(check.operator || "equals").trim();
    if (typeof check.path !== "string" || check.path.length === 0) {
      return false;
    }
    const operators = new Set(["equals", "not-equals", "exists", "truthy", "not-empty", "contains"]);
    if (!operators.has(operator)) {
      return false;
    }
    if (operator !== "exists" && operator !== "truthy" && operator !== "not-empty" && !("expected" in check)) {
      return false;
    }
    return true;
  }
  if (check.kind === "json-age") {
    const hasNumericLimit = Number.isFinite(toNumber(check.maxAgeMinutes))
      || Number.isFinite(toNumber(check.maxAgeHours))
      || Number.isFinite(toNumber(check.maxAgeSeconds));
    return hasNumericLimit;
  }
  return typeof check.pattern === "string" && check.pattern.length > 0;
}

function addFinding(report, status, phase, id, message, expected, actual, options = {}) {
  const normalized = status === "pass" ? "info" : status;
  report.checks.push({
    phase,
    id,
    severity: normalized,
    status: status === "pass" ? "pass" : status,
    message,
    expected,
    actual,
    file: options.file || extractFileForFinding(phase, id),
    ...(options.line ? { line: options.line } : {}),
    ...(options.category ? { category: options.category } : {}),
  });
}

function extractFileForFinding(phase, checkId) {
  const parts = String(checkId || "").split(":", 2);
  if (parts.length > 1 && parts[0] === phase) {
    return parts[1];
  }
  return String(checkId || "phase-check");
}

function parseJsonPayload(filePath, raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `Cannot parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function evaluateJsonCondition(operator, expected, actual) {
  switch (operator) {
    case "equals":
      return normalizeForCompare(actual) === normalizeForCompare(expected);
    case "not-equals":
      return normalizeForCompare(actual) !== normalizeForCompare(expected);
    case "exists":
      return actual !== undefined;
    case "truthy":
      return Boolean(actual);
    case "not-empty":
      if (actual === null || actual === undefined) {
        return false;
      }
      if (Array.isArray(actual)) {
        return actual.length > 0;
      }
      if (typeof actual === "string") {
        return actual.trim().length > 0;
      }
      if (typeof actual === "object") {
        return Object.keys(actual).length > 0;
      }
      return Boolean(actual);
    case "contains":
      return String(actual).includes(String(expected));
    default:
      return false;
  }
}

function evaluateJsonAge(filePath, check) {
  try {
    const maxAgeMinutes = calculateMaxAgeMinutes(check);
    const stat = statSync(filePath);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
    const passed = ageMinutes <= maxAgeMinutes;
    return {
      ok: true,
      passed,
      maxAgeMinutes,
      ageMinutes,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      message: passed
        ? `artifact age ${ageMinutes.toFixed(1)}m <= ${maxAgeMinutes}m`
        : `artifact age ${ageMinutes.toFixed(1)}m > ${maxAgeMinutes}m`,
    };
  } catch (error) {
    return {
      ok: false,
      passed: false,
      message: `Unable to read artifact age for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      ageMinutes: Number.NaN,
      maxAgeMinutes: calculateMaxAgeMinutes(check),
      modifiedAt: "",
    };
  }
}

function calculateMaxAgeMinutes(check) {
  const minutes = toNumber(check.maxAgeMinutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    return minutes;
  }
  const hours = toNumber(check.maxAgeHours);
  if (Number.isFinite(hours) && hours > 0) {
    return hours * 60;
  }
  const seconds = toNumber(check.maxAgeSeconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds / 60;
  }
  return Number.POSITIVE_INFINITY;
}

function normalizeForCompare(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getJsonPath(root, pathValue) {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    return undefined;
  }
  const tokens = raw.match(/[^.[\]]+/g) || [];
  let current = root;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    const indexMatch = /^\d+$/.test(token);
    if (indexMatch && Array.isArray(current)) {
      current = current[Number.parseInt(token, 10)];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

function normalizeForOutput(value) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    artifact: DEFAULT_ARTIFACT,
    matrix: DEFAULT_MATRIX,
    matrixFallback: false,
    phases: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = argv[index + 1] || options.artifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.substring("--artifact=".length);
      continue;
    }
    if (arg === "--matrix") {
      options.matrix = argv[index + 1] || options.matrix;
      index += 1;
      continue;
    }
    if (arg === "--phase") {
      options.phases = parsePhases(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--phase=")) {
      options.phases = parsePhases(arg.substring("--phase=".length));
      continue;
    }
    if (arg === "--matrix-fallback") {
      options.matrixFallback = true;
      continue;
    }
  }

  return options;
}

function normalizePhaseSelection(phases) {
  const canonicalPhase = (value) => {
    const normalized = String(value || "").toLowerCase().trim();
    if (normalized === "beta") return "beta-pilot";
    if (normalized === "beta-pilot" || normalized === "beta_profile") return "beta-pilot";
    if (normalized === "prod") return "production";
    return normalized;
  };

  const unique = new Set();
  for (const phase of phases) {
    const normalized = canonicalPhase(phase);
    if (!normalized) {
      continue;
    }
    if (normalized === "all") {
      unique.add("staging");
      unique.add("beta-pilot");
      unique.add("production");
      unique.add("store-readiness");
      continue;
    }
    unique.add(normalized);
  }
  if (unique.size === 0) {
    unique.add("staging");
    unique.add("beta-pilot");
    unique.add("production");
    unique.add("store-readiness");
  }
  return [...unique];
}

function parsePhases(raw) {
  return String(raw || "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => (entry === "all" ? ["staging", "beta-pilot", "production", "store-readiness"] : [entry]))
    .map((entry) => (entry === "beta" ? "beta-pilot" : entry));
}

function loadMatrix(matrixPath, allowFallback = false) {
  const absolutePath = resolve(ROOT, matrixPath);
  if (!existsSync(absolutePath)) {
    if (!allowFallback) {
      const report = {
        timestamp: new Date().toISOString(),
        strict: true,
        matrixPath: absolutePath,
        phases: [],
        checks: [
          {
            phase: "global",
            id: "matrix-file-missing",
            severity: "error",
            status: "error",
            message: `Source-of-truth deployment matrix missing: ${matrixPath}`,
            expected: matrixPath,
            actual: "missing",
            file: matrixPath,
          },
        ],
        summary: {
          status: "fail",
          errors: 1,
          warnings: 0,
          pass: 0,
          checkedFiles: 0,
        },
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return null;
    }
    return {
      phases: {},
      schemaVersion: "fallback",
    };
  }

  try {
    const raw = readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.phases || typeof parsed.phases !== "object") {
      process.stderr.write(`deployment matrix is malformed: ${matrixPath}\n`);
      return null;
    }
    return parsed;
  } catch (error) {
    process.stderr.write(`failed to read deployment matrix ${matrixPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }
}

run();
