import { printValidationReport, validateEnvContract } from "./env-contract-validator.mjs";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strict = args.has("--strict");
const failOnWarnings = args.has("--fail-on-warnings");

const report = validateEnvContract({ strict: strict || failOnWarnings });
printValidationReport(report, { json: jsonOutput });

if (!report.ok) {
  process.exit(1);
}
