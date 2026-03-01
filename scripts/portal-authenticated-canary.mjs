#!/usr/bin/env node

/* eslint-disable no-console */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_BASE_URL = "https://monsoonfire-portal.web.app";
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "qa", "portal-authenticated-canary");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-authenticated-canary.json");
const DEFAULT_STAFF_CREDENTIALS_PATH = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_MY_PIECES_READY_TIMEOUT_MS = 18000;
const DEFAULT_MY_PIECES_RELOAD_RETRY_COUNT = 1;
const DEFAULT_MARK_READ_RETRY_COUNT = 1;
const THEME_SWEEP_TARGETS = ["light", "dark", "mono"];
const NAV_DOCK_SWEEP_TARGETS = [
  {
    dock: "left",
    label: "Left",
    screenshot: "canary-02f-nav-dock-left.png",
    summaryLabel: "nav dock left",
  },
  {
    dock: "top",
    label: "Top",
    screenshot: "canary-02g-nav-dock-top.png",
    summaryLabel: "nav dock top",
  },
  {
    dock: "right",
    label: "Right",
    screenshot: "canary-02h-nav-dock-right.png",
    summaryLabel: "nav dock right",
  },
];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL,
    outputDir: process.env.PORTAL_CANARY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    reportPath: process.env.PORTAL_CANARY_REPORT || DEFAULT_REPORT_PATH,
    staffEmail: String(process.env.PORTAL_STAFF_EMAIL || "").trim(),
    staffPassword: String(process.env.PORTAL_STAFF_PASSWORD || "").trim(),
    credentialsPath:
      process.env.PORTAL_AGENT_STAFF_CREDENTIALS ||
      DEFAULT_STAFF_CREDENTIALS_PATH,
    credentialsJson: String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim(),
    requireAuth: true,
    headless: true,
    runThemeSweep: true,
    functionalOnly: false,
    themeOnly: false,
    minContrast: 4.2,
    feedbackPath: String(process.env.PORTAL_CANARY_FEEDBACK_PATH || "").trim(),
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

    if (arg === "--feedback") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --feedback");
      options.feedbackPath = resolve(process.cwd(), String(next).trim());
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

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parsePatternList(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => item.length <= 120)
    .slice(0, 20);
  return Array.from(new Set(normalized));
}

