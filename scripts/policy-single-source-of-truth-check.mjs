#!/usr/bin/env node

/* eslint-disable no-console */

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const POLICY_INDEX_PATH = resolve(repoRoot, "docs", "policies", "policies-index.json");
const POLICY_SOURCE_TS_PATH = resolve(repoRoot, "functions", "src", "policySourceOfTruth.ts");
const WEBSITE_CONDUCT_PAGE_PATH = resolve(repoRoot, "website", "policies", "community-conduct", "index.html");

function parseArgs(argv) {
  return {
    asJson: argv.includes("--json"),
  };
}

function extractConst(source, name) {
  const pattern = new RegExp(`export const ${name} = \"([^\"]+)\";`);
  const match = source.match(pattern);
  return match?.[1] ?? "";
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = {
    status: "passed",
    checks: [],
    errors: [],
  };

  const policyIndexRaw = await readFile(POLICY_INDEX_PATH, "utf8");
  const policyIndex = JSON.parse(policyIndexRaw);
  const policies = Array.isArray(policyIndex?.policies) ? policyIndex.policies : [];
  const communityConduct = policies.find((entry) => entry?.slug === "community-conduct");

  if (!communityConduct) {
    summary.status = "failed";
    summary.errors.push("community-conduct entry missing from docs/policies/policies-index.json");
  } else {
    summary.checks.push({
      label: "docs policy exists",
      slug: communityConduct.slug,
      status: communityConduct.status,
      effectiveDate: communityConduct.effectiveDate ?? null,
      sourceUrl: communityConduct.sourceUrl ?? null,
    });
    if (String(communityConduct.status) !== "active") {
      summary.status = "failed";
      summary.errors.push("community-conduct policy is not marked active in policy index.");
    }
  }

  const policySourceTs = await readFile(POLICY_SOURCE_TS_PATH, "utf8");
  const sourceSlug = extractConst(policySourceTs, "WEBSITE_POLICY_SOURCE_SLUG");
  const sourceVersion = extractConst(policySourceTs, "WEBSITE_POLICY_SOURCE_VERSION");
  const sourceUrl = extractConst(policySourceTs, "WEBSITE_POLICY_SOURCE_URL");

  summary.checks.push({
    label: "functions policy source constants",
    sourceSlug,
    sourceVersion,
    sourceUrl,
  });

  if (!sourceSlug || !sourceVersion || !sourceUrl) {
    summary.status = "failed";
    summary.errors.push("Failed to parse policy source constants from functions/src/policySourceOfTruth.ts");
  }

  if (communityConduct) {
    if (sourceSlug !== String(communityConduct.slug)) {
      summary.status = "failed";
      summary.errors.push(`Slug drift: functions=${sourceSlug} docs=${String(communityConduct.slug)}`);
    }
    if (sourceVersion !== String(communityConduct.effectiveDate ?? "")) {
      summary.status = "failed";
      summary.errors.push(
        `Version/effectiveDate drift: functions=${sourceVersion} docs=${String(communityConduct.effectiveDate ?? "")}`
      );
    }
    if (sourceUrl !== String(communityConduct.sourceUrl ?? "")) {
      summary.status = "failed";
      summary.errors.push(`sourceUrl drift: functions=${sourceUrl} docs=${String(communityConduct.sourceUrl ?? "")}`);
    }
  }

  const websitePageExists = await pathExists(WEBSITE_CONDUCT_PAGE_PATH);
  summary.checks.push({
    label: "website community-conduct page exists",
    path: WEBSITE_CONDUCT_PAGE_PATH,
    exists: websitePageExists,
  });
  if (!websitePageExists) {
    summary.status = "failed";
    summary.errors.push("website/policies/community-conduct/index.html missing");
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    for (const check of summary.checks) {
      process.stdout.write(`- ${check.label}: ok\n`);
    }
    for (const error of summary.errors) {
      process.stdout.write(`error: ${error}\n`);
    }
  }

  if (summary.status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`policy-single-source-of-truth-check failed: ${message}`);
  process.exit(1);
});
