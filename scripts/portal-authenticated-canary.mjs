#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://monsoonfire-portal.web.app";
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "qa", "portal-authenticated-canary");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-authenticated-canary.json");

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL,
    outputDir: process.env.PORTAL_CANARY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    reportPath: process.env.PORTAL_CANARY_REPORT || DEFAULT_REPORT_PATH,
    staffEmail: String(process.env.PORTAL_STAFF_EMAIL || "").trim(),
    staffPassword: String(process.env.PORTAL_STAFF_PASSWORD || "").trim(),
    requireAuth: true,
    headless: true,
    runThemeSweep: true,
    functionalOnly: false,
    themeOnly: false,
    minContrast: 4.2,
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

    if (arg === "--no-require-auth") {
      options.requireAuth = false;
      continue;
    }

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    if (arg === "--no-theme-sweep") {
      options.runThemeSweep = false;
      continue;
    }

    if (arg === "--functional-only") {
      options.functionalOnly = true;
      options.runThemeSweep = false;
      continue;
    }

    if (arg === "--theme-only") {
      options.themeOnly = true;
      options.runThemeSweep = true;
      continue;
    }

    if (arg === "--min-contrast") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --min-contrast");
      const value = Number(next);
      if (!Number.isFinite(value) || value <= 1) throw new Error("--min-contrast must be a number > 1");
      options.minContrast = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

function regexSafe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function takeScreenshot(page, outputDir, fileName, summary, label) {
  const path = resolve(outputDir, fileName);
  await page.screenshot({ path, fullPage: true });
  summary.screenshots.push({ label, path });
}

async function clickNavItem(page, label, required = true) {
  const button = page.getByRole("button", { name: new RegExp(regexSafe(label), "i") }).first();
  if ((await button.count()) === 0) {
    if (required) throw new Error(`Nav button not found: ${label}`);
    return false;
  }
  await button.click({ timeout: 10000 });
  await page.waitForTimeout(650);
  return true;
}

async function clickNavSubItem(page, sectionLabel, itemLabel, required = true) {
  const sectionButton = page
    .getByRole("button", { name: new RegExp(regexSafe(sectionLabel), "i") })
    .first();

  if ((await sectionButton.count()) === 0) {
    if (required) throw new Error(`Nav section button not found: ${sectionLabel}`);
    return false;
  }

  const expanded = await sectionButton.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await sectionButton.click({ timeout: 10000 });
    await page.waitForTimeout(350);
  }

  const itemButton = page
    .locator(".nav-subitem", { hasText: new RegExp(regexSafe(itemLabel), "i") })
    .first();

  if ((await itemButton.count()) === 0) {
    if (required) throw new Error(`Nav subitem not found: ${sectionLabel} > ${itemLabel}`);
    return false;
  }

  await itemButton.click({ timeout: 10000 });
  await page.waitForTimeout(700);
  return true;
}

function getThemeToggle(page, label) {
  return page.getByRole("button", { name: new RegExp(`^Switch to ${regexSafe(label)} theme$`, "i") }).first();
}

async function ensureTheme(page, targetTheme) {
  if (targetTheme !== "light" && targetTheme !== "dark") {
    throw new Error(`Unsupported theme target: ${targetTheme}`);
  }

  const nextThemeLabel = targetTheme === "dark" ? "light" : "dark";
  const alreadyAtTarget = getThemeToggle(page, nextThemeLabel);
  if ((await alreadyAtTarget.count()) > 0) {
    return;
  }

  const switchToggle = getThemeToggle(page, targetTheme);
  if ((await switchToggle.count()) === 0) {
    throw new Error(`Theme toggle not found for target: ${targetTheme}`);
  }

  await switchToggle.click({ timeout: 10000 });
  await page.waitForTimeout(550);

  const confirm = getThemeToggle(page, nextThemeLabel);
  if ((await confirm.count()) === 0) {
    throw new Error(`Theme switch did not complete for target: ${targetTheme}`);
  }
}

