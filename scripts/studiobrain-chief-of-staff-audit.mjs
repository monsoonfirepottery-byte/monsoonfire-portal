#!/usr/bin/env node

import { resolve } from "node:path";

import { DEFAULT_REPORT_PATH, runChiefOfStaffAudit } from "./lib/studiobrain-chief-of-staff-audit.mjs";

function parseArgs(argv) {
  const parsed = {
    json: false,
    cleanupFixture: true,
    writeReport: true,
    reportPath: DEFAULT_REPORT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--keep-fixture") {
      parsed.cleanupFixture = false;
      continue;
    }
    if (arg === "--no-report") {
      parsed.writeReport = false;
      continue;
    }
    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--report requires a file path.");
      }
      parsed.reportPath = resolve(String(next));
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Studio Brain Chief-of-Staff audit",
          "",
          "Usage:",
          "  node ./scripts/studiobrain-chief-of-staff-audit.mjs [--json] [--report <path>] [--keep-fixture] [--no-report]",
          "",
          `Default report: ${DEFAULT_REPORT_PATH}`,
          "Fixture mode only. This audit does not touch live Studio Brain state.",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runChiefOfStaffAudit({
    reportPath: args.reportPath,
    writeReport: args.writeReport,
    cleanupFixture: args.cleanupFixture,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`chief-of-staff audit: ${report.status}\n`);
    if (report.summary) {
      process.stdout.write(`open loop: ${report.summary.openLoopId} -> ${report.summary.finalOpenLoopStatus}\n`);
      process.stdout.write(`initiative: ${report.summary.initialInitiativeState} -> ${report.summary.finalInitiativeState}\n`);
      process.stdout.write(`checkins: ${report.summary.checkinActions.join(", ")}\n`);
    }
    if (args.writeReport && report.reportPath) {
      process.stdout.write(`report: ${report.reportPath}\n`);
    }
    if (report.error?.message) {
      process.stdout.write(`error: ${report.error.message}\n`);
    }
  }

  if (report.status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
