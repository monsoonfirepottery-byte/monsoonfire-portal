#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultReportsDir, writeReportArtifacts } from "./lib/website-ga-utils.mjs";

function parseArgs(argv) {
  const options = {
    reportsDir: defaultReportsDir,
    outputDir: "",
    strict: false,
    json: false,
    simulateBreach: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reports-dir") {
      options.reportsDir = String(argv[index + 1] || "").trim() || options.reportsDir;
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
    if (arg === "--simulate-breach") {
      options.simulateBreach = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function pctDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Weekly Dashboard");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- status: ${report.status}`);
  lines.push(`- alerts: ${report.alerts.length}`);
  lines.push("");
  lines.push("## Weekly Metrics");
  lines.push("");
  lines.push(`- sessionsTotalTop10Sources: ${report.metrics.sessionsTotalTop10Sources}`);
  lines.push(`- assistedRevenueTotal: ${report.metrics.assistedRevenueTotal}`);
  lines.push(`- assistedConversionsTotal: ${report.metrics.assistedConversionsTotal}`);
  lines.push(`- averageTopFunnelConversionPct: ${report.metrics.averageTopFunnelConversionPct}`);
  lines.push("");
  lines.push("## Owners");
  lines.push("");
  for (const owner of report.owners) {
    lines.push(`- ${owner.metricFamily}: ${owner.owner}`);
  }
  lines.push("");
  lines.push("## Alerts");
  lines.push("");
  if (report.alerts.length === 0) {
    lines.push("- None");
  } else {
    for (const alert of report.alerts) {
      lines.push(`- [${alert.severity}] ${alert.metric}: ${alert.message} | escalate: ${alert.escalationPath}`);
    }
  }
  lines.push("");
  lines.push("## Weekly Report Template");
  lines.push("");
  lines.push(`- Week ending: ${report.weeklyTemplate.weekEnding}`);
  lines.push(`- Summary: ${report.weeklyTemplate.summary}`);
  lines.push(`- Decisions needed: ${report.weeklyTemplate.decisionsNeeded}`);
  lines.push(`- Action owner map: ${report.weeklyTemplate.actionOwnerMap}`);
  lines.push("");
  lines.push("## Thresholds");
  lines.push("");
  for (const threshold of report.thresholds) {
    lines.push(`- ${threshold.metric}: breach when delta <= ${threshold.breachDeltaPct}% (${threshold.ticketPriority})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function readHistory(historyPath) {
  if (!existsSync(historyPath)) return [];
  const source = await readFile(historyPath, "utf8");
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportsDir = options.reportsDir;
  const acquisitionPath = join(reportsDir, "website-ga-acquisition-quality-latest.json");
  const funnelPath = join(reportsDir, "website-ga-funnel-friction-latest.json");
  const contentPath = join(reportsDir, "website-ga-content-opportunities-latest.json");
  const experimentPath = join(reportsDir, "website-ga-experiment-backlog-latest.json");

  const required = [acquisitionPath, funnelPath, contentPath, experimentPath];
  const missingRequired = required.filter((path) => !existsSync(path));
  if (missingRequired.length > 0) {
    throw new Error(`Missing prerequisite reports: ${missingRequired.join(", ")}`);
  }

  const [acquisition, funnel, content, experiments] = await Promise.all([
    readJson(acquisitionPath),
    readJson(funnelPath),
    readJson(contentPath),
    readJson(experimentPath),
  ]);

  const topSources = acquisition?.acquisition?.top10 || [];
  const topFunnels = funnel?.topFunnels || [];
  const topPages = content?.pages || [];

  const sessionsTotalTop10Sources = sum(topSources.map((row) => Number(row?.sessions || 0)));
  const assistedRevenueTotal = sum(topSources.map((row) => Number(row?.assistedRevenue || 0)));
  const assistedConversionsTotal = sum(topSources.map((row) => Number(row?.goalConversions || 0)));
  const averageTopFunnelConversionPct = topFunnels.length > 0
    ? Number((sum(topFunnels.map((row) => Number(row?.funnelConversionRatePct || 0))) / topFunnels.length).toFixed(2))
    : 0;

  const thresholds = [
    {
      metric: "sessionsTotalTop10Sources",
      breachDeltaPct: -15,
      ticketPriority: "P2",
      escalationPath: "marketing-lead -> web-lead -> product-lead",
    },
    {
      metric: "averageTopFunnelConversionPct",
      breachDeltaPct: -12,
      ticketPriority: "P1",
      escalationPath: "web-product -> web-content -> product-lead",
    },
    {
      metric: "assistedRevenueTotal",
      breachDeltaPct: -20,
      ticketPriority: "P2",
      escalationPath: "marketing-lead -> product-lead",
    },
  ];

  const historyDir = join("artifacts", "ga", "archive");
  const historyPath = join(historyDir, "website-ga-weekly-metrics-history.jsonl");
  await mkdir(historyDir, { recursive: true });
  const history = await readHistory(historyPath);
  const previous = history[history.length - 1] || null;

  const currentSnapshot = {
    generatedAtUtc: new Date().toISOString(),
    sessionsTotalTop10Sources,
    assistedRevenueTotal,
    assistedConversionsTotal,
    averageTopFunnelConversionPct,
  };

  const deltas = {
    sessionsTotalTop10Sources: previous ? pctDelta(currentSnapshot.sessionsTotalTop10Sources, previous.sessionsTotalTop10Sources) : 0,
    assistedRevenueTotal: previous ? pctDelta(currentSnapshot.assistedRevenueTotal, previous.assistedRevenueTotal) : 0,
    averageTopFunnelConversionPct: previous ? pctDelta(currentSnapshot.averageTopFunnelConversionPct, previous.averageTopFunnelConversionPct) : 0,
  };

  if (options.simulateBreach) {
    deltas.averageTopFunnelConversionPct = -25;
  }

  const alerts = thresholds
    .map((threshold) => {
      const delta = Number(deltas[threshold.metric] || 0);
      if (delta > threshold.breachDeltaPct) return null;
      return {
        severity: threshold.ticketPriority === "P1" ? "high" : "medium",
        metric: threshold.metric,
        deltaPct: delta,
        message: `Week-over-week delta ${delta}% breached threshold ${threshold.breachDeltaPct}%`,
        escalationPath: threshold.escalationPath,
        ticketPriority: threshold.ticketPriority,
      };
    })
    .filter(Boolean);

  const owners = [
    { metricFamily: "acquisition + source/medium", owner: "marketing-lead" },
    { metricFamily: "funnel conversion", owner: "web-product" },
    { metricFamily: "landing page engagement", owner: "web-content" },
    { metricFamily: "assisted conversion value", owner: "product-lead" },
  ];

  const topLanding = [...topPages].sort((a, b) => Number(b.bounceRate || 0) - Number(a.bounceRate || 0)).slice(0, 5);
  const weeklyTemplate = {
    weekEnding: new Date().toISOString().slice(0, 10),
    summary: `Review ${topSources.length} source/medium rows, ${topFunnels.length} funnels, and ${topLanding.length} landing opportunities.`,
    decisionsNeeded: "Approve top 2 experiments and confirm remediation owners for any breached metric.",
    actionOwnerMap: owners.map((owner) => `${owner.metricFamily}=${owner.owner}`).join("; "),
    topLandingWatchlist: topLanding.map((row) => ({
      pagePath: row.pagePath,
      bounceRate: row.bounceRate,
      goalCompletionRate: row.goalCompletionRate,
    })),
    activeExperimentTop3: (experiments.experiments || []).slice(0, 3).map((item) => ({
      title: item.title,
      owner: item.owner,
      score: item.score,
    })),
  };

  const report = {
    generatedAtUtc: currentSnapshot.generatedAtUtc,
    status: alerts.length > 0 ? "alert" : "ok",
    metrics: {
      sessionsTotalTop10Sources,
      assistedRevenueTotal,
      assistedConversionsTotal,
      averageTopFunnelConversionPct,
    },
    deltas,
    thresholds,
    owners,
    alerts,
    weeklyTemplate,
    sourceReports: {
      acquisitionPath,
      funnelPath,
      contentPath,
      experimentPath,
    },
  };

  const outputs = await writeReportArtifacts({
    outputDir: options.outputDir || undefined,
    reportBasename: "website-ga-weekly-dashboard",
    report,
    markdown: buildMarkdown(report),
  });

  await appendFile(historyPath, `${JSON.stringify(currentSnapshot)}\n`, "utf8");

  if (options.strict) {
    const missingOwners = owners.filter((owner) => !owner.owner || owner.owner.includes("unknown"));
    if (missingOwners.length > 0) {
      throw new Error("Owner mapping is incomplete for one or more metric families.");
    }
    if (!report.weeklyTemplate || !report.weeklyTemplate.decisionsNeeded) {
      throw new Error("Weekly template is incomplete.");
    }
  }

  const result = {
    status: report.status,
    alerts: alerts.length,
    historyDepth: history.length + 1,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Weekly dashboard generated: ${report.status}\n`);
    process.stdout.write(`- ${outputs.latestJsonPath}\n`);
    process.stdout.write(`- ${outputs.latestMdPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-website-ga-weekly-dashboard failed: ${message}`);
  process.exit(1);
});