async function waitForAuthReady(page) {
  const signOut = page.getByRole("button", { name: /^Sign out$/i }).first();
  const signedOutCard = page.locator(".signed-out-card");

  await Promise.race([
    signOut.waitFor({ timeout: 30000 }),
    signedOutCard.waitFor({ timeout: 30000 }),
  ]);

  const isSignedOut = await signedOutCard.count();
  return isSignedOut > 0;
}

async function signInWithEmail(page, email, password) {
  if (!email || !password) {
    throw new Error("Missing PORTAL_STAFF_EMAIL or PORTAL_STAFF_PASSWORD for authenticated canary run.");
  }

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
  await submit.click({ timeout: 10000 });

  await page.waitForTimeout(1200);

  const nowSignedOut = await waitForAuthReady(page);
  if (!nowSignedOut) {
    return;
  }

  const signedOutError = signedOutCard.locator(".signed-out-status").first();
  if ((await signedOutError.count()) > 0) {
    const message = (await signedOutError.textContent())?.trim() || "sign in failed";
    throw new Error(`Sign in blocked: ${message}`);
  }

  throw new Error("Sign in did not transition to authenticated shell.");
}

function isRetryableMarkReadFailure(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("we could not complete that request") ||
    normalized.includes("try again") ||
    normalized.includes("temporar")
  );
}

async function readMarkReadOutcome(page) {
  const failureStatus = page.locator(".notification-status", { hasText: /Mark read failed:/i }).first();
  if ((await failureStatus.count()) > 0) {
    return {
      ok: false,
      message: (await failureStatus.textContent())?.trim() || "Mark read failed",
    };
  }

  const successStatus = page.locator(".notification-status", { hasText: /Notification marked as read\./i }).first();
  const readPill = page.locator(".notification-actions .pill", { hasText: /(Marked just now|Read)/i }).first();
  const statusCount = await successStatus.count();
  const pillCount = await readPill.count();

  if (statusCount === 0 && pillCount === 0) {
    return {
      ok: false,
      message: "Notification mark-read did not surface success feedback.",
    };
  }

  return { ok: true, message: "" };
}