async function resolveCanaryFeedbackProfile(feedbackPath) {
  const profile = {
    loaded: false,
    sourcePath: String(feedbackPath || "").trim(),
    sourceRunCount: 0,
    agenticDirectiveCount: 0,
    myPiecesReadyTimeoutMs: DEFAULT_MY_PIECES_READY_TIMEOUT_MS,
    myPiecesReloadRetryCount: DEFAULT_MY_PIECES_RELOAD_RETRY_COUNT,
    markReadRetryCount: DEFAULT_MARK_READ_RETRY_COUNT,
    myPiecesEmptyStatePatterns: [],
    warnings: [],
  };

  if (!profile.sourcePath) return profile;
  if (!(await pathExists(profile.sourcePath))) {
    profile.warnings.push(`Feedback profile not found at ${profile.sourcePath}; using defaults.`);
    return profile;
  }

  let parsed;
  try {
    const raw = await readFile(profile.sourcePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    profile.warnings.push(
      `Feedback profile parse failed (${error instanceof Error ? error.message : String(error)}); using defaults.`
    );
    return profile;
  }

  const feedbackRoot = parsed?.feedback && typeof parsed.feedback === "object" ? parsed.feedback : parsed;

  profile.myPiecesReadyTimeoutMs = clampInteger(
    feedbackRoot?.myPiecesReadyTimeoutMs,
    12000,
    45000,
    DEFAULT_MY_PIECES_READY_TIMEOUT_MS
  );
  profile.myPiecesReloadRetryCount = clampInteger(
    feedbackRoot?.myPiecesReloadRetryCount,
    0,
    3,
    DEFAULT_MY_PIECES_RELOAD_RETRY_COUNT
  );
  profile.markReadRetryCount = clampInteger(
    feedbackRoot?.markReadRetryCount,
    0,
    3,
    DEFAULT_MARK_READ_RETRY_COUNT
  );
  profile.myPiecesEmptyStatePatterns = parsePatternList(feedbackRoot?.myPiecesEmptyStatePatterns);
  profile.sourceRunCount = clampInteger(
    feedbackRoot?.sourceRunCount ?? parsed?.sourceRunCount,
    0,
    200,
    0
  );
  profile.agenticDirectiveCount = clampInteger(
    feedbackRoot?.agenticDirectiveCount ?? parsed?.agenticDirectiveCount,
    0,
    200,
    0
  );

  profile.loaded = true;
  return profile;
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

  const resolution = {
    source: staffEmail || staffPassword ? "PORTAL_STAFF_EMAIL / PORTAL_STAFF_PASSWORD" : "",
    attemptedSources: [],
    warnings: [],
  };

  const applyCandidate = (payload, sourceLabel) => {
    const candidate = parseStaffCredentialPayload(payload);
    const missing = [];
    if (!candidate.email) missing.push("email");
    if (!candidate.password) missing.push("password");

    if (missing.length > 0) {
      resolution.warnings.push(`${sourceLabel} missing ${missing.join(" and ")}.`);
    }

    let consumed = false;
    if (!staffEmail && candidate.email) {
      staffEmail = candidate.email;
      consumed = true;
    }
    if (!staffPassword && candidate.password) {
      staffPassword = candidate.password;
      consumed = true;
    }

    if (consumed && !resolution.source) {
      resolution.source = sourceLabel;
    }
  };

  if ((!staffEmail || !staffPassword) && options.credentialsJson) {
    const label = "PORTAL_AGENT_STAFF_CREDENTIALS_JSON";
    resolution.attemptedSources.push(label);
    try {
      const parsed = JSON.parse(options.credentialsJson);
      applyCandidate(parsed, label);
    } catch (error) {
      resolution.warnings.push(
        `${label} parse failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  if ((!staffEmail || !staffPassword) && options.credentialsPath) {
    const path = resolve(process.cwd(), options.credentialsPath);
    resolution.attemptedSources.push(path);

    if (await pathExists(path)) {
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        applyCandidate(parsed, `credentials file: ${path}`);
      } catch (error) {
        resolution.warnings.push(
          `Credential file parse failed at ${path} (${error instanceof Error ? error.message : String(error)}).`
        );
      }
    } else {
      resolution.warnings.push(`Credential file not found at ${path}.`);
    }
  }

  if (!resolution.source && staffEmail && staffPassword) {
    resolution.source = "resolved";
  }

  return {
    staffEmail,
    staffPassword,
    ...resolution,
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

function addWarning(summary, message) {
  const text = String(message || "").trim();
  if (!text) return;
  summary.warnings.push(text);
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

async function findVisibleLocator(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return null;
}

async function resolveNavDockButton(page, dockLabel) {
  const matchers = [
    page.locator(".nav-dock-controls-inline .nav-dock-btn", {
      hasText: new RegExp(`^${regexSafe(dockLabel)}$`, "i"),
    }),
    page.locator(".nav-dock-controls .nav-dock-btn", {
      hasText: new RegExp(`^${regexSafe(dockLabel)}$`, "i"),
    }),
  ];

  for (const matcher of matchers) {
    const visible = await findVisibleLocator(matcher);
    if (visible) return visible;
  }

  return null;
}

async function ensureNavDock(page, targetDock) {
  if (targetDock !== "left" && targetDock !== "top" && targetDock !== "right") {
    throw new Error(`Unsupported nav dock target: ${targetDock}`);
  }

  const alreadySet = await page.evaluate((expectedDock) => {
    const shell = document.querySelector(".app-shell");
    return shell instanceof HTMLElement && shell.classList.contains(`dock-${expectedDock}`);
  }, targetDock);
  if (alreadySet) return;

  const targetConfig = NAV_DOCK_SWEEP_TARGETS.find((entry) => entry.dock === targetDock);
  if (!targetConfig) {
    throw new Error(`Unsupported nav dock target: ${targetDock}`);
  }

  const button = await resolveNavDockButton(page, targetConfig.label);
  if (!button) {
    throw new Error(`Navigation dock button not found for ${targetConfig.label}.`);
  }

  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ timeout: 10000 });
  await page.waitForFunction(
    (expectedDock) => {
      const shell = document.querySelector(".app-shell");
      return shell instanceof HTMLElement && shell.classList.contains(`dock-${expectedDock}`);
    },
    targetDock,
    { timeout: 12000 }
  );
  await page.waitForTimeout(450);
}

async function collectMyPiecesState(page, extraEmptyStatePatterns = []) {
  return page.evaluate(({ patterns }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity || "1") < 0.05) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };

    const textOf = (node) => normalize(node?.textContent || "");
    const visibleText = (selector) =>
      Array.from(document.querySelectorAll(selector))
        .filter((node) => isVisible(node))
        .map((node) => textOf(node))
        .filter(Boolean);

    const emptyStates = visibleText(".empty-state");
    const nonLoadingEmptyStates = emptyStates.filter((text) => !/^Loading pieces\.\.\.$/i.test(text));
    const inlineAlerts = visibleText(".inline-alert");
    const headings = visibleText("h1, h2, h3");

    const piecesFailedMessage = inlineAlerts.find((text) => /^Pieces failed:/i.test(text)) || "";
    const bodyText = textOf(document.body);

    const countVisible = (selector) =>
      Array.from(document.querySelectorAll(selector)).filter((node) => isVisible(node)).length;

    const viewDetailsCount = Array.from(document.querySelectorAll("button")).filter((node) => {
      if (!isVisible(node)) return false;
      return /^View details$/i.test(textOf(node));
    }).length;

    const customPatterns = Array.isArray(patterns)
      ? patterns
          .map((item) => String(item || "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20)
      : [];

    const hasRecognizedEmptyGuidance = nonLoadingEmptyStates.some((text) =>
      /(No pieces yet|Nothing currently in flight|first firing journey starts|No pieces in this view|No pieces found|No results)/i.test(text)
    );
    const hasCustomEmptyStateGuidance = nonLoadingEmptyStates.some((text) => {
      const lower = text.toLowerCase();
      return customPatterns.some((pattern) => lower.includes(pattern));
    });

    return {
      myPiecesHeadingVisible: headings.some((text) => /^My Pieces$/i.test(text)),
      rowCount: countVisible(".piece-row"),
      pieceThumbCount: countVisible(".piece-thumb"),
      detailTitleCount: countVisible(".detail-title"),
      viewDetailsCount,
      loadingVisible: emptyStates.some((text) => /^Loading pieces\.\.\.$/i.test(text)),
      nonLoadingEmptyStateCount: nonLoadingEmptyStates.length,
      nonLoadingEmptyStates: nonLoadingEmptyStates.slice(0, 3),
      hasRecognizedEmptyGuidance: hasRecognizedEmptyGuidance || hasCustomEmptyStateGuidance,
      piecesFailedMessage,
      permissionDenied: /Missing or insufficient permissions\./i.test(bodyText),
    };
  }, { patterns: extraEmptyStatePatterns });
}

async function waitForMyPiecesReadyState(page, timeoutMs = DEFAULT_MY_PIECES_READY_TIMEOUT_MS, extraEmptyStatePatterns = []) {
  const deadline = Date.now() + timeoutMs;
  let state = await collectMyPiecesState(page, extraEmptyStatePatterns);

  while (Date.now() < deadline) {
    if (
      state.piecesFailedMessage ||
      state.permissionDenied ||
      state.detailTitleCount > 0 ||
      state.rowCount > 0 ||
      state.viewDetailsCount > 0 ||
      state.nonLoadingEmptyStateCount > 0
    ) {
      return state;
    }

    await page.waitForTimeout(state.loadingVisible ? 350 : 500);
    state = await collectMyPiecesState(page, extraEmptyStatePatterns);
  }

  return state;
}

function formatMyPiecesStateForError(state) {
  const previews = (state.nonLoadingEmptyStates || []).join(" | ");
  return (
    `headingVisible=${String(state.myPiecesHeadingVisible)}; ` +
    `rows=${state.rowCount}; ` +
    `pieceThumbs=${state.pieceThumbCount}; ` +
    `viewDetailsButtons=${state.viewDetailsCount}; ` +
    `detailTitles=${state.detailTitleCount}; ` +
    `loadingVisible=${String(state.loadingVisible)}; ` +
    `emptyStates=${state.nonLoadingEmptyStateCount}; ` +
    `recognizedEmptyGuidance=${String(state.hasRecognizedEmptyGuidance)}; ` +
    `emptyStatePreview=${previews || "none"}`
  );
}

async function detailsIsOpen(detailsLocator) {
  return detailsLocator.evaluate((node) => {
    if (!(node instanceof HTMLDetailsElement)) return false;
    return node.open;
  });
}

async function setDetailsOpen(detailsLocator, shouldOpen, label) {
  const current = await detailsIsOpen(detailsLocator);
  if (current === shouldOpen) return;

  const summary = detailsLocator.locator("summary").first();
  if ((await summary.count()) === 0) {
    throw new Error(`Details summary not found for ${label}`);
  }

  await summary.click({ timeout: 10000 });
  await detailsLocator.waitFor({ timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const next = await detailsIsOpen(detailsLocator);
  if (next !== shouldOpen) {
    throw new Error(`Could not ${shouldOpen ? "open" : "close"} details for ${label}`);
  }
}

async function verifyCheckInOptionalSections(page) {
  const form = page.locator(".checkin-form").first();
  await form.waitFor({ timeout: 15000 });

  const optionalSteps = form.locator("details.checkin-optional-step");
  const optionalCount = await optionalSteps.count();
  if (optionalCount < 3) {
    throw new Error(`Expected at least 3 optional check-in sections, found ${optionalCount}.`);
  }

  const photoStep = optionalSteps.nth(0);
  const extrasStep = optionalSteps.nth(1);
  const notesStep = optionalSteps.nth(2);

  const checks = [
    { label: "photo", locator: photoStep },
    { label: "extras", locator: extrasStep },
    { label: "notes", locator: notesStep },
  ];

  for (const check of checks) {
    if (await detailsIsOpen(check.locator)) {
      throw new Error(`Optional check-in section should start collapsed: ${check.label}`);
    }
  }

  await setDetailsOpen(photoStep, true, "photo optional section");
  const photoPlaceholder = photoStep.locator(".photo-placeholder").first();
  if ((await photoPlaceholder.count()) === 0) {
    throw new Error("Photo optional section did not render expected placeholder content.");
  }
  await setDetailsOpen(photoStep, false, "photo optional section");

  await setDetailsOpen(extrasStep, true, "extras optional section");
  const firstAddonToggle = extrasStep.locator('input[type="checkbox"]').first();
  if ((await firstAddonToggle.count()) === 0) {
    throw new Error("Extras optional section is missing addon toggles.");
  }
  await firstAddonToggle.check({ timeout: 10000 });
  if (!(await firstAddonToggle.isChecked())) {
    throw new Error("Extras optional toggle did not check.");
  }
  await firstAddonToggle.uncheck({ timeout: 10000 });
  await setDetailsOpen(extrasStep, false, "extras optional section");

  await setDetailsOpen(notesStep, true, "notes optional section");
  const noteText = "Canary note persistence check";
  const notesInput = notesStep.getByLabel("General notes").first();
  await notesInput.fill(noteText);

  const moreDetails = notesStep.locator("details.notes-details").first();
  await setDetailsOpen(moreDetails, true, "notes more-details section");
  const firstTag = notesStep.getByRole("button", { name: /^Fragile handles$/i }).first();
  await firstTag.click({ timeout: 10000 });
  const tagSelected = await firstTag.getAttribute("aria-pressed");
  if (tagSelected !== "true") {
    throw new Error("Notes tag selection did not persist pressed state after click.");
  }

  await setDetailsOpen(notesStep, false, "notes optional section");
  await setDetailsOpen(notesStep, true, "notes optional section");
  const persistedNoteText = await notesInput.inputValue();
  if (persistedNoteText !== noteText) {
    throw new Error("Notes optional section did not preserve general notes text after collapse/reopen.");
  }
  const persistedTagSelected = await firstTag.getAttribute("aria-pressed");
  if (persistedTagSelected !== "true") {
    throw new Error("Notes optional section did not preserve note-tag selection after collapse/reopen.");
  }
}

function getThemeToggle(page, label) {
  return page.getByRole("button", { name: new RegExp(`^Switch to ${regexSafe(label)} theme$`, "i") }).first();
}

async function openProfileView(page) {
  const profileButton = page.getByRole("button", { name: /^Open profile$/i }).first();
  if ((await profileButton.count()) > 0) {
    await profileButton.click({ timeout: 10000 });
    await page.waitForTimeout(650);
    return;
  }
  await clickNavItem(page, "Profile", true);
}

async function setThemeFromProfile(page, themeValue) {
  await openProfileView(page);
  await page.locator(".profile-form").first().waitFor({ timeout: 12000 });

  let themeSelect = page.getByLabel(/^Theme$/i).first();
  if ((await themeSelect.count()) === 0) {
    themeSelect = page
      .locator("select")
      .filter({ has: page.locator(`option[value="${themeValue}"]`) })
      .first();
  }

  await themeSelect.waitFor({ timeout: 10000 });
  if ((await themeSelect.count()) === 0) {
    throw new Error("Theme selector not found on Profile page.");
  }

  await themeSelect.selectOption(themeValue);
  await page.waitForFunction(
    (expectedTheme) => document.documentElement.getAttribute("data-portal-theme") === expectedTheme,
    themeValue,
    { timeout: 10000 }
  );
  await page.waitForTimeout(450);
}

async function ensureTheme(page, targetTheme) {
  if (targetTheme === "mono") {
    await setThemeFromProfile(page, "mono");
    return;
  }

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

  const credentialResolution = await resolveStaffCredentials(options);
  const feedbackProfile = await resolveCanaryFeedbackProfile(options.feedbackPath);
  options.staffEmail = credentialResolution.staffEmail;
  options.staffPassword = credentialResolution.staffPassword;

  if (options.requireAuth && (!options.staffEmail || !options.staffPassword)) {
    const attempted = credentialResolution.attemptedSources.length
      ? ` Attempted: ${credentialResolution.attemptedSources.join(", ")}.`
      : "";
    const warnings = credentialResolution.warnings.length
      ? ` ${credentialResolution.warnings.join(" ")}`
      : "";
    throw new Error(
      `Authenticated canary requires staff credentials (email + password). ` +
        `Provide PORTAL_STAFF_EMAIL/PORTAL_STAFF_PASSWORD, ` +
        `or supply PORTAL_AGENT_STAFF_CREDENTIALS_JSON / --credentials-json ` +
        `or --credentials <path> (default ${DEFAULT_STAFF_CREDENTIALS_PATH}).` +
        `${attempted}${warnings}`
    );
  }

  await ensureDir(options.outputDir);

  const summary = {
    status: "passed",
    baseUrl: options.baseUrl,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: "",
    reportPath: options.reportPath,
    auth: {
      requireAuth: options.requireAuth,
      credentialSource: credentialResolution.source || "unresolved",
      attemptedSources: credentialResolution.attemptedSources,
      warnings: credentialResolution.warnings,
    },
    feedback: {
      enabled: Boolean(options.feedbackPath),
      loaded: feedbackProfile.loaded,
      profilePath: feedbackProfile.sourcePath || "",
      sourceRunCount: feedbackProfile.sourceRunCount,
      agenticDirectiveCount: feedbackProfile.agenticDirectiveCount,
      myPiecesReadyTimeoutMs: feedbackProfile.myPiecesReadyTimeoutMs,
      myPiecesReloadRetryCount: feedbackProfile.myPiecesReloadRetryCount,
      markReadRetryCount: feedbackProfile.markReadRetryCount,
      myPiecesEmptyStatePatterns: feedbackProfile.myPiecesEmptyStatePatterns,
    },
    checks: [],
    errors: [],
    warnings: [],
    screenshots: [],
    contrast: {
      light: [],
      dark: [],
      mono: [],
    },
  };

  feedbackProfile.warnings.forEach((warning) => addWarning(summary, warning));

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
      await check(summary, "navigation dock controls switch left/top/right", async () => {
        await clickNavItem(page, "Dashboard", true);

        for (const target of NAV_DOCK_SWEEP_TARGETS) {
          await ensureNavDock(page, target.dock);
          await clickNavItem(page, "Dashboard", true);
          await takeScreenshot(page, options.outputDir, target.screenshot, summary, target.summaryLabel);
        }

        // Restore baseline navigation dock before remaining checks.
        await ensureNavDock(page, "left");
        await clickNavItem(page, "Dashboard", true);
      });

      await check(summary, "legacy requests deep links route to supported pages", async () => {
        const scenarios = [
          {
            label: "support fallback",
            relativeUrl: "/requests",
            heading: /^Support$/i,
            noticeText: /opens Support/i,
            screenshot: "canary-02b-legacy-requests-support.png",
          },
          {
            label: "lending fallback",
            relativeUrl: "/requests?intent=lending",
            heading: /^Lending Library$/i,
            noticeText: /opens Lending Library/i,
            screenshot: "canary-02c-legacy-requests-lending.png",
          },
          {
            label: "workshops fallback",
            relativeUrl: "/requests?intent=workshop",
            heading: /^Events & workshops$/i,
            noticeText: /opens Workshops/i,
            screenshot: "canary-02d-legacy-requests-workshops.png",
          },
          {
            label: "hash-route fallback",
            relativeUrl: "/#/requests?intent=workshop",
            heading: /^Events & workshops$/i,
            noticeText: /opens Workshops/i,
            screenshot: "canary-02e-legacy-requests-hash-workshops.png",
          },
        ];

        for (const scenario of scenarios) {
          await page.goto(`${options.baseUrl}${scenario.relativeUrl}`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await page.waitForTimeout(800);
          await page.getByRole("heading", { name: scenario.heading }).first().waitFor({ timeout: 30000 });

          const notice = page.locator(".notice", { hasText: /Requests has moved\./i }).first();
          if ((await notice.count()) === 0) {
            throw new Error(`Requests migration notice missing for ${scenario.label}.`);
          }

          const noticeCopy = ((await notice.textContent()) || "").replace(/\s+/g, " ").trim();
          if (!scenario.noticeText.test(noticeCopy)) {
            throw new Error(
              `Unexpected migration notice for ${scenario.label}: ${noticeCopy || "(empty)"}`
            );
          }

          const currentUrl = new URL(page.url());
          if (/^\/(?:community\/)?requests(?:\/|$)/i.test(currentUrl.pathname)) {
            throw new Error(`Legacy requests path still active after redirect for ${scenario.label}.`);
          }

          await takeScreenshot(page, options.outputDir, scenario.screenshot, summary, `legacy requests ${scenario.label}`);
        }
      });

      await check(summary, "dashboard piece click-through opens my pieces detail", async () => {
        try {
          await clickNavItem(page, "Dashboard", true);
          await page
            .getByRole("heading", { name: /(Your studio dashboard|Dashboard)/i })
            .first()
            .waitFor({ timeout: 30000 });

          let openedFromDashboard = false;
          let routeUsed = "sidebar-nav";

          const firstPieceThumb = page.locator(".piece-thumb").first();
          if ((await firstPieceThumb.count()) > 0) {
            try {
              await firstPieceThumb.click({ timeout: 10000 });
              openedFromDashboard = true;
              routeUsed = "dashboard-piece-thumb";
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              addWarning(summary, `Could not click dashboard piece thumb; falling back. ${message}`);
            }
          }

          if (!openedFromDashboard) {
            const openMyPiecesButton = page.getByRole("button", { name: /^Open My Pieces$/i }).first();
            if ((await openMyPiecesButton.count()) > 0) {
              await openMyPiecesButton.click({ timeout: 10000 });
              openedFromDashboard = true;
              routeUsed = "dashboard-open-my-pieces-button";
            } else {
              await clickNavItem(page, "My Pieces", true);
            }
          }

          await page.getByRole("heading", { name: /^My Pieces$/i }).first().waitFor({ timeout: 30000 });

          let myPiecesState = await waitForMyPiecesReadyState(
            page,
            feedbackProfile.myPiecesReadyTimeoutMs,
            feedbackProfile.myPiecesEmptyStatePatterns
          );
          if (myPiecesState.piecesFailedMessage) {
            throw new Error(myPiecesState.piecesFailedMessage);
          }
          if (myPiecesState.permissionDenied) {
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
            let reloadAttempts = 0;
            while (
              myPiecesState.nonLoadingEmptyStateCount === 0 &&
              reloadAttempts < feedbackProfile.myPiecesReloadRetryCount
            ) {
              await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
              await clickNavItem(page, "My Pieces", true);
              await page.getByRole("heading", { name: /^My Pieces$/i }).first().waitFor({ timeout: 30000 });
              myPiecesState = await waitForMyPiecesReadyState(
                page,
                feedbackProfile.myPiecesReadyTimeoutMs,
                feedbackProfile.myPiecesEmptyStatePatterns
              );
              reloadAttempts += 1;

              if (myPiecesState.piecesFailedMessage) {
                throw new Error(myPiecesState.piecesFailedMessage);
              }
              if (myPiecesState.permissionDenied) {
                throw new Error("My Pieces still shows permission denied text.");
              }
            }

            if (myPiecesState.nonLoadingEmptyStateCount === 0) {
              throw new Error(
                `My Pieces did not surface rows, details, or an empty state after retry. ` +
                  `route=${routeUsed}; ${formatMyPiecesStateForError(myPiecesState)}`
              );
            }

            if (!myPiecesState.hasRecognizedEmptyGuidance) {
              addWarning(
                summary,
                `My Pieces empty-state text is unrecognized but non-empty. ` +
                  `route=${routeUsed}; ${formatMyPiecesStateForError(myPiecesState)}`
              );
            }

            if (!openedFromDashboard) {
              addWarning(
                summary,
                `Dashboard did not provide a direct My Pieces entry point; used ${routeUsed} fallback.`
              );
            }
          }

          await takeScreenshot(page, options.outputDir, "canary-03-my-pieces-detail.png", summary, "my pieces detail");
        } catch (error) {
          try {
            await takeScreenshot(
              page,
              options.outputDir,
              "canary-03-my-pieces-failure.png",
              summary,
              "my pieces failure"
            );
          } catch {
            // Ignore screenshot failures; preserve original check error.
          }
          throw error;
        }
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
          let retriesUsed = 0;
          while (
            !status.ok &&
            isRetryableMarkReadFailure(status.message) &&
            retriesUsed < feedbackProfile.markReadRetryCount
          ) {
            await page.reload({ waitUntil: "domcontentloaded" });
            await clickNavItem(page, "Notifications", true);
            await page.getByRole("heading", { name: /^Notifications$/i }).first().waitFor({ timeout: 30000 });

            const retryMarkReadButton = page.getByRole("button", { name: /^Mark read$/i }).first();
            if ((await retryMarkReadButton.count()) > 0) {
              status = await clickAndReadStatus(retryMarkReadButton);
            } else {
              status = { ok: true, message: "" };
            }
            retriesUsed += 1;
          }

          if (!status.ok) {
            throw new Error(status.message);
          }
        }

        await takeScreenshot(page, options.outputDir, "canary-04-notifications.png", summary, "notifications");
      });

      await check(summary, "workshops page shows event feed content", async () => {
        await clickNavSubItem(page, "Community", "Workshops", true);
        await page.getByRole("heading", { name: /^Events & workshops$/i }).first().waitFor({ timeout: 30000 });

        const seededWorkshop = page.locator(".event-card", { hasText: /QA Fixture Workshop/i }).first();
        if ((await seededWorkshop.count()) === 0) {
          const anyEventCard = page.locator(".event-card").first();
          const emptyState = page.locator(".events-empty").first();
          if ((await anyEventCard.count()) === 0 && (await emptyState.count()) === 0) {
            throw new Error("Workshops page did not render event cards or empty-state content.");
          }
        }

        await takeScreenshot(page, options.outputDir, "canary-04b-workshops-seeded.png", summary, "workshops seeded");
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

      await check(summary, "ware check-in optional sections stay collapsed by default and preserve values", async () => {
        await clickNavSubItem(page, "Kiln Rentals", "Ware Check-in", true);
        await page.getByRole("heading", { name: /^Ware Check-in$/i }).first().waitFor({ timeout: 30000 });
        await verifyCheckInOptionalSections(page);
        await takeScreenshot(
          page,
          options.outputDir,
          "canary-06b-ware-checkin-optional-sections.png",
          summary,
          "ware check-in optional sections"
        );
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

      for (const theme of THEME_SWEEP_TARGETS) {
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
    summary.warnings.forEach((warning) => {
      process.stdout.write(`! warning: ${warning}\n`);
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
