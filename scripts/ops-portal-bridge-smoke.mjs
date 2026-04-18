#!/usr/bin/env node

/* eslint-disable no-console */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const defaultOutputDir = resolve(repoRoot, "output", "playwright", "ops-bridge");
const defaultSummaryPath = resolve(defaultOutputDir, "ops-portal-bridge-smoke.json");
const defaultScreenshotPath = resolve(defaultOutputDir, "ops-portal-bridge-smoke.png");
const renderModulePath = resolve(repoRoot, "studio-brain", "lib", "ops", "ui", "renderOpsPortalPage.js");

function parseArgs(argv) {
  const options = {
    outputDir: defaultOutputDir,
    summaryPath: defaultSummaryPath,
    screenshotPath: defaultScreenshotPath,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg === "--output-dir" && argv[index + 1]) {
      options.outputDir = resolve(process.cwd(), String(argv[index + 1]).trim());
      options.summaryPath = resolve(options.outputDir, "ops-portal-bridge-smoke.json");
      options.screenshotPath = resolve(options.outputDir, "ops-portal-bridge-smoke.png");
      index += 1;
      continue;
    }
  }

  return options;
}

function buildFixtureModel() {
  const generatedAt = "2026-04-18T21:00:00.000Z";
  return {
    snapshot: {
      generatedAt,
      session: {
        actorId: "staff-qa",
        portalRole: "staff",
        isStaff: true,
        opsRoles: ["floor_staff"],
        opsCapabilities: ["surface:hands", "surface:internet", "surface:manager"],
        allowedSurfaces: ["manager", "hands", "internet"],
        allowedModes: {
          manager: ["overview", "live", "truth"],
          owner: [],
          hands: ["now", "queue", "context"],
          internet: ["desk", "member-ops", "events"],
          ceo: [],
          forge: [],
        },
      },
      twin: {
        generatedAt,
        headline: "Studio is quiet and ready for handoff.",
        narrative: "No arrivals, physical tasks, or approvals are queued right now.",
        currentRisk: null,
        commitmentsDueSoon: 0,
        arrivalsExpectedSoon: 0,
        zones: [
          {
            id: "zone_truth",
            label: "Truth and watchdog posture",
            status: "healthy",
            summary: "Studio truth is fresh enough for autonomous coordination.",
            nextAction: "Keep the manager focused on sequencing and explanation.",
            evidence: {
              summary: "Signals are current and quiet.",
              verificationClass: "confirmed",
              sources: [],
              confidence: 0.94,
              degradeReason: null,
            },
          },
        ],
        nextActions: [],
      },
      truth: {
        generatedAt,
        readiness: "ready",
        summary: "Studio truth is fresh enough for autonomous coordination.",
        degradeModes: [],
        sources: [
          {
            source: "reservations",
            label: "Reservations",
            freshnessSeconds: null,
            budgetSeconds: 1800,
            status: "healthy",
            freshestAt: null,
            reason: "No reservation bundles are active right now.",
          },
        ],
        watchdogs: [
          {
            id: "watchdog_truth",
            label: "Truth readiness",
            status: "healthy",
            summary: "Signals are fresh enough to support autonomous coordination.",
            recommendation: "Keep the manager lane focused on sequencing and approvals.",
          },
        ],
        metrics: {
          open_cases: 0,
          open_tasks: 0,
          pending_approvals: 0,
          reservations_open: 0,
          support_open: 0,
          kiln_attention: 0,
        },
      },
      tasks: [],
      cases: [],
      approvals: [],
      ceo: [],
      forge: [],
      conversations: [],
      members: [],
      reservations: [],
      events: [],
      reports: [],
      lending: {
        requests: [],
        loans: [],
        recommendationCount: 0,
        tagSubmissionCount: 0,
        coverReviewCount: 0,
      },
      taskEscapes: [],
      overrides: [],
    },
    displayState: null,
    surface: "hands",
    stationId: null,
    sessionToken: null,
  };
}

async function loadRenderer() {
  if (!existsSync(renderModulePath)) {
    throw new Error(`Missing ${renderModulePath}. Run 'npm --prefix studio-brain run build' first.`);
  }
  const module = await import(pathToFileURL(renderModulePath).href);
  const renderOpsPortalPage = module.renderOpsPortalPage;
  if (typeof renderOpsPortalPage !== "function") {
    throw new Error("renderOpsPortalPage export was not found in the built Studio Brain UI module.");
  }
  return renderOpsPortalPage;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });

  const summary = {
    startedAt: new Date().toISOString(),
    status: "passed",
    failures: [],
    notes: [],
    screenshotPath: options.screenshotPath,
    summaryPath: options.summaryPath,
    consoleErrors: [],
    pageErrors: [],
    theme: {
      colorScheme: null,
      bg: null,
    },
  };

  const renderOpsPortalPage = await loadRenderer();
  const html = renderOpsPortalPage(buildFixtureModel());
  const bridgeHtml = "<!doctype html><html><body style=\"margin:0;background:#020812\"><iframe id=\"ops-bridge\" style=\"width:1440px;height:2000px;border:0\"></iframe></body></html>";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  page.on("console", (message) => {
    if (message.type() === "error") {
      summary.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    summary.pageErrors.push(String(error));
  });

  try {
    await page.setContent(bridgeHtml, { waitUntil: "domcontentloaded" });
    await page.evaluate((markup) => {
      const iframe = document.getElementById("ops-bridge");
      if (!(iframe instanceof HTMLIFrameElement)) {
        throw new Error("ops bridge iframe missing");
      }
      iframe.srcdoc = markup;
    }, html);
    const frameHandle = await page.locator("#ops-bridge").elementHandle();
    const frame = await frameHandle?.contentFrame();
    assert.ok(frame, "Expected ops bridge iframe to resolve.");

    await frame.waitForSelector("[data-surface-tab='hands']", { timeout: 30000 });
    await frame.click("[data-surface-tab='hands']");
    await frame.click("[data-surface-tab='internet']");
    await frame.click("[data-surface-tab='hands']");
    await frame.waitForTimeout(150);

    summary.theme = await frame.evaluate(() => ({
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    }));

    await frame.locator("body").screenshot({ path: options.screenshotPath });

    assert.equal(summary.theme.colorScheme, "dark", "Expected the ops shell to advertise a dark color scheme.");
    assert.match(String(summary.theme.bg), /^#0/i, "Expected the ops shell to keep a dark background token.");
    assert.equal(summary.pageErrors.length, 0, `Unexpected page errors: ${summary.pageErrors.join(" | ")}`);
    assert.equal(
      summary.consoleErrors.some((entry) => /SecurityError|replaceState/i.test(entry)),
      false,
      `Unexpected console bridge errors: ${summary.consoleErrors.join(" | ")}`,
    );
  } catch (error) {
    summary.status = "failed";
    summary.failures.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await browser.close();
    if (options.asJson) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  }
}

main().catch((error) => {
  console.error(`ops-portal-bridge-smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
