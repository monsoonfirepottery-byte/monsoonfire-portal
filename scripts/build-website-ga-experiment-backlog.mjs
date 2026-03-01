#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultReportsDir, writeReportArtifacts } from "./lib/website-ga-utils.mjs";

function parseArgs(argv) {
  const options = {
    reportsDir: defaultReportsDir,
    outputDir: "",
    json: false,
    strict: false,
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
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function scoreExperiment({ impact, confidence, effort, risk }) {
  return Number(((impact * confidence) / (effort + risk)).toFixed(2));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Experiment Backlog");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- totalExperiments: ${report.summary.totalExperiments}`);
  lines.push(`- maxConcurrentRecommended: ${report.summary.maxConcurrentRecommended}`);
  lines.push("");
  lines.push("## Ranked Experiments");
  lines.push("");
  lines.push("| Rank | Experiment | Impact | Confidence | Effort | Risk | Score | Owner |");
  lines.push("| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const item of report.experiments) {
    lines.push(`| ${item.rank} | ${item.title} | ${item.impact} | ${item.confidence} | ${item.effort} | ${item.risk} | ${item.score} | ${item.owner} |`);
  }
  lines.push("");
  lines.push("## Top 3 Traceability");
  lines.push("");
  for (const item of report.experiments.slice(0, 3)) {
    lines.push(`- ${item.title}`);
    lines.push(`  signal: ${item.signalReference}`);
    lines.push(`  hypothesis: ${item.hypothesis}`);
    lines.push(`  successMetric: ${item.successMetric}`);
    lines.push(`  rollbackCondition: ${item.rollbackCondition}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const funnelPath = join(options.reportsDir, "website-ga-funnel-friction-latest.json");
  const campaignPath = join(options.reportsDir, "website-ga-campaign-link-audit-latest.json");
  const acquisitionPath = join(options.reportsDir, "website-ga-acquisition-quality-latest.json");

  if (!existsSync(funnelPath) || !existsSync(campaignPath) || !existsSync(acquisitionPath)) {
    throw new Error("Required prerequisite reports are missing. Run funnel, campaign, and acquisition report commands first.");
  }

  const [funnel, campaign, acquisition] = await Promise.all([
    readJson(funnelPath),
    readJson(campaignPath),
    readJson(acquisitionPath),
  ]);

  const topFriction = Array.isArray(funnel.highestFrictionTransitions) ? funnel.highestFrictionTransitions : [];
  const campaignCoverage = Number(campaign?.summary?.effectiveCoveragePct ?? 0);
  const lowIntentSource = (acquisition?.acquisition?.top10 || []).find((row) => Number(row?.sessions ?? 0) >= 50 && Number(row?.conversionRatePct ?? 0) < 1.5);
  const topFrictionStep = topFriction[0];
  const secondFrictionStep = topFriction[1] || topFriction[0];

  const defaultExperiments = [
    {
      id: "cta-clarity-services",
      title: "Clarify primary CTA label and placement on top service pages",
      impact: 4,
      confidence: 4,
      effort: 2,
      risk: 2,
      owner: "web-content",
      hypothesis: "CTA clarity will increase progression from services to contact intent.",
      successMetric: "cta_primary_click +12% on services pages",
      rollbackCondition: "No uplift after 14 days or conversion drop >3%",
      signalReference: topFrictionStep ? `${topFrictionStep.funnelName} :: ${topFrictionStep.stepName}` : "services path friction",
    },
    {
      id: "mobile-trust-panel",
      title: "Add mobile trust panel above fold with contact options",
      impact: 4,
      confidence: 3,
      effort: 2,
      risk: 2,
      owner: "web-product",
      hypothesis: "Mobile trust cues will reduce early abandonment on high-intent pages.",
      successMetric: "quote_form_open +10% on mobile",
      rollbackCondition: "No improvement in mobile form-start rate after 14 days",
      signalReference: secondFrictionStep ? `${secondFrictionStep.funnelName} :: ${secondFrictionStep.stepName}` : "mobile abandonment signal",
    },
    {
      id: "what-to-expect-block",
      title: "Add concise 'What to expect' trust block under top CTA",
      impact: 3,
      confidence: 4,
      effort: 1,
      risk: 1,
      owner: "web-content",
      hypothesis: "Expectation-setting content improves progression into contact flow.",
      successMetric: "services->contact step progression +8%",
      rollbackCondition: "Engagement time drops >10% with no conversion gain",
      signalReference: topFrictionStep ? `${topFrictionStep.funnelName} friction remediation` : "funnel progression",
    },
    {
      id: "utm-standardization",
      title: "Standardize campaign UTM fields and retire unstructured outbound links",
      impact: 5,
      confidence: campaignCoverage >= 80 ? 4 : 5,
      effort: 2,
      risk: 2,
      owner: "marketing-ops",
      hypothesis: "Consistent attribution increases decision quality and channel optimization speed.",
      successMetric: "effective campaign coverage >= 95%",
      rollbackCondition: "Coverage remains <80% after one release cycle",
      signalReference: `campaign coverage ${campaignCoverage}%`,
    },
    {
      id: "faq-snippets",
      title: "Refresh FAQ snippets for highest-traffic inquiry pages",
      impact: 3,
      confidence: 3,
      effort: 3,
      risk: 1,
      owner: "web-content",
      hypothesis: "FAQ specificity lowers hesitation for contact starts.",
      successMetric: "contact intent events +6% on FAQ and support pages",
      rollbackCondition: "No event lift after 14 days",
      signalReference: "top traffic inquiry page engagement",
    },
    {
      id: "contact-form-simplification",
      title: "Simplify contact-start field sequence to reduce friction",
      impact: 5,
      confidence: topFrictionStep?.stepName?.toLowerCase().includes("contact") ? 4 : 3,
      effort: 3,
      risk: 2,
      owner: "web-product",
      hypothesis: "Fewer required fields at initial submit increases completion rate.",
      successMetric: "quote_form_submit / quote_form_open +10%",
      rollbackCondition: "Completion rate decreases or junk submissions increase >15%",
      signalReference: topFrictionStep ? `${topFrictionStep.funnelName} :: ${topFrictionStep.stepName}` : "contact submit friction",
    },
    {
      id: "low-intent-landing-alignment",
      title: "Align low-intent high-volume channel landing pages to stronger intent match",
      impact: 4,
      confidence: lowIntentSource ? 4 : 3,
      effort: 2,
      risk: 2,
      owner: "marketing-web",
      hypothesis: "Landing alignment for low-intent channels increases conversion quality.",
      successMetric: "channel conversion rate +15% for target source/medium",
      rollbackCondition: "No conversion-rate improvement after 2 weeks",
      signalReference: lowIntentSource ? `${lowIntentSource.sourceMedium} conversion ${lowIntentSource.conversionRatePct}%` : "channel quality variance",
    },
  ];

  const ranked = defaultExperiments
    .map((item) => ({ ...item, score: scoreExperiment(item) }))
    .sort((a, b) => b.score - a.score || b.impact - a.impact)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      measurementWindow: "14 days",
    }));

  const report = {
    generatedAtUtc: new Date().toISOString(),
    summary: {
      totalExperiments: ranked.length,
      maxConcurrentRecommended: 2,
      scoringFormula: "(Impact * Confidence) / (Effort + Risk)",
    },
    sourceSignals: {
      funnelReport: funnelPath,
      campaignAuditReport: campaignPath,
      acquisitionReport: acquisitionPath,
    },
    experiments: ranked,
  };

  const outputs = await writeReportArtifacts({
    outputDir: options.outputDir || undefined,
    reportBasename: "website-ga-experiment-backlog",
    report,
    markdown: buildMarkdown(report),
  });

  if (options.strict && ranked.length < 6) {
    throw new Error("Expected at least 6 experiments in backlog");
  }

  const result = {
    status: "ok",
    experimentCount: ranked.length,
    top3: ranked.slice(0, 3).map((item) => ({ rank: item.rank, title: item.title, score: item.score })),
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Experiment backlog generated (${ranked.length} experiments)\n`);
    process.stdout.write(`- ${outputs.latestJsonPath}\n`);
    process.stdout.write(`- ${outputs.latestMdPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-website-ga-experiment-backlog failed: ${message}`);
  process.exit(1);
});

