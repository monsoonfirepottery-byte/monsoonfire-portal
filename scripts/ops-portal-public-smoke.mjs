#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadPortalAutomationEnv } from "./lib/runtime-secrets.mjs";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_PATH = "/ops?surface=hands&mode=now";
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "playwright", "ops-public");
const DEFAULT_SCREENSHOT_PATH = resolve(DEFAULT_OUTPUT_DIR, "ops-portal-public-smoke.png");
const DEFAULT_REPORT_PATH = resolve(DEFAULT_OUTPUT_DIR, "ops-portal-public-smoke.json");

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const options = {
    baseUrl: clean(process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL) || DEFAULT_BASE_URL,
    path: clean(process.env.OPS_PORTAL_PUBLIC_SMOKE_PATH || DEFAULT_PATH) || DEFAULT_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    screenshotPath: DEFAULT_SCREENSHOT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    asJson: false,
    headless: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    const next = clean(argv[index + 1]);
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--base-url") {
      options.baseUrl = next.replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--path") {
      options.path = next.startsWith("/") ? next : `/${next}`;
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = resolve(process.cwd(), next);
      options.screenshotPath = resolve(options.outputDir, "ops-portal-public-smoke.png");
      options.reportPath = resolve(options.outputDir, "ops-portal-public-smoke.json");
      index += 1;
      continue;
    }
    if (arg === "--screenshot") {
      options.screenshotPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
  }

  return options;
}

async function waitForOpsFrame(page) {
  const iframe = page.locator("iframe").first();
  await iframe.waitFor({ timeout: 30000 });
  const handle = await iframe.elementHandle();
  if (!handle) {
    throw new Error("The smoke wrapper mounted an iframe, but the element handle was unavailable.");
  }
  const frame = await handle.contentFrame();
  if (!frame) {
    throw new Error("The smoke wrapper mounted an iframe, but the content frame was unavailable.");
  }
  await frame.waitForSelector("[data-surface-tab]", { timeout: 30000 });
  return frame;
}

