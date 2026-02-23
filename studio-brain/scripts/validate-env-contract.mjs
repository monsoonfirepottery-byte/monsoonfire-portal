import { printValidationReport, validateEnvContract } from "./env-contract-validator.mjs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const studioBrainRoot = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strict = args.has("--strict");
const failOnWarnings = args.has("--fail-on-warnings");

const envSource = resolveEnvSource();
if (envSource.path) {
  dotenv.config({ path: envSource.path });
}

const report = validateEnvContract({ strict: strict || failOnWarnings });
if (!jsonOutput) {
  process.stdout.write(`env source: ${envSource.label}\n`);
}
printValidationReport(report, { json: jsonOutput });

if (!report.ok) {
  process.exit(1);
}

function resolveEnvSource() {
  const explicitFile = process.env.STUDIO_BRAIN_ENV_FILE;
  if (explicitFile) {
    const explicitPath = resolve(studioBrainRoot, explicitFile);
    return {
      path: existsSync(explicitPath) ? explicitPath : null,
      label: explicitFile,
      source: "explicit",
    };
  }

  const preferred = resolve(studioBrainRoot, ".env");
  if (existsSync(preferred)) {
    return { path: preferred, label: ".env", source: "default" };
  }

  const fallback = resolve(studioBrainRoot, ".env.example");
  if (existsSync(fallback)) {
    return { path: fallback, label: ".env.example", source: "fallback" };
  }

  return {
    path: null,
    label: "(process-env-only)",
    source: "process-env-only",
  };
}
