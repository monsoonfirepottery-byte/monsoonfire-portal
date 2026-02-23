import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACT_PATH = resolve(__dirname, "../.env.contract.schema.json");

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);
const PLACEHOLDER_MATCHERS = [
  /change-?me/i,
  /todo/i,
  /placeholder/i,
  /replace[_-]?with/i,
  /^\s*<.*>\s*$/,
];
const SENSITIVE_ENFORCED_VARS = new Set([
  "STUDIO_BRAIN_ADMIN_TOKEN",
  "STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY",
  "STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY",
  "PGPASSWORD",
  "REDIS_PASSWORD",
]);

function loadContract() {
  if (!existsSync(CONTRACT_PATH)) {
    throw new Error(`Missing env contract at ${CONTRACT_PATH}`);
  }
  const raw = readFileSync(CONTRACT_PATH, "utf8");
  return JSON.parse(raw);
}

function isPlaceholderValue(value) {
  return PLACEHOLDER_MATCHERS.some((pattern) => pattern.test(value));
}

function toBoolean(name, value) {
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  throw new Error(`${name} must be boolean (true/false/1/0/yes/no/on/off)`);
}

function parseNumber(name, value, meta) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`${name} must be numeric`);
  }

  if (Number.isInteger(meta?.integer) || meta.type === "integer") {
    if (!Number.isInteger(parsed)) {
      throw new Error(`${name} must be an integer`);
    }
  }

  if (typeof meta.min === "number" && parsed < meta.min) {
    throw new Error(`${name} must be >= ${meta.min}`);
  }
  if (typeof meta.max === "number" && parsed > meta.max) {
    throw new Error(`${name} must be <= ${meta.max}`);
  }
  return parsed;
}

function parseString(name, value, meta) {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  if (meta.enum && !meta.enum.includes(value)) {
    throw new Error(`${name} must be one of: ${meta.enum.join(", ")}`);
  }
  if (meta.minLength && value.length < meta.minLength) {
    throw new Error(`${name} must be at least ${meta.minLength} characters`);
  }
  return value;
}

function parseValue(name, rawValue, meta) {
  const value = String(rawValue);
  const type = meta.type;
  if (type === "boolean") return toBoolean(name, value);
  if (type === "integer" || type === "number") return parseNumber(name, value, { ...meta, integer: type === "integer" });
  if (type === "url") {
    parseString(name, value, meta);
    try {
      new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL`);
    }
    return value;
  }
  return parseString(name, value, meta);
}

function hasTemplateVar(value) {
  return /\$\{[^}]+\}/.test(value);
}

export function validateEnvContract({ strict = false } = {}) {
  const contract = loadContract();
  const vars = contract?.variables || {};
  const errors = [];
  const warnings = [];
  const seen = new Set(Object.keys(process.env));

  for (const [name, meta] of Object.entries(vars)) {
    const isRequired = Boolean(meta.required);
    const rawValue = process.env[name];
    const hasValue = typeof rawValue === "string" && rawValue.trim().length > 0;

    if (isRequired && !hasValue) {
      errors.push(`${name} is required by contract`);
      continue;
    }

    if (!rawValue) {
      continue;
    }

    try {
      parseValue(name, rawValue, meta);
      if (
        (isPlaceholderValue(rawValue) || hasTemplateVar(rawValue)) &&
        (strict || meta.sensitive || SENSITIVE_ENFORCED_VARS.has(name))
      ) {
        warnings.push(`${name} is configured with a placeholder or template value; set a concrete value before runtime.`);
      } else if (isPlaceholderValue(rawValue) || hasTemplateVar(rawValue)) {
        warnings.push(`${name} looks like a placeholder value`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const unknown = [...seen]
    .filter((key) => key.startsWith("STUDIO_BRAIN_") || key.startsWith("PG") || key.startsWith("REDIS_"))
    .filter((key) => !vars[key]);
  if (unknown.length > 0) {
    warnings.push(`Unknown contract-prefixed variables were set: ${unknown.join(", ")}`);
  }

  if (strict && warnings.length > 0) {
    errors.push(...warnings);
  }

  const ok = errors.length === 0;
  const fallback = strict ? "blocked" : "warned";
  const report = {
    ok,
    valid: ok,
    status: ok ? "pass" : "fail",
    strictMode: strict,
    fallbackOnFail: fallback,
    schema: contract.version || "unknown",
    errors,
    warnings,
    checked: Object.keys(vars).length,
    contractPath: CONTRACT_PATH,
  };
  return report;
}

export function printValidationReport(report, { json = false, destination = process.stdout } = {}) {
  if (json) {
    destination.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (report.ok) {
    destination.write(`studio-brain env contract (${report.contractPath}) PASS\n`);
    if (report.warnings.length > 0) {
      destination.write("WARNINGS:\n");
      report.warnings.forEach((warning) => destination.write(`  - ${warning}\n`));
    } else {
      destination.write("No contract warnings.\n");
    }
    return;
  }

  destination.write(`studio-brain env contract (${report.contractPath}) FAIL (${report.errors.length} errors)\n`);
  report.errors.forEach((entry) => destination.write(`  - ${entry}\n`));
  if (report.warnings.length > 0) {
    destination.write("WARNINGS:\n");
    report.warnings.forEach((warning) => destination.write(`  - ${warning}\n`));
  }
}
