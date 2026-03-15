#!/usr/bin/env node

/* eslint-disable no-console */

import {
  buildAnnouncementArtifacts,
  defaultAnnouncementSourceDir,
  defaultBuildSummaryPath,
  defaultPortalPayloadPath,
  defaultWebsiteAnnouncementsPath,
  writeAnnouncementArtifacts,
} from "./lib/marketing-announcements.mjs";

function parseArgs(argv) {
  const options = {
    sourceDir: defaultAnnouncementSourceDir,
    websiteJsonPath: defaultWebsiteAnnouncementsPath,
    portalPayloadPath: defaultPortalPayloadPath,
    buildSummaryPath: defaultBuildSummaryPath,
    json: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--source-dir") {
      options.sourceDir = next;
      index += 1;
      continue;
    }
    if (arg === "--website-json") {
      options.websiteJsonPath = next;
      index += 1;
      continue;
    }
    if (arg === "--portal-payload") {
      options.portalPayloadPath = next;
      index += 1;
      continue;
    }
    if (arg === "--build-summary") {
      options.buildSummaryPath = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = await buildAnnouncementArtifacts({
    sourceDir: options.sourceDir,
  });
  const outputs = await writeAnnouncementArtifacts(artifacts, {
    websiteJsonPath: options.websiteJsonPath,
    portalPayloadPath: options.portalPayloadPath,
    buildSummaryPath: options.buildSummaryPath,
  });

  if (options.strict && artifacts.buildSummary.sourceCount === 0) {
    throw new Error("No announcement source documents were found.");
  }

  const result = {
    status: "ok",
    summary: artifacts.buildSummary,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write("Marketing announcements built.\n");
  process.stdout.write(`- website data: ${outputs.websiteJsonPathRelative}\n`);
  process.stdout.write(`- portal payload: ${outputs.portalPayloadPathRelative}\n`);
  process.stdout.write(`- summary: ${outputs.buildSummaryPathRelative}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-marketing-announcements failed: ${message}`);
  process.exit(1);
});
