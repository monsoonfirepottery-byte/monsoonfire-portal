#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = process.cwd();
const DEFAULT_OUTPUT_DIR = join(repoRoot, "artifacts", "ga", "reports");
const SCAN_ROOTS = ["website", "website/ncsitebuilder"];
const AUTO_TAG_HOSTS = ["monsoonfire.kilnfire.com", "portal.monsoonfire.com", "instagram.com", "discord.com", "discord.gg", "phoenixcenterforthearts.org"];

function parseArgs(argv) {
  const options = {
    json: false,
    strict: false,
    minCoveragePct: 80,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = String(argv[index + 1] || "").trim() || options.outputDir;
      index += 1;
      continue;
    }
    if (arg === "--min-coverage") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        options.minCoveragePct = parsed;
      }
      index += 1;
    }
  }

  return options;
}

function normalizeHost(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function hostMatches(hostname, expectedHost) {
  const normalized = normalizeHost(hostname);
  const expected = normalizeHost(expectedHost);
  return normalized === expected || normalized.endsWith(`.${expected}`);
}

function isAutoTagEligible(hostname) {
  return AUTO_TAG_HOSTS.some((host) => hostMatches(hostname, host));
}

function isCampaignTouchpoint(urlObj) {
  return isAutoTagEligible(urlObj.hostname);
}

function parseAnchorHrefs(html) {
  const hrefs = [];
  const anchorHrefPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gis;
  let match;
  while ((match = anchorHrefPattern.exec(html)) !== null) {
    hrefs.push(String(match[2] || "").trim());
  }
  return hrefs;
}

async function listHtmlFiles(rootDir) {
  const files = [];
  const queue = [resolve(repoRoot, rootDir)];
  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (!currentDir || !existsSync(currentDir)) continue;
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function formatPct(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Website GA Campaign Link Audit");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- touchpointsScanned: ${report.summary.touchpointsScanned}`);
  lines.push(`- explicitCoveragePct: ${report.summary.explicitCoveragePct}`);
  lines.push(`- effectiveCoveragePct: ${report.summary.effectiveCoveragePct}`);
  lines.push(`- minCoveragePct: ${report.summary.minCoveragePct}`);
  lines.push("");
  lines.push("## Coverage Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Touchpoints scanned | ${report.summary.touchpointsScanned} |`);
  lines.push(`| Explicitly tagged | ${report.summary.explicitTagged} |`);
  lines.push(`| Covered by runtime auto-tag | ${report.summary.coveredByAutotag} |`);
  lines.push(`| Missing coverage | ${report.summary.missingCoverage} |`);
  lines.push(`| Effective coverage (%) | ${report.summary.effectiveCoveragePct} |`);
  lines.push("");
  lines.push("## Missing Coverage Remediation");
  lines.push("");
  if (report.missing.length === 0) {
    lines.push("- None");
  } else {
    lines.push("| Page | Link host | Link | Owner | Action |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of report.missing.slice(0, 30)) {
      lines.push(`| ${row.page} | ${row.host} | ${row.href} | marketing | Add canonical utm_source/utm_medium/utm_campaign tags |`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const htmlFiles = (
    await Promise.all(
      SCAN_ROOTS.map((root) => listHtmlFiles(root))
    )
  ).flat();

  const touchpoints = [];
  for (const htmlFile of htmlFiles) {
    const source = await readFile(htmlFile, "utf8");
    const hrefs = parseAnchorHrefs(source);
    for (const href of hrefs) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
        continue;
      }
      let parsed;
      try {
        parsed = new URL(href, "https://monsoonfire.com");
      } catch {
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (!isCampaignTouchpoint(parsed)) continue;

      const hasUtmSource = Boolean(parsed.searchParams.get("utm_source"));
      const hasUtmMedium = Boolean(parsed.searchParams.get("utm_medium"));
      const hasUtmCampaign = Boolean(parsed.searchParams.get("utm_campaign"));
      const explicitTagged = hasUtmSource && hasUtmMedium && hasUtmCampaign;
      const autoTagEligible = isAutoTagEligible(parsed.hostname);
      const effectiveCovered = explicitTagged || autoTagEligible;

      touchpoints.push({
        page: relative(repoRoot, htmlFile),
        href,
        host: normalizeHost(parsed.hostname),
        explicitTagged,
        autoTagEligible,
        effectiveCovered,
      });
    }
  }

  const touchpointsScanned = touchpoints.length;
  const explicitTagged = touchpoints.filter((item) => item.explicitTagged).length;
  const coveredByAutotag = touchpoints.filter((item) => !item.explicitTagged && item.autoTagEligible).length;
  const missing = touchpoints.filter((item) => !item.effectiveCovered);
  const missingCoverage = missing.length;
  const explicitCoveragePct = touchpointsScanned > 0 ? formatPct((explicitTagged / touchpointsScanned) * 100) : 100;
  const effectiveCoveragePct = touchpointsScanned > 0 ? formatPct(((touchpointsScanned - missingCoverage) / touchpointsScanned) * 100) : 100;

  const report = {
    generatedAtUtc: new Date().toISOString(),
    scanRoots: SCAN_ROOTS,
    summary: {
      touchpointsScanned,
      explicitTagged,
      coveredByAutotag,
      missingCoverage,
      explicitCoveragePct,
      effectiveCoveragePct,
      minCoveragePct: options.minCoveragePct,
    },
    missing,
    sample: touchpoints.slice(0, 50),
  };

  await mkdir(options.outputDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = join(options.outputDir, `website-ga-campaign-link-audit-${runId}.json`);
  const mdPath = join(options.outputDir, `website-ga-campaign-link-audit-${runId}.md`);
  const latestJsonPath = join(options.outputDir, "website-ga-campaign-link-audit-latest.json");
  const latestMdPath = join(options.outputDir, "website-ga-campaign-link-audit-latest.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, buildMarkdownReport(report), "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestMdPath, buildMarkdownReport(report), "utf8");

  const result = {
    status: effectiveCoveragePct >= options.minCoveragePct ? "ok" : "degraded",
    summary: report.summary,
    outputs: {
      jsonPath,
      mdPath,
      latestJsonPath,
      latestMdPath,
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`touchpointsScanned=${touchpointsScanned}\n`);
    process.stdout.write(`effectiveCoveragePct=${effectiveCoveragePct}\n`);
    process.stdout.write(`latest=${latestJsonPath}\n`);
  }

  if (options.strict && effectiveCoveragePct < options.minCoveragePct) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`audit-website-ga-campaign-links failed: ${message}`);
  process.exit(1);
});

