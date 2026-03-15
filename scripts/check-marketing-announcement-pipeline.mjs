#!/usr/bin/env node

/* eslint-disable no-console */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildAnnouncementArtifacts,
  defaultAnnouncementSourceDir,
  writeAnnouncementArtifacts,
} from "./lib/marketing-announcements.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    strict: argv.includes("--strict"),
    sourceDir: (() => {
      const index = argv.indexOf("--source-dir");
      return index >= 0 ? argv[index + 1] : defaultAnnouncementSourceDir;
    })(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = await buildAnnouncementArtifacts({ sourceDir: options.sourceDir });
  const outputs = await writeAnnouncementArtifacts(artifacts);

  const syncScript = resolve(process.cwd(), "functions", "scripts", "sync-marketing-announcements.mjs");
  const dryRun = await execFileAsync(process.execPath, [syncScript, "--dry-run", "--json"], {
    cwd: process.cwd(),
  });
  const syncResult = JSON.parse(String(dryRun.stdout || "{}"));
  const websitePayload = JSON.parse(await readFile(outputs.websiteJsonPath, "utf8"));
  const portalPayload = JSON.parse(await readFile(outputs.portalPayloadPath, "utf8"));

  const checks = [
    {
      ok: existsSync(outputs.websiteJsonPath),
      key: "website_json_written",
      message: "website/data/announcements.json was generated",
    },
    {
      ok: existsSync(outputs.portalPayloadPath),
      key: "portal_payload_written",
      message: "portal sync payload artifact was generated",
    },
    {
      ok: Array.isArray(websitePayload.items) && Array.isArray(websitePayload.homepageTeasers),
      key: "website_payload_shape",
      message: "website payload exposes items and homepage teasers",
    },
    {
      ok: Array.isArray(portalPayload.items),
      key: "portal_payload_shape",
      message: "portal payload exposes announcement rows",
    },
    {
      ok: syncResult.mode === "dry-run" && syncResult.writeAttempts === 0,
      key: "sync_dry_run",
      message: "portal sync dry-run completed without writes",
    },
  ];

  const failed = checks.filter((check) => !check.ok);
  const result = {
    ok: failed.length === 0,
    failed: failed.length,
    checks,
    summary: artifacts.buildSummary,
    outputs,
    syncResult,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.key}: ${check.message}\n`);
    }
  }

  if (failed.length > 0 || (options.strict && artifacts.buildSummary.sourceCount === 0)) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-marketing-announcement-pipeline failed: ${message}`);
  process.exit(1);
});