async function runSmoke(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  loadPortalAutomationEnv();

  const minted = await mintStaffIdTokenFromPortalEnv();
  if (!minted.ok || !minted.token) {
    throw new Error(`Could not mint staff token for the public ops smoke: ${minted.reason || "missing token"}`);
  }

  await mkdir(options.outputDir, { recursive: true });
  const publicShellUrl = `${options.baseUrl}${options.path}`;
  const deployedOpsUrl = `${options.baseUrl}/__studio-brain${options.path}`;

  const shellResponse = await fetch(publicShellUrl, {
    headers: {
      Authorization: `Bearer ${minted.token}`,
    },
  });
  const shellHtml = await shellResponse.text();
  const deployedResponse = await fetch(deployedOpsUrl, {
    headers: {
      Authorization: `Bearer ${minted.token}`,
    },
  });
  const deployedHtml = await deployedResponse.text();

  if (!deployedResponse.ok) {
    throw new Error(`Deployed ops HTML fetch failed: HTTP ${deployedResponse.status}`);
  }

  const summary = {
    ok: false,
    baseUrl: options.baseUrl,
    path: options.path,
    publicShellUrl,
    deployedOpsUrl,
    shellStatus: shellResponse.status,
    deployedStatus: deployedResponse.status,
    screenshotPath: options.screenshotPath,
    reportPath: options.reportPath,
    consoleErrors: [],
    pageErrors: [],
    bridgeMessages: [],
    theme: null,
    iframeUrl: "",
    headline: "",
    narrative: "",
    protocol: "",
    generatedAt: new Date().toISOString(),
  };

  const browser = await chromium.launch({ headless: options.headless });
  try {
    const context = await browser.newContext({
      colorScheme: "dark",
      viewport: { width: 1600, height: 1200 },
    });
    const page = await context.newPage();

    page.on("console", (message) => {
      const entry = {
        type: message.type(),
        text: message.text(),
        location: message.location(),
      };
      if (entry.text.includes("Bridge Unavailable") || entry.text.includes("SecurityError")) {
        summary.bridgeMessages.push(entry);
      }
      if (entry.type === "error") {
        summary.consoleErrors.push(entry);
      }
    });
    page.on("pageerror", (error) => {
      summary.pageErrors.push(String(error?.message || error));
    });

    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Ops Portal Public Smoke</title>
          <style>
            html, body { margin: 0; padding: 0; background: #02060b; }
            iframe { width: 100vw; height: 100vh; border: 0; display: block; }
          </style>
        </head>
        <body>
          <iframe id="ops-frame" title="Studio Ops public smoke"></iframe>
        </body>
      </html>
    `, { waitUntil: "domcontentloaded" });

    await page.evaluate((html) => {
      const iframe = document.getElementById("ops-frame");
      if (!iframe) {
        throw new Error("Smoke wrapper could not find the iframe mount point.");
      }
      iframe.setAttribute("srcdoc", html);
    }, deployedHtml);

    const frame = await waitForOpsFrame(page);
    await frame.locator('[data-surface-tab="internet"]').click({ timeout: 10000 });
    await frame.waitForTimeout(200);
    await frame.locator('[data-surface-tab="hands"]').click({ timeout: 10000 });
    await frame.waitForTimeout(200);

    const bodyText = clean(await frame.locator("body").innerText());
    summary.theme = await frame.evaluate(() => {
      const styles = window.getComputedStyle(document.documentElement);
      return {
        colorScheme: styles.colorScheme,
        bg: styles.getPropertyValue("--bg").trim(),
      };
    });
    summary.iframeUrl = frame.url();
    summary.protocol = await frame.evaluate(() => window.location.protocol);
    summary.headline = clean(await frame.locator(".ops-hero h2, .ops-hero h1").first().textContent());
    summary.narrative = clean(await frame.locator(".ops-summary, .ops-hero p").nth(1).textContent().catch(() => ""));

    await page.screenshot({ path: options.screenshotPath, fullPage: true });

    const hasSecurityError = summary.consoleErrors.some((entry) => /SecurityError|replaceState/i.test(entry.text));
    const hasBridgeUnavailable = /Bridge Unavailable|path not allowed|Missing Authorization header/i.test(bodyText);
    const isDark = summary.theme?.colorScheme === "dark" && /^#0/i.test(summary.theme?.bg || "");
    const isQuiet = /quiet and waiting for fresher live telemetry|quiet and ready for handoff/i.test(bodyText);
    const publicShellMounted = /Monsoon Fire Portal/i.test(shellHtml);

    summary.ok = Boolean(
      publicShellMounted
      && isDark
      && isQuiet
      && !hasSecurityError
      && !hasBridgeUnavailable
      && summary.pageErrors.length === 0
    );
    summary.assertions = {
      publicShellMounted,
      isDark,
      isQuiet,
      hasSecurityError,
      hasBridgeUnavailable,
      pageErrors: summary.pageErrors.length,
    };

    await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    if (options.asJson) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      process.stdout.write(`status: ${summary.ok ? "passed" : "failed"}\n`);
      process.stdout.write(`public shell: ${summary.shellStatus} ${publicShellUrl}\n`);
      process.stdout.write(`deployed ops: ${summary.deployedStatus} ${deployedOpsUrl}\n`);
      process.stdout.write(`headline: ${summary.headline}\n`);
      process.stdout.write(`theme: ${summary.theme?.colorScheme || "<missing>"} ${summary.theme?.bg || ""}\n`);
      process.stdout.write(`iframe url: ${summary.iframeUrl}\n`);
      process.stdout.write(`assertions: ${JSON.stringify(summary.assertions)}\n`);
      process.stdout.write(`screenshot: ${summary.screenshotPath}\n`);
      process.stdout.write(`report: ${summary.reportPath}\n`);
    }

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runSmoke().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackReport = {
      ok: false,
      error: message,
      generatedAt: new Date().toISOString(),
    };
    await mkdir(DEFAULT_OUTPUT_DIR, { recursive: true }).catch(() => {});
    await writeFile(DEFAULT_REPORT_PATH, `${JSON.stringify(fallbackReport, null, 2)}\n`, "utf8").catch(() => {});
    console.error(`ops-portal-public-smoke failed: ${message}`);
    process.exit(1);
  });
}
