#!/usr/bin/env node

/* eslint-disable no-console */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "qa", "portal-community-layout-canary");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-community-layout-canary.json");
const DEFAULT_STAFF_CREDENTIALS_PATH = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL,
    outputDir: process.env.PORTAL_CANARY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    reportPath: process.env.PORTAL_CANARY_REPORT || DEFAULT_REPORT_PATH,
    staffEmail: String(process.env.PORTAL_STAFF_EMAIL || "").trim(),
    staffPassword: String(process.env.PORTAL_STAFF_PASSWORD || "").trim(),
    credentialsPath: process.env.PORTAL_AGENT_STAFF_CREDENTIALS || DEFAULT_STAFF_CREDENTIALS_PATH,
    credentialsJson: String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim(),
    requireAuth: true,
    headless: true,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --output-dir");
      options.outputDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--staff-email") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --staff-email");
      options.staffEmail = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--staff-password") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --staff-password");
      options.staffPassword = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--credentials-json") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials-json");
      options.credentialsJson = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--no-require-auth") {
      options.requireAuth = false;
      continue;
    }
    if (arg === "--headed") {
      options.headless = false;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseStaffCredentialPayload(raw) {
  if (!raw || typeof raw !== "object") return { email: "", password: "" };
  return {
    email: String(raw.email ?? raw.staffEmail ?? "").trim(),
    password: String(raw.password ?? raw.staffPassword ?? "").trim(),
  };
}

async function resolveStaffCredentials(options) {
  let staffEmail = String(options.staffEmail || "").trim();
  let staffPassword = String(options.staffPassword || "").trim();
  const warnings = [];
  let source = staffEmail || staffPassword ? "PORTAL_STAFF_EMAIL / PORTAL_STAFF_PASSWORD" : "";

  const applyCandidate = (candidate, sourceLabel) => {
    if (!candidate) return;
    if (!staffEmail && candidate.email) staffEmail = String(candidate.email || "").trim();
    if (!staffPassword && candidate.password) staffPassword = String(candidate.password || "").trim();
    if (!source && staffEmail && staffPassword) source = sourceLabel;
  };

  if ((!staffEmail || !staffPassword) && options.credentialsJson) {
    try {
      const parsed = JSON.parse(options.credentialsJson);
      applyCandidate(parseStaffCredentialPayload(parsed), "PORTAL_AGENT_STAFF_CREDENTIALS_JSON");
    } catch (error) {
      warnings.push(
        `PORTAL_AGENT_STAFF_CREDENTIALS_JSON parse failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  if ((!staffEmail || !staffPassword) && options.credentialsPath) {
    const credsPath = resolve(process.cwd(), options.credentialsPath);
    if (await pathExists(credsPath)) {
      try {
        const raw = await readFile(credsPath, "utf8");
        applyCandidate(parseStaffCredentialPayload(JSON.parse(raw)), `credentials file: ${credsPath}`);
      } catch (error) {
        warnings.push(
          `Credential file parse failed at ${credsPath} (${error instanceof Error ? error.message : String(error)}).`
        );
      }
    } else {
      warnings.push(`Credential file not found at ${credsPath}.`);
    }
  }

  return {
    staffEmail,
    staffPassword,
    source: source || "unresolved",
    warnings,
  };
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function check(summary, label, run) {
  try {
    await run();
    summary.checks.push({ label, status: "passed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.checks.push({ label, status: "failed", message });
    summary.errors.push(`${label}: ${message}`);
  }
}

async function waitForAuthReady(page) {
  const signOut = page.getByRole("button", { name: /^Sign out$/i }).first();
  const signedOutCard = page.locator(".signed-out-card");
  await Promise.race([
    signOut.waitFor({ timeout: 30000 }),
    signedOutCard.waitFor({ timeout: 30000 }),
  ]);
  return (await signedOutCard.count()) > 0;
}

async function signInWithEmail(page, email, password) {
  if (!email || !password) return;
  const signedOutCard = page.locator(".signed-out-card");
  await signedOutCard.waitFor({ timeout: 30000 });

  const emailInput = signedOutCard.locator("input[type='email']").first();
  const passwordInput = signedOutCard.locator("input[type='password']").first();
  const submitPrimary = signedOutCard.locator("button.primary").first();
  const submitFallback = signedOutCard.getByRole("button", { name: /^Sign in$/i }).first();
  const submit = (await submitPrimary.count()) > 0 ? submitPrimary : submitFallback;

  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submit.click();
  await page.waitForTimeout(1200);

  const stillSignedOut = await waitForAuthReady(page);
  if (stillSignedOut) {
    const signedOutError = signedOutCard.locator(".signed-out-status").first();
    if ((await signedOutError.count()) > 0) {
      const message = (await signedOutError.textContent())?.trim() || "sign in failed";
      throw new Error(`Sign in blocked: ${message}`);
    }
    throw new Error("Sign in did not transition to authenticated shell.");
  }
}

function regexSafe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickNavSubItem(page, sectionLabel, itemLabel, required = false) {
  const sectionButton = page
    .locator("button.nav-section-title", { hasText: new RegExp(`^${regexSafe(sectionLabel)}$`, "i") })
    .first();
  const sectionCount = await sectionButton.count();
  if (sectionCount === 0) {
    if (!required) return false;
    throw new Error(`${sectionLabel} nav section not available.`);
  }

  const controlsId = await sectionButton.getAttribute("aria-controls");
  const expanded = (await sectionButton.getAttribute("aria-expanded")) === "true";
  if (!expanded) {
    await sectionButton.click({ timeout: 12000 });
    await page.waitForTimeout(350);
  }

  const button = controlsId
    ? page
        .locator(`#${controlsId}`)
        .locator("button", { hasText: new RegExp(`^${regexSafe(itemLabel)}$`, "i") })
        .first()
    : page.getByRole("button", { name: new RegExp(`^${regexSafe(itemLabel)}$`, "i") }).first();

  const count = await button.count();
  if (count === 0) {
    if (!required) return false;
    throw new Error(`${itemLabel} nav item not available.`);
  }

  await button.click({ timeout: 12000 });
  await page.waitForTimeout(800);
  return true;
}

async function captureScreenshot(page, outputDir, fileName) {
  const path = resolve(outputDir, fileName);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function collectLayoutDiagnostics(page) {
  return page.evaluate(() => {
    const checkOverflow = (elements, label) => {
      const issues = [];
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const overflowX = Math.max(0, element.scrollWidth - element.clientWidth);
        const overflowY = Math.max(0, element.scrollHeight - element.clientHeight);
        if (overflowX <= 1 && overflowY <= 1) continue;
        issues.push({
          label,
          className: element.className || "",
          overflowX: Number(overflowX.toFixed(2)),
          overflowY: Number(overflowY.toFixed(2)),
          text: String(element.textContent || "").trim().slice(0, 140),
        });
      }
      return issues;
    };

    const sidebar = document.querySelector("[data-community-sidebar='true']");
    const reportHistory = document.querySelector("[data-community-report-history='true']");
    const chiplets = Array.from(document.querySelectorAll("[data-community-chiplet]"));
    const reportRows = Array.from(document.querySelectorAll(".community-report-item"));
    const reportHeads = Array.from(document.querySelectorAll(".community-report-item-head"));
    const videoRows = Array.from(document.querySelectorAll(".video-row"));

    const overflowIssues = [
      ...checkOverflow(chiplets, "chiplet"),
      ...checkOverflow(reportRows, "report-row"),
      ...checkOverflow(reportHeads, "report-head"),
      ...checkOverflow(videoRows, "video-row"),
    ];

    return {
      sidebarWidth: sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0,
      reportHistoryHeight:
        reportHistory instanceof HTMLElement ? reportHistory.getBoundingClientRect().height : 0,
      overflowIssues: overflowIssues.slice(0, 20),
      chipletCount: chiplets.length,
      reportRowCount: reportRows.length,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  const summary = {
    status: "running",
    startedAtIso,
    finishedAtIso: "",
    baseUrl: options.baseUrl,
    reportPath: options.reportPath,
    outputDir: options.outputDir,
    auth: {
      required: options.requireAuth,
      source: "",
      warnings: [],
    },
    checks: [],
    errors: [],
    artifacts: [],
    layout: {
      baseline: null,
      afterRefresh: null,
      sidebarWidthDelta: 0,
      overflowIssues: [],
    },
  };

  const creds = await resolveStaffCredentials(options);
  summary.auth.source = creds.source;
  summary.auth.warnings = creds.warnings;
  if (creds.warnings.length > 0) {
    summary.auth.warnings.forEach((warning) => summary.errors.push(`auth warning: ${warning}`));
  }

  if (options.requireAuth && (!creds.staffEmail || !creds.staffPassword)) {
    throw new Error("Community layout canary requires staff credentials (email + password).");
  }

  await ensureDir(options.outputDir);

  const browser = await chromium.launch({ headless: options.headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: "MonsoonFireCommunityLayoutCanary/1.0",
    });
    const page = await context.newPage();

    await check(summary, "base URL reachable", async () => {
      await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(900);
      summary.artifacts.push({
        label: "landing",
        path: await captureScreenshot(page, options.outputDir, "community-layout-01-landing.png"),
      });
    });

    await check(summary, "authenticate", async () => {
      const isSignedOut = await waitForAuthReady(page);
      if (isSignedOut) {
        await signInWithEmail(page, creds.staffEmail, creds.staffPassword);
      }
    });

    await check(summary, "open community overview", async () => {
      const opened = await clickNavSubItem(page, "Community", "Overview", true);
      if (!opened) throw new Error("Community overview nav item unavailable.");
      await page.getByRole("heading", { name: /^Community$/i }).first().waitFor({ timeout: 20000 });
      summary.artifacts.push({
        label: "community-initial",
        path: await captureScreenshot(page, options.outputDir, "community-layout-02-initial.png"),
      });
    });

    await check(summary, "community sidebar layout remains stable after async refresh", async () => {
      const refreshButton = page.getByRole("button", { name: /^Refresh$/i }).first();
      const baseline = await collectLayoutDiagnostics(page);

      if ((await refreshButton.count()) > 0) {
        await refreshButton.click({ timeout: 12000 });
      }
      await page.waitForTimeout(2200);
      const afterRefresh = await collectLayoutDiagnostics(page);

      summary.layout.baseline = baseline;
      summary.layout.afterRefresh = afterRefresh;
      summary.layout.sidebarWidthDelta = Math.abs(afterRefresh.sidebarWidth - baseline.sidebarWidth);
      summary.layout.overflowIssues = afterRefresh.overflowIssues;

      if (summary.layout.sidebarWidthDelta > 24) {
        throw new Error(
          `Sidebar width shifted by ${summary.layout.sidebarWidthDelta.toFixed(2)}px after refresh.`
        );
      }

      if (afterRefresh.overflowIssues.length > 0) {
        const first = afterRefresh.overflowIssues[0];
        throw new Error(
          `Detected ${afterRefresh.overflowIssues.length} overflow issue(s), first: ${first.label} (${first.className}) overflowX=${first.overflowX}.`
        );
      }

      summary.artifacts.push({
        label: "community-post-refresh",
        path: await captureScreenshot(page, options.outputDir, "community-layout-03-post-refresh.png"),
      });
    });

    await context.close();
  } finally {
    await browser.close();
  }

  summary.status = summary.checks.some((checkItem) => checkItem.status === "failed")
    ? "failed"
    : "passed";
  summary.finishedAtIso = new Date().toISOString();

  await ensureDir(dirname(options.reportPath));
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    summary.checks.forEach((checkItem) => {
      const suffix = checkItem.status === "failed" ? ` (${checkItem.message})` : "";
      process.stdout.write(`- ${checkItem.label}: ${checkItem.status}${suffix}\n`);
    });
    process.stdout.write(`report: ${summary.reportPath}\n`);
  }

  if (summary.status !== "passed") {
    process.exit(1);
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const options = parseArgs(process.argv.slice(2));
  const failedSummary = {
    status: "failed",
    startedAtIso: new Date().toISOString(),
    finishedAtIso: new Date().toISOString(),
    baseUrl: options.baseUrl,
    reportPath: options.reportPath,
    outputDir: options.outputDir,
    checks: [],
    errors: [message],
    artifacts: [],
    auth: {
      required: options.requireAuth,
      source: "error-before-run",
      warnings: [],
    },
  };

  try {
    await ensureDir(dirname(options.reportPath));
    await writeFile(options.reportPath, `${JSON.stringify(failedSummary, null, 2)}\n`, "utf8");
  } catch {
    // ignore write failure
  }
  console.error(`portal-community-layout-canary failed: ${message}`);
  process.exit(1);
});
