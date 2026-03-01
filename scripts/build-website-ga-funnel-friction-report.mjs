#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

function toPct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function interventionForStep(stepName, conversionPath, dropoffRatePct) {
  const normalizedStep = String(stepName || "").toLowerCase();
  const normalizedPath = String(conversionPath || "").toLowerCase();
  if (normalizedStep.includes("landing")) {
    return {
      intervention: "Clarify hero CTA and add one-line trust statement above fold.",
      hypothesis: "Stronger initial intent framing will reduce first-step exits.",
      owner: "web-content",
      expectedImpactPct: dropoffRatePct >= 45 ? 12 : 8,
    };
  }
  if (normalizedStep.includes("service") || normalizedPath.includes("/services")) {
    return {
      intervention: "Compress service detail copy into scannable bullets with direct next action.",
      hypothesis: "Reduced cognitive load on service detail step will increase progression.",
      owner: "web-content",
      expectedImpactPct: dropoffRatePct >= 45 ? 10 : 7,
    };
  }
  if (normalizedStep.includes("contact") || normalizedStep.includes("submit") || normalizedPath.includes("/contact")) {
    return {
      intervention: "Simplify form sequence and keep one frictionless primary action visible.",
      hypothesis: "Less form friction will increase quote/contact completion.",
      owner: "web-product",
      expectedImpactPct: dropoffRatePct >= 45 ? 14 : 9,
    };
  }
  return {
    intervention: "Add contextual trust cue and tighten step copy to one clear action.",
    hypothesis: "Clearer step intent and trust signal will reduce abandonment.",
    owner: "web-content",
    expectedImpactPct: dropoffRatePct >= 45 ? 9 : 6,
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Website GA Funnel Friction Report");
  lines.push("");
  lines.push(`- generatedAtUtc: ${report.generatedAtUtc}`);
  lines.push(`- baselineSnapshot: ${report.baselineSnapshot}`);
  lines.push(`- funnelsAnalyzed: ${report.summary.funnelsAnalyzed}`);
  lines.push(`- transitionsAnalyzed: ${report.summary.transitionsAnalyzed}`);
  lines.push("");
  lines.push("## Top Funnels");
  lines.push("");
  lines.push("| Funnel | Entry Volume | Final Completions | Funnel Conversion (%) |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const funnel of report.topFunnels) {
    lines.push(`| ${funnel.funnelName} | ${funnel.entryVolume} | ${funnel.finalCompletions} | ${funnel.funnelConversionRatePct} |`);
  }
  lines.push("");
  lines.push("## Highest Friction Transitions");
  lines.push("");
  lines.push("| Funnel | Step | Dropoff (%) | Action | Owner | Expected Impact (%) |");
  lines.push("| --- | --- | ---: | --- | --- | ---: |");
  for (const item of report.highestFrictionTransitions) {
    lines.push(`| ${item.funnelName} | ${item.stepName} | ${item.dropoffRatePct} | ${item.intervention} | ${item.owner} | ${item.expectedImpactPct} |`);
  }
  lines.push("");
  lines.push("## Remeasurement");
  lines.push("");
  lines.push(`- Pre-change window: ${report.remeasurement.preWindow}`);
  lines.push(`- Post-change window: ${report.remeasurement.postWindow}`);
  lines.push(`- Cadence: ${report.remeasurement.cadence}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baselineDir = await resolveBaselineDir(options.baselineDir);
  const baselineSnapshot = basename(baselineDir);
  const pathToConversionPath = join(baselineDir, "path-to-conversion.csv");
  const eventAuditPath = join(baselineDir, "event-audit.csv");
  if (!existsSync(pathToConversionPath)) {
    throw new Error(`Missing required export: ${pathToConversionPath}`);
  }

  const pathRows = readCsvRows(await readFile(pathToConversionPath, "utf8"));
  if (options.strict && pathRows.length === 0) {
    throw new Error("path-to-conversion.csv has no rows");
  }

  const grouped = new Map();
  for (const row of pathRows) {
    const funnelName = pick(row, ["conversion_path"]) || "(unknown funnel)";
    const stepName = pick(row, ["step_name"]) || "step";
    const stepIndex = Number(pick(row, ["step_index"])) || 0;
    const dropoffCount = parseNumber(pick(row, ["dropoff_count"])) || 0;
    const completionCount = parseNumber(pick(row, ["completion_count"])) || 0;
    const stepVolume = dropoffCount + completionCount;
    const dropoffRatePct = toPct(dropoffCount, stepVolume);
    const entry = {
      funnelName,
      stepName,
      stepIndex,
      dropoffCount,
      completionCount,
      stepVolume,
      dropoffRatePct,
    };
    if (!grouped.has(funnelName)) grouped.set(funnelName, []);
    grouped.get(funnelName).push(entry);
  }

  let funnels = [...grouped.entries()].map(([funnelName, steps]) => {
    const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const entryVolume = first?.stepVolume || 0;
    const finalCompletions = last?.completionCount || 0;
    return {
      funnelName,
      entryVolume,
      finalCompletions,
      funnelConversionRatePct: toPct(finalCompletions, entryVolume),
      steps: ordered,
    };
  });

  if (existsSync(eventAuditPath) && funnels.length < 3) {
    const eventRows = readCsvRows(await readFile(eventAuditPath, "utf8"));
    const eventCounts = {};
    for (const row of eventRows) {
      const eventName = pick(row, ["event_name"]);
      if (!eventName) continue;
      const count = parseNumber(pick(row, ["event_count"])) || 0;
      eventCounts[eventName] = (eventCounts[eventName] || 0) + count;
    }

    const ctaCount = Number(eventCounts.cta_primary_click || 0);
    const openCount = Number(eventCounts.quote_form_open || 0);
    const submitCount = Number(eventCounts.quote_form_submit || 0);

    if (ctaCount > 0 && openCount > 0) {
      const stepOneDropoff = Math.max(0, ctaCount - openCount);
      const stepTwoDropoff = Math.max(0, openCount - submitCount);
      const syntheticSteps = [
        {
          funnelName: "cta_primary_click -> quote_form_submit",
          stepName: "landing_cta",
          stepIndex: 1,
          dropoffCount: stepOneDropoff,
          completionCount: openCount,
          stepVolume: stepOneDropoff + openCount,
          dropoffRatePct: toPct(stepOneDropoff, stepOneDropoff + openCount),
        },
        {
          funnelName: "cta_primary_click -> quote_form_submit",
          stepName: "form_submit",
          stepIndex: 2,
          dropoffCount: stepTwoDropoff,
          completionCount: submitCount,
          stepVolume: stepTwoDropoff + submitCount,
          dropoffRatePct: toPct(stepTwoDropoff, stepTwoDropoff + submitCount),
        },
      ];
      funnels.push({
        funnelName: "cta_primary_click -> quote_form_submit",
        entryVolume: ctaCount,
        finalCompletions: submitCount,
        funnelConversionRatePct: toPct(submitCount, ctaCount),
        steps: syntheticSteps,
      });
    }

    const emailCount = Number(eventCounts.contact_email_click || 0);
    const phoneCount = Number(eventCounts.contact_phone_click || 0);
    if (funnels.length < 3 && (emailCount > 0 || phoneCount > 0)) {
      const entryVolume = emailCount + phoneCount;
      const syntheticSteps = [
        {
          funnelName: "contact_intent_alt_channels",
          stepName: "alt_contact_click",
          stepIndex: 1,
          dropoffCount: 0,
          completionCount: entryVolume,
          stepVolume: entryVolume,
          dropoffRatePct: 0,
        },
      ];
      funnels.push({
        funnelName: "contact_intent_alt_channels",
        entryVolume,
        finalCompletions: entryVolume,
        funnelConversionRatePct: 100,
        steps: syntheticSteps,
      });
    }
  }

  const topFunnels = [...funnels].sort((a, b) => b.entryVolume - a.entryVolume).slice(0, 3);
  const transitions = topFunnels.flatMap((funnel) =>
    funnel.steps.map((step) => {
      const intervention = interventionForStep(step.stepName, funnel.funnelName, step.dropoffRatePct);
      return {
        funnelName: funnel.funnelName,
        stepName: step.stepName,
        stepIndex: step.stepIndex,
        dropoffCount: step.dropoffCount,
        completionCount: step.completionCount,
        dropoffRatePct: step.dropoffRatePct,
        intervention: intervention.intervention,
        hypothesis: intervention.hypothesis,
        owner: intervention.owner,
        expectedImpactPct: intervention.expectedImpactPct,
      };
    })
  );

  const topDropCount = Math.max(1, Math.ceil(transitions.length * 0.2));
  const highestFrictionTransitions = [...transitions]
    .sort((a, b) => b.dropoffRatePct - a.dropoffRatePct || b.dropoffCount - a.dropoffCount)
    .slice(0, topDropCount);

  const report = {
    generatedAtUtc: new Date().toISOString(),
    baselineDir,
    baselineSnapshot,
    summary: {
      funnelsAnalyzed: topFunnels.length,
      transitionsAnalyzed: transitions.length,
      highestFrictionCount: highestFrictionTransitions.length,
    },
    topFunnels: topFunnels.map((funnel) => ({
      funnelName: funnel.funnelName,
      entryVolume: funnel.entryVolume,
      finalCompletions: funnel.finalCompletions,
      funnelConversionRatePct: funnel.funnelConversionRatePct,
    })),
    highestFrictionTransitions,
    remeasurement: {
      preWindow: "latest baseline snapshot (30d rolling)",
      postWindow: "14 days after intervention deploy",
      cadence: "weekly",
    },
  };

  const outputs = await writeReportArtifacts({
    outputDir: options.outputDir || undefined,
    reportBasename: "website-ga-funnel-friction",
    report,
    markdown: buildMarkdown(report),
  });

  const result = {
    status: "ok",
    baselineSnapshot,
    funnels: report.summary.funnelsAnalyzed,
    highestFrictionCount: report.summary.highestFrictionCount,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Funnel report created for ${baselineSnapshot}\n`);
    process.stdout.write(`- ${outputs.latestJsonPath}\n`);
    process.stdout.write(`- ${outputs.latestMdPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-website-ga-funnel-friction-report failed: ${message}`);
  process.exit(1);
});
