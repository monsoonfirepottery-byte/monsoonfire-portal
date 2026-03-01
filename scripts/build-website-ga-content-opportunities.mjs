#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseNumber, pick, readCsvRows, resolveBaselineDir, writeReportArtifacts } from "./lib/website-ga-utils.mjs";

function parseArgs(argv) {
  const options = {
    baselineDir: "",
    outputDir: "",
    json: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline-dir") {
      options.baselineDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

function normalizePagePath(value) {
  const raw = String(value || "/").trim();
  if (!raw.startsWith("/")) return `/${raw}`;
  return raw;
}

function resolveWebsiteFileCandidates(pagePath) {
  const normalized = normalizePagePath(pagePath);
  if (normalized === "/") {
    return [
      resolve(process.cwd(), "website/index.html"),
      resolve(process.cwd(), "website/ncsitebuilder/index.html"),
    ];
  }
  const clean = normalized.replace(/^\/+|\/+$/g, "");
  return [
    resolve(process.cwd(), "website", clean, "index.html"),
    resolve(process.cwd(), "website/ncsitebuilder", clean, "index.html"),
  ];
}

function classifyOpportunity({ sessions, bounceRate, goalCompletionRate }) {
  if (sessions >= 120 && goalCompletionRate < 7) {
    return "high_entrance_low_conversion";
  }
  if (bounceRate >= 40 && sessions >= 80) {
    return "high_bounce_seo";
  }
  return "engagement_polish";
}

function opportunityAction(type) {
  if (type === "high_entrance_low_conversion") {
    return "Add direct next-step CTA and trust proof block near top fold.";
  }
  if (type === "high_bounce_seo") {
    return "Rewrite page opener + metadata for intent match and add contextual internal links.";
  }
  return "Tighten content hierarchy and add a clear progression cue to related pages.";
}

function mobileRecommendation(type) {
  if (type === "high_entrance_low_conversion") {
    return "Reduce hero copy length and keep sticky CTA visible on mobile viewport.";
  }
  if (type === "high_bounce_seo") {
    return "Increase heading scannability and compress above-the-fold content blocks for mobile.";
  }
  return "Improve tap target spacing and shorten paragraph blocks for mobile readability.";
}

function desktopRecommendation(type) {
  if (type === "high_entrance_low_conversion") {
    return "Add side-by-side trust cues and CTA cluster above first scroll break.";
  }
  if (type === "high_bounce_seo") {
    return "Expand supporting context panel and add related-link rail for deeper browsing.";
  }
  return "Strengthen internal-link rail and maintain strong visual hierarchy for primary action.";
}

function toPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

async function inspectPageMetadata(pagePath) {
  const candidates = resolveWebsiteFileCandidates(pagePath);
  const foundPath = candidates.find((candidate) => existsSync(candidate));
  if (!foundPath) {
    return {
      pagePath,
      sourceFile: null,
      metaDescriptionPresent: false,
      imageCount: 0,
      imagesMissingAlt: 0,
    };
  }

  const source = await readFile(foundPath, "utf8");
  const metaDescriptionPresent = /<meta\s+name=["']description["']\s+content=["'][^"']+["']/i.test(source);
  const imgTags = source.match(/<img\b[^>]*>/gi) || [];
  const imagesMissingAlt = imgTags.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;

  return {
    pagePath,
    sourceFile: foundPath,
    metaDescriptionPresent,
    imageCount: imgTags.length,
    imagesMissingAlt,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Content Opportunity Queue");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- baselineSnapshot: ${report.baselineSnapshot}`);
  lines.push(`- opportunities: ${report.summary.opportunityCount}`);
  lines.push("");
  lines.push("## Top 10 Pages");
  lines.push("");
  lines.push("| Page | Opportunity | Sessions | Bounce (%) | Goal Completion (%) | Objective |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const page of report.pages) {
    lines.push(`| ${page.pagePath} | ${page.opportunityType} | ${page.sessions} | ${page.bounceRate} | ${page.goalCompletionRate} | ${page.objective} |`);
  }
  lines.push("");
  lines.push("## Metadata + Alt-Text Checks");
  lines.push("");
  lines.push("| Page | Source File | Meta Description | Images | Missing Alt |");
  lines.push("| --- | --- | --- | ---: | ---: |");
  for (const page of report.pages) {
    lines.push(`| ${page.pagePath} | ${page.sourceFile || "(missing)"} | ${page.metaDescriptionPresent ? "yes" : "no"} | ${page.imageCount} | ${page.imagesMissingAlt} |`);
  }
  lines.push("");
  lines.push("## Mobile Recommendations");
  lines.push("");
  for (const page of report.pages) {
    lines.push(`- ${page.pagePath}: ${page.mobileRecommendation}`);
  }
  lines.push("");
  lines.push("## Desktop Recommendations");
  lines.push("");
  for (const page of report.pages) {
    lines.push(`- ${page.pagePath}: ${page.desktopRecommendation}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineDir = await resolveBaselineDir(options.baselineDir);
  const baselineSnapshot = basename(baselineDir);
  const landingPath = join(baselineDir, "landing-pages.csv");
  if (!existsSync(landingPath)) {
    throw new Error(`Missing required export: ${landingPath}`);
  }

  const rows = readCsvRows(await readFile(landingPath, "utf8"));
  if (options.strict && rows.length === 0) {
    throw new Error("landing-pages.csv has no rows");
  }

  const scored = rows.map((row) => {
    const pagePath = normalizePagePath(pick(row, ["page_path"]));
    const sessions = parseNumber(pick(row, ["sessions"])) || 0;
    const bounceRate = parseNumber(pick(row, ["bounce_rate"])) || 0;
    const goalCompletionRate = parseNumber(pick(row, ["goal_completion_rate"])) || 0;
    const opportunityType = classifyOpportunity({ sessions, bounceRate, goalCompletionRate });
    const opportunityScore = Number((sessions * (1 + bounceRate / 100) * (1 - goalCompletionRate / 100)).toFixed(2));

    return {
      pagePath,
      sessions,
      bounceRate: toPct(bounceRate),
      goalCompletionRate: toPct(goalCompletionRate),
      opportunityType,
      opportunityScore,
      action: opportunityAction(opportunityType),
      objective: opportunityType === "high_bounce_seo" ? "reduce bounce rate" : "improve conversion progression",
      mobileRecommendation: mobileRecommendation(opportunityType),
      desktopRecommendation: desktopRecommendation(opportunityType),
    };
  });

  const fallbackPaths = [
    "/",
    "/services/",
    "/contact/",
    "/support/",
    "/faq/",
    "/kiln-firing/",
    "/memberships/",
    "/highlights/",
    "/supplies/",
    "/policies/",
  ];
  const seenPaths = new Set(scored.map((item) => item.pagePath));
  for (const fallbackPath of fallbackPaths) {
    if (seenPaths.has(fallbackPath)) continue;
    const opportunityType = "engagement_polish";
    scored.push({
      pagePath: fallbackPath,
      sessions: 0,
      bounceRate: 0,
      goalCompletionRate: 0,
      opportunityType,
      opportunityScore: 0,
      action: opportunityAction(opportunityType),
      objective: "improve conversion progression",
      mobileRecommendation: mobileRecommendation(opportunityType),
      desktopRecommendation: desktopRecommendation(opportunityType),
    });
  }

  const topPages = scored
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 10);

  const enriched = [];
  for (const page of topPages) {
    const audit = await inspectPageMetadata(page.pagePath);
    enriched.push({
      ...page,
      sourceFile: audit.sourceFile,
      metaDescriptionPresent: audit.metaDescriptionPresent,
      imageCount: audit.imageCount,
      imagesMissingAlt: audit.imagesMissingAlt,
    });
  }

  const report = {
    generatedAtUtc: new Date().toISOString(),
    baselineDir,
    baselineSnapshot,
    summary: {
      opportunityCount: enriched.length,
      mobileRecommendationCount: enriched.length,
      desktopRecommendationCount: enriched.length,
    },
    pages: enriched,
  };

  const outputs = await writeReportArtifacts({
    outputDir: options.outputDir || undefined,
    reportBasename: "website-ga-content-opportunities",
    report,
    markdown: buildMarkdown(report),
  });

  if (options.strict && enriched.length < 3) {
    throw new Error("Expected at least 3 page opportunities");
  }

  const result = {
    status: "ok",
    baselineSnapshot,
    opportunityCount: enriched.length,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Content opportunity queue generated for ${baselineSnapshot}\n`);
    process.stdout.write(`- ${outputs.latestJsonPath}\n`);
    process.stdout.write(`- ${outputs.latestMdPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-website-ga-content-opportunities failed: ${message}`);
  process.exit(1);
});