async function runContrastAudit(page, selectors, minContrast) {
  return page.evaluate(
    ({ selectorsArg, minContrastArg }) => {
      function parseColor(value) {
        if (!value || typeof value !== "string") return null;
        const trimmed = value.trim().toLowerCase();
        if (trimmed === "transparent") return null;
        const match = trimmed.match(/^rgba?\(([^)]+)\)$/);
        if (!match) return null;
        const channels = match[1]
          .split(",")
          .map((token) => Number(token.trim()))
          .filter((token) => Number.isFinite(token));
        if (channels.length < 3) return null;
        const [r, g, b, a] = channels;
        return {
          r: Math.max(0, Math.min(255, r)),
          g: Math.max(0, Math.min(255, g)),
          b: Math.max(0, Math.min(255, b)),
          a: typeof a === "number" ? Math.max(0, Math.min(1, a)) : 1,
        };
      }

      function channelToLinear(value) {
        const c = value / 255;
        if (c <= 0.03928) return c / 12.92;
        return ((c + 0.055) / 1.055) ** 2.4;
      }

      function luminance(color) {
        return (
          0.2126 * channelToLinear(color.r) +
          0.7152 * channelToLinear(color.g) +
          0.0722 * channelToLinear(color.b)
        );
      }

      function contrastRatio(fg, bg) {
        const lighter = Math.max(luminance(fg), luminance(bg));
        const darker = Math.min(luminance(fg), luminance(bg));
        return (lighter + 0.05) / (darker + 0.05);
      }

      function isVisible(node) {
        if (!(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none") return false;
        if (Number(style.opacity || "1") < 0.05) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      }

      function findBackgroundColor(node) {
        let current = node;
        while (current && current instanceof HTMLElement) {
          const style = window.getComputedStyle(current);
          const parsed = parseColor(style.backgroundColor || "");
          if (parsed && parsed.a > 0.95) return parsed;
          current = current.parentElement;
        }

        const bodyBg = parseColor(window.getComputedStyle(document.body).backgroundColor || "");
        return bodyBg || { r: 255, g: 255, b: 255, a: 1 };
      }

      const issues = [];
      const seen = new Set();
      const selector = selectorsArg.join(",");
      const nodes = Array.from(document.querySelectorAll(selector));

      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isVisible(node)) continue;

        const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 3) continue;

        const key = `${node.tagName}:${text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const style = window.getComputedStyle(node);
        const fg = parseColor(style.color || "");
        if (!fg) continue;

        const bg = findBackgroundColor(node);
        const ratio = contrastRatio(fg, bg);

        if (ratio < minContrastArg) {
          issues.push({
            text: text.slice(0, 120),
            ratio: Number(ratio.toFixed(2)),
            fontSize: style.fontSize,
            selector: node.className ? `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}` : node.tagName.toLowerCase(),
          });
        }
      }

      return {
        theme: document.documentElement.getAttribute("data-portal-theme") || "portal",
        issueCount: issues.length,
        issues: issues.slice(0, 30),
      };
    },
    {
      selectorsArg: selectors,
      minContrastArg: minContrast,
    }
  );
}

async function assertNoPermissionOrIndexError(page, labelPrefixes) {
  const patterns = [
    /Missing or insufficient permissions\./i,
    /requires an index/i,
    /failed-precondition/i,
  ];

  for (const prefix of labelPrefixes) {
    const locator = page.locator(`text=${prefix}`).first();
    if ((await locator.count()) > 0) {
      const text = (await locator.textContent())?.trim() || prefix;
      throw new Error(text);
    }
  }

  const bodyText = (await page.textContent("body")) || "";
  for (const pattern of patterns) {
    if (pattern.test(bodyText)) {
      throw new Error(`Detected blocking error text matching ${pattern}`);
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.requireAuth && (!options.staffEmail || !options.staffPassword)) {
    throw new Error("Authenticated canary requires staff credentials (PORTAL_STAFF_EMAIL / PORTAL_STAFF_PASSWORD).");
  }

  await ensureDir(options.outputDir);

  const summary = {
    status: "passed",
    baseUrl: options.baseUrl,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: "",
    reportPath: options.reportPath,
    checks: [],
    errors: [],
    screenshots: [],
    contrast: {
      light: [],
      dark: [],
    },
  };

  const browser = await chromium.launch({ headless: options.headless });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: "MonsoonFirePortalAuthenticatedCanary/1.0",
    });
    const page = await context.newPage();

    await check(summary, "base URL reachable", async () => {
      await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(800);
      await takeScreenshot(page, options.outputDir, "canary-01-home.png", summary, "home");
    });

    await check(summary, "authenticate staff account", async () => {
      const isSignedOut = await waitForAuthReady(page);
      if (!isSignedOut) return;
      await signInWithEmail(page, options.staffEmail, options.staffPassword);
      const afterAuth = await waitForAuthReady(page);
      if (afterAuth) throw new Error("User remains signed out after login attempt.");
      await takeScreenshot(page, options.outputDir, "canary-02-authenticated-dashboard.png", summary, "authenticated dashboard");
    });

    if (!options.themeOnly) {
      await check(summary, "dashboard piece click-through opens my pieces detail", async () => {
        await clickNavItem(page, "Dashboard", true);
        await page
          .getByRole("heading", { name: /(Your studio dashboard|Dashboard)/i })
          .first()
          .waitFor({ timeout: 30000 });

        let openedFromDashboard = false;
        const firstPieceThumb = page.locator(".piece-thumb").first();
        if ((await firstPieceThumb.count()) > 0) {
          await firstPieceThumb.click({ timeout: 10000 });
          openedFromDashboard = true;
        } else {
          const openMyPiecesButton = page.getByRole("button", { name: /^Open My Pieces$/i }).first();
          if ((await openMyPiecesButton.count()) > 0) {
            await openMyPiecesButton.click({ timeout: 10000 });
            openedFromDashboard = true;
          } else {
            await clickNavItem(page, "My Pieces", true);
          }
        }

        await page.getByRole("heading", { name: /^My Pieces$/i }).first().waitFor({ timeout: 30000 });

        const pieceAlert = page.locator(".inline-alert", { hasText: /^Pieces failed:/i }).first();
        if ((await pieceAlert.count()) > 0) {
          const message = (await pieceAlert.textContent())?.trim() || "Pieces failed";
          throw new Error(message);
        }

        const permissionError = page.locator("text=Missing or insufficient permissions.").first();
        if ((await permissionError.count()) > 0) {
          throw new Error("My Pieces still shows permission denied text.");
        }

        const detailTitle = page.locator(".detail-title").first();
        let attemptedOpenDetails = false;
        if ((await detailTitle.count()) === 0) {
          const viewDetailsButton = page.getByRole("button", { name: /^View details$/i }).first();
          if ((await viewDetailsButton.count()) > 0) {
            attemptedOpenDetails = true;
            await viewDetailsButton.click({ timeout: 10000 });
          } else {
            const firstRow = page.locator(".piece-row").first();
            if ((await firstRow.count()) > 0) {
              attemptedOpenDetails = true;
              await firstRow.click({ timeout: 10000 });
            }
          }
        }

        if (attemptedOpenDetails || (await detailTitle.count()) > 0) {
          await page.locator(".detail-title").first().waitFor({ timeout: 10000 });
        } else {
          const emptyState = page
            .locator(".empty-state")
            .filter({
              hasText: /(No pieces yet|Nothing currently in flight|first firing journey starts)/i,
            })
            .first();
          if ((await emptyState.count()) === 0) {
            throw new Error("My Pieces has no selectable rows and no recognized empty-state guidance.");
          }
          if (!openedFromDashboard) {
            throw new Error("Dashboard did not provide a direct path into My Pieces.");
          }
        }

        await takeScreenshot(page, options.outputDir, "canary-03-my-pieces-detail.png", summary, "my pieces detail");
      });

      await check(summary, "notifications mark read gives user feedback", async () => {
        await clickNavItem(page, "Notifications", true);
        await page.getByRole("heading", { name: /^Notifications$/i }).first().waitFor({ timeout: 30000 });

        const markReadButton = page.getByRole("button", { name: /^Mark read$/i }).first();
        if ((await markReadButton.count()) > 0) {
          const clickAndReadStatus = async (button) => {
            await button.click({ timeout: 10000 });
            await page.waitForTimeout(1200);
            return readMarkReadOutcome(page);
          };

          let status = await clickAndReadStatus(markReadButton);
          if (!status.ok && isRetryableMarkReadFailure(status.message)) {
            await page.reload({ waitUntil: "domcontentloaded" });
            await clickNavItem(page, "Notifications", true);
            await page.getByRole("heading", { name: /^Notifications$/i }).first().waitFor({ timeout: 30000 });

            const retryMarkReadButton = page.getByRole("button", { name: /^Mark read$/i }).first();
            if ((await retryMarkReadButton.count()) > 0) {
              status = await clickAndReadStatus(retryMarkReadButton);
            } else {
              status = { ok: true, message: "" };
            }
          }

          if (!status.ok) {
            throw new Error(status.message);
          }
        }

        await takeScreenshot(page, options.outputDir, "canary-04-notifications.png", summary, "notifications");
      });

      await check(summary, "messages page loads without index/precondition errors", async () => {
        await clickNavItem(page, "Messages", true);
        await page.getByRole("heading", { name: /^Messages$/i }).first().waitFor({ timeout: 30000 });

        const directMessagesError = page.locator("text=/^Direct messages failed:/i").first();
        if ((await directMessagesError.count()) > 0) {
          const message = (await directMessagesError.textContent())?.trim() || "Direct messages failed";
          throw new Error(message);
        }

        await assertNoPermissionOrIndexError(page, ["Direct messages failed:"]);
        await takeScreenshot(page, options.outputDir, "canary-05-messages.png", summary, "messages");
      });

      await check(summary, "ware check-in page loads without check-in/index errors", async () => {
        await clickNavSubItem(page, "Kiln Rentals", "Ware Check-in", true);
        await page.getByRole("heading", { name: /^Ware Check-in$/i }).first().waitFor({ timeout: 30000 });

        const listError = page.locator("text=/^Check-ins failed:/i").first();
        if ((await listError.count()) > 0) {
          const message = (await listError.textContent())?.trim() || "Check-ins failed";
          throw new Error(message);
        }

        await assertNoPermissionOrIndexError(page, ["Check-ins failed:"]);
        await takeScreenshot(page, options.outputDir, "canary-06-ware-checkin.png", summary, "ware check-in");
      });
    }

    await check(summary, "advanced diagnostics panel renders", async () => {
      await clickNavItem(page, "Dashboard", true);
      const openButton = page.getByRole("button", { name: /^Advanced diagnostics$/i }).first();
      if ((await openButton.count()) > 0) {
        await openButton.click({ timeout: 10000 });
      }

      const panel = page.locator("details.runtime-request-panel").first();
      await panel.waitFor({ timeout: 15000 });
      await panel.evaluate((node) => {
        if (node instanceof HTMLDetailsElement) {
          node.open = true;
        }
      });
      await page.waitForTimeout(300);
      await takeScreenshot(page, options.outputDir, "canary-07-advanced-diagnostics.png", summary, "advanced diagnostics");
    });

    if (options.runThemeSweep) {
      const pages = [
        {
          label: "Dashboard",
          navigate: async () => {
            await clickNavItem(page, "Dashboard", true);
            await page
              .getByRole("heading", { name: /(Your studio dashboard|Dashboard)/i })
              .first()
              .waitFor({ timeout: 30000 });
          },
        },
        {
          label: "Notifications",
          navigate: async () => {
            await clickNavItem(page, "Notifications", true);
            await page.getByRole("heading", { name: /^Notifications$/i }).first().waitFor({ timeout: 30000 });
          },
        },
        {
          label: "Messages",
          navigate: async () => {
            await clickNavItem(page, "Messages", true);
            await page.getByRole("heading", { name: /^Messages$/i }).first().waitFor({ timeout: 30000 });
          },
        },
        {
          label: "Ware Check-in",
          navigate: async () => {
            await clickNavSubItem(page, "Kiln Rentals", "Ware Check-in", true);
            await page.getByRole("heading", { name: /^Ware Check-in$/i }).first().waitFor({ timeout: 30000 });
          },
        },
      ];

      for (const theme of ["light", "dark"]) {
        await check(summary, `theme contrast sweep (${theme})`, async () => {
          // Theme switch control lives on Dashboard; always normalize there first.
          await pages[0].navigate();
          await ensureTheme(page, theme);

          for (const pageConfig of pages) {
            await pageConfig.navigate();
            const result = await runContrastAudit(
              page,
              [
                ".page h1",
                ".page .page-subtitle",
                ".page .card-title",
                ".page .card-subtitle",
                ".page .inline-alert",
                ".notification-title",
                ".notification-text",
                ".detail-title",
                ".piece-meta",
                ".runtime-request-panel summary",
                ".runtime-request-body",
              ],
              options.minContrast
            );

            summary.contrast[theme].push({
              page: pageConfig.label,
              issueCount: result.issueCount,
              issues: result.issues,
            });

            if (result.issueCount > 0) {
              throw new Error(
                `${pageConfig.label} has ${result.issueCount} contrast issues in ${theme} theme (threshold ${options.minContrast}).`
              );
            }

            const screenshotName = `canary-theme-${theme}-${pageConfig.label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}.png`;
            await takeScreenshot(
              page,
              options.outputDir,
              screenshotName,
              summary,
              `${theme} ${pageConfig.label}`
            );
          }
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  summary.finishedAtIso = new Date().toISOString();
  if (summary.checks.some((item) => item.status === "failed")) {
    summary.status = "failed";
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`baseUrl: ${summary.baseUrl}\n`);
    summary.checks.forEach((checkItem) => {
      process.stdout.write(`- ${checkItem.label}: ${checkItem.status}${checkItem.message ? ` (${checkItem.message})` : ""}\n`);
    });
    process.stdout.write(`report: ${options.reportPath}\n`);
  }

  if (summary.status !== "passed") {
    process.exit(1);
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-authenticated-canary failed: ${message}`);
  process.exit(1);
});
