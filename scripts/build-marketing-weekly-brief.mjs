#!/usr/bin/env node

/* eslint-disable no-console */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildAnnouncementArtifacts } from "./lib/marketing-announcements.mjs";
import { defaultReportsDir, writeReportArtifacts } from "./lib/website-ga-utils.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const defaultOutputDir = join(repoRoot, "artifacts", "marketing", "reports");

function parseArgs(argv) {
  const options = {
    reportsDir: defaultReportsDir,
    outputDir: defaultOutputDir,
    refresh: false,
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--reports-dir") {
      options.reportsDir = resolve(repoRoot, next);
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = resolve(repoRoot, next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "$0";
}

function formatPct(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}%` : "0.00%";
}

async function refreshReports() {
  const commands = [
    "website:ga:baseline:report",
    "website:ga:funnel:report",
    "website:ga:content:opportunities",
    "website:ga:experiments:backlog",
    "website:ga:dashboard:weekly",
  ];
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  for (const scriptName of commands) {
    await execFileAsync(npmCommand, ["run", scriptName], { cwd: repoRoot });
  }
}

function buildRecommendations({ acquisition, funnel, content, experiments, announcements }) {
  const topSource = acquisition?.acquisition?.top10?.[0] || null;
  const topFriction = funnel?.highestFrictionTransitions?.[0] || null;
  const topOpportunity = content?.pages?.[0] || null;
  const topExperiment = experiments?.experiments?.[0] || null;
  const newestAnnouncement = announcements?.websitePayload?.items?.[0] || null;

  const recommendations = [];

  if (topSource) {
    recommendations.push({
      priority: "P1",
      title: `Protect the strongest source: ${topSource.sourceMedium}`,
      rationale: `${topSource.sourceMedium} is currently carrying ${topSource.sessions} sessions and ${topSource.goalConversions} conversions. Keep announcement CTAs aligned with that channel intent before adding net-new campaigns.`,
      ownerHint: "marketing-web",
      source: "website-ga-acquisition-quality-latest.json",
    });
  }

  if (topFriction) {
    recommendations.push({
      priority: "P1",
      title: `Address funnel friction in ${topFriction.funnelName}`,
      rationale: `${topFriction.stepName} is currently dropping ${formatPct(topFriction.dropoffRatePct)}. New announcements should avoid routing traffic through that step until the intervention is shipped.`,
      ownerHint: topFriction.owner || "web-product",
      source: "website-ga-funnel-friction-latest.json",
    });
  }

  if (topOpportunity) {
    recommendations.push({
      priority: "P2",
      title: `Fill the next content gap on ${topOpportunity.pagePath}`,
      rationale: `${topOpportunity.pagePath} is the highest-ranked content opportunity with a score of ${topOpportunity.opportunityScore}. Point the next public bulletin into a stronger next step once that page is tightened.`,
      ownerHint: "web-content",
      source: "website-ga-content-opportunities-latest.json",
    });
  }

  if (topExperiment) {
    recommendations.push({
      priority: "P2",
      title: `Queue the next validated experiment: ${topExperiment.title}`,
      rationale: `${topExperiment.title} is the top-ranked experiment with a score of ${topExperiment.score}. Let the next announcement borrow that hypothesis instead of shipping disconnected CTA copy.`,
      ownerHint: topExperiment.owner || "marketing-web",
      source: "website-ga-experiment-backlog-latest.json",
    });
  }

  if (newestAnnouncement) {
    recommendations.push({
      priority: "P3",
      title: `Follow up on the current bulletin: ${newestAnnouncement.title}`,
      rationale: `The newest live announcement is "${newestAnnouncement.title}". Review click-through and support follow-up after a week so the public bulletin becomes a living operating channel, not just a notice board.`,
      ownerHint: "studio-operator",
      source: "marketing/announcements",
    });
  }

  return recommendations;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Marketing Weekly Brief");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- refreshedReports: ${report.refreshedReports ? "yes" : "no"}`);
  lines.push(`- activeAnnouncements: ${report.summary.activeAnnouncements}`);
  lines.push(`- recommendationCount: ${report.recommendations.length}`);
  lines.push("");
  lines.push("## Snapshot");
  lines.push("");
  lines.push(`- Top source/medium: ${report.snapshot.topSource?.sourceMedium || "Unavailable"}`);
  lines.push(`- Assisted revenue in top sources: ${formatCurrency(report.snapshot.assistedRevenueTotal)}`);
  lines.push(`- Highest friction step: ${report.snapshot.topFriction ? `${report.snapshot.topFriction.funnelName} :: ${report.snapshot.topFriction.stepName}` : "Unavailable"}`);
  lines.push(`- Top content opportunity: ${report.snapshot.topOpportunity?.pagePath || "Unavailable"}`);
  lines.push(`- Top experiment: ${report.snapshot.topExperiment?.title || "Unavailable"}`);
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  if (report.recommendations.length === 0) {
    lines.push("- None");
  } else {
    for (const recommendation of report.recommendations) {
      lines.push(`- [${recommendation.priority}] ${recommendation.title} (${recommendation.ownerHint})`);
      lines.push(`  ${recommendation.rationale}`);
    }
  }
  lines.push("");
  lines.push("## Live Announcements");
  lines.push("");
  if (report.activeAnnouncements.length === 0) {
    lines.push("- None");
  } else {
    for (const announcement of report.activeAnnouncements) {
      lines.push(`- ${announcement.publishAt.slice(0, 10)} :: ${announcement.title} (${announcement.categoryLabel})`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.refresh) {
    await refreshReports();
  }

  const requiredPaths = {
    acquisition: join(options.reportsDir, "website-ga-acquisition-quality-latest.json"),
    funnel: join(options.reportsDir, "website-ga-funnel-friction-latest.json"),
    content: join(options.reportsDir, "website-ga-content-opportunities-latest.json"),
    experiments: join(options.reportsDir, "website-ga-experiment-backlog-latest.json"),
    dashboard: join(options.reportsDir, "website-ga-weekly-dashboard-latest.json"),
  };

  const missing = Object.values(requiredPaths).filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`Missing prerequisite reports: ${missing.join(", ")}`);
  }

  const [acquisition, funnel, content, experiments, dashboard] = await Promise.all([
    readJson(requiredPaths.acquisition),
    readJson(requiredPaths.funnel),
    readJson(requiredPaths.content),
    readJson(requiredPaths.experiments),
    readJson(requiredPaths.dashboard),
  ]);
  const announcements = await buildAnnouncementArtifacts();

  const report = {
    generatedAtUtc: new Date().toISOString(),
    refreshedReports: options.refresh,
    sourceReports: requiredPaths,
    summary: {
      activeAnnouncements: announcements.websitePayload.items.length,
      recommendationCount: 0,
      alerts: dashboard?.alerts?.length || 0,
    },
    snapshot: {
      topSource: acquisition?.acquisition?.top10?.[0] || null,
      assistedRevenueTotal: dashboard?.metrics?.assistedRevenueTotal || 0,
      topFriction: funnel?.highestFrictionTransitions?.[0] || null,
      topOpportunity: content?.pages?.[0] || null,
      topExperiment: experiments?.experiments?.[0] || null,
    },
    recommendations: buildRecommendations({
      acquisition,
      funnel,
      content,
      experiments,
      announcements,
    }),
    activeAnnouncements: announcements.websitePayload.items.map((item) => ({
      id: item.id,
      title: item.title,
      publishAt: item.publishAt,
      categoryLabel: item.categoryLabel,
    })),
  };
  report.summary.recommendationCount = report.recommendations.length;

  if (options.strict && report.recommendations.length < 3) {
    throw new Error("Expected at least three marketing recommendations in the weekly brief.");
  }

  const outputs = await writeReportArtifacts({
    outputDir: options.outputDir,
    reportBasename: "marketing-weekly-brief",
    report,
    markdown: buildMarkdown(report),
  });

  const result = {
    status: "ok",
    recommendations: report.recommendations.length,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write("Marketing weekly brief generated.\n");
  process.stdout.write(`- ${outputs.latestJsonPath}\n`);
  process.stdout.write(`- ${outputs.latestMdPath}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-marketing-weekly-brief failed: ${message}`);
  process.exit(1);
});
