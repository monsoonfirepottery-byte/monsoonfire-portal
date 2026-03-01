#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_OUTPUT_DIR = resolve(process.cwd(), "output", "playwright", "portal", "prod-console-scan");

const COOP_WARNING_PATTERNS = [
  /Cross-Origin-Opener-Policy policy would block/i,
  /window\.closed/i,
  /window\.close/i,
];

const PROFILE_THEME_WARNING_PATTERNS = [
  /\[profile\]\s+uiTheme sync failed/i,
];

function hasMatch(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || DEFAULT_BASE_URL));
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeOutputDir(value) {
  if (!value || !String(value).trim()) return DEFAULT_OUTPUT_DIR;
  return resolve(process.cwd(), String(value));
}

function parseOptions(argv) {
  const options = {
    baseUrl: normalizeBaseUrl(DEFAULT_BASE_URL),
    outputDir: normalizeOutputDir(""),
    headless: true,
    clickGoogle: true,
    strict: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    if (arg === "--base-url") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = normalizeBaseUrl(next);
      i += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --output-dir");
      options.outputDir = normalizeOutputDir(next);
      i += 1;
      continue;
    }

    if (arg === "--show") {
      options.headless = false;
      continue;
    }

    if (arg === "--skip-google") {
      options.clickGoogle = false;
      continue;
    }

    if (arg === "--no-strict") {
      options.strict = false;
      continue;
    }
  }

  return options;
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function isSameOriginAssetFailure(entry, origin) {
  if (!sameOrigin(entry.url, origin)) return false;
  try {
    const { pathname } = new URL(entry.url);
    if (pathname.startsWith("/assets/")) return true;
    if (pathname.endsWith(".js") || pathname.endsWith(".css") || pathname.endsWith(".map")) return true;
    return false;
  } catch {
    return false;
  }
}

function isActionableRequestFailure(entry) {
  const text = String(entry.errorText || "").toLowerCase();
  if (!text) return true;
  if (text.includes("err_aborted")) return false;
  return true;
}

function isActionableConsoleError(entry) {
  const text = String(entry?.text || "");
  if (hasMatch(text, COOP_WARNING_PATTERNS)) return false;
  if (hasMatch(text, PROFILE_THEME_WARNING_PATTERNS)) return false;
  return true;
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const scanStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = resolve(options.outputDir, scanStamp);
  await mkdir(outputDir, { recursive: true });

  const summary = {
    status: "running",
    scannedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    outputDir,
    steps: [],
    consoleErrors: [],
    consoleWarnings: [],
    coopWarnings: [],
    profileThemeWarnings: [],
    pageErrors: [],
    requestFailures: [],
    responseFailures: [],
    responseServerFailures: [],
    assetMimeMismatches: [],
    notes: [],
    failures: [],
  };

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "MonsoonFireProdConsoleScan/1.0",
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    const text = String(message.text() || "");
    const location = message.location?.() ?? {};
    const entry = {
      type: message.type(),
      text,
      location,
      at: new Date().toISOString(),
    };
    if (message.type() === "error") summary.consoleErrors.push(entry);
    if (message.type() === "warning") summary.consoleWarnings.push(entry);
    if (hasMatch(text, COOP_WARNING_PATTERNS)) summary.coopWarnings.push(entry);
    if (hasMatch(text, PROFILE_THEME_WARNING_PATTERNS)) summary.profileThemeWarnings.push(entry);
  });

  page.on("pageerror", (error) => {
    summary.pageErrors.push({
      text: String(error?.message || error),
      at: new Date().toISOString(),
    });
  });

  page.on("requestfailed", (request) => {
    summary.requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText || "",
      at: new Date().toISOString(),
    });
  });

  page.on("response", async (response) => {
    const request = response.request();
    const status = response.status();
    if (status < 400) {
      const contentType = response.headers()["content-type"] || "";
      const url = response.url();
      if (/\.m?js(\?|$)/i.test(url) && /text\/html/i.test(contentType)) {
        summary.assetMimeMismatches.push({
          url,
          status,
          contentType,
          at: new Date().toISOString(),
        });
      }
      return;
    }

    const entry = {
      url: response.url(),
      status,
      method: request.method(),
      resourceType: request.resourceType(),
      contentType: response.headers()["content-type"] || "",
      at: new Date().toISOString(),
    };
    summary.responseFailures.push(entry);
    if (status >= 500) {
      summary.responseServerFailures.push(entry);
    }
  });

  try {
    const scanUrl = `${options.baseUrl}/?prod_console_scan=${Date.now()}`;
    summary.steps.push(`goto:${scanUrl}`);
    await page.goto(scanUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: resolve(outputDir, "portal-before-google.png"), fullPage: true });

    if (options.clickGoogle) {
      summary.steps.push("click-google-signin");
      const button = page.getByRole("button", { name: /continue with google/i }).first();
      if ((await button.count()) > 0) {
        try {
          await button.click({ timeout: 10000, noWaitAfter: true });
          await page.waitForTimeout(4500);
        } catch (error) {
          summary.notes.push(`Google click flow threw: ${String(error)}`);
        }
      } else {
        summary.notes.push("Google button not found (likely already signed in).");
      }
    }

    await page.screenshot({ path: resolve(outputDir, "portal-after-google.png"), fullPage: true });
  } finally {
    await browser.close();
  }

  const actionableRequestFailures = summary.requestFailures.filter((entry) => isActionableRequestFailure(entry));
  const actionableConsoleErrors = summary.consoleErrors.filter((entry) => isActionableConsoleError(entry));
  const actionableAsset404s = summary.responseFailures.filter((entry) =>
    entry.status >= 400 && isSameOriginAssetFailure(entry, options.baseUrl)
  );

  if (actionableConsoleErrors.length > 0) {
    summary.failures.push(`console errors: ${actionableConsoleErrors.length}`);
  }
  if (summary.pageErrors.length > 0) {
    summary.failures.push(`page errors: ${summary.pageErrors.length}`);
  }
  if (actionableRequestFailures.length > 0) {
    summary.failures.push(`request failures: ${actionableRequestFailures.length}`);
  }
  if (summary.responseServerFailures.length > 0) {
    summary.failures.push(`server failures (5xx): ${summary.responseServerFailures.length}`);
  }
  if (actionableAsset404s.length > 0) {
    summary.failures.push(`same-origin asset failures (4xx/5xx): ${actionableAsset404s.length}`);
  }
  if (summary.assetMimeMismatches.length > 0) {
    summary.failures.push(`asset MIME mismatches: ${summary.assetMimeMismatches.length}`);
  }

  summary.status = summary.failures.length > 0 ? "failed" : "passed";
  summary.finishedAt = new Date().toISOString();

  const summaryPath = resolve(outputDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`Prod console scan summary: ${summaryPath}`);
  console.log(`status=${summary.status}`);
  console.log(`consoleErrors=${summary.consoleErrors.length}`);
  console.log(`consoleWarnings=${summary.consoleWarnings.length}`);
  console.log(`coopWarnings=${summary.coopWarnings.length}`);
  console.log(`profileThemeWarnings=${summary.profileThemeWarnings.length}`);
  console.log(`pageErrors=${summary.pageErrors.length}`);
  console.log(`requestFailures=${summary.requestFailures.length}`);
  console.log(`responseFailures=${summary.responseFailures.length}`);
  console.log(`assetMimeMismatches=${summary.assetMimeMismatches.length}`);

  if (summary.failures.length > 0) {
    console.error(`failures: ${summary.failures.join(", ")}`);
    if (options.strict) {
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error(`Prod console scan failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
