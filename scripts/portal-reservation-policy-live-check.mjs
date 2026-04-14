#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  mintStaffIdTokenFromPortalEnv,
  resolvePortalAgentStaffCredentials,
} from "./lib/firebase-auth-token.mjs";
import {
  loadPortalAutomationEnv,
  resolvePortalAgentStaffCredentialsPath,
} from "./lib/runtime-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

loadPortalAutomationEnv();

const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_OUTPUT_DIR = resolve(repoRoot, "output", "playwright", "portal", "reservation-policy-live-check");
const DEFAULT_REPORT_PATH = resolve(DEFAULT_OUTPUT_DIR, "report.json");
const DEFAULT_CREDENTIALS_PATH = resolvePortalAgentStaffCredentialsPath();

function clean(value) {
  return String(value ?? "").trim();
}

function decodeJwtExp(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

function buildPasswordSignInResponse({ email, uid, idToken, refreshToken }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = decodeJwtExp(idToken);
  const expiresIn = exp && exp > nowSeconds ? String(exp - nowSeconds) : "3600";
  return {
    kind: "identitytoolkit#VerifyPasswordResponse",
    localId: uid,
    email,
    registered: true,
    idToken,
    refreshToken,
    expiresIn,
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: clean(process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    outputDir: clean(process.env.PORTAL_RESERVATION_POLICY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
    reportPath: clean(process.env.PORTAL_RESERVATION_POLICY_REPORT || DEFAULT_REPORT_PATH),
    credentialsPath: clean(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || DEFAULT_CREDENTIALS_PATH),
    credentialsJson: clean(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON),
    staffEmail: clean(process.env.PORTAL_STAFF_EMAIL),
    staffPassword: clean(process.env.PORTAL_STAFF_PASSWORD),
    staffUid: clean(process.env.PORTAL_STAFF_UID),
    staffRefreshToken: clean(process.env.PORTAL_STAFF_REFRESH_TOKEN),
    firebaseApiKey: clean(process.env.PORTAL_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY),
    authMode: clean(process.env.PORTAL_CANARY_AUTH_MODE || "auto").toLowerCase() || "auto",
    headless: true,
    asJson: false,
    screenshotsOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--screenshots-only") {
      options.screenshotsOnly = true;
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
    if (arg === "--output-dir") {
      options.outputDir = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--credentials") {
      options.credentialsPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--credentials-json") {
      options.credentialsJson = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-email") {
      options.staffEmail = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-password") {
      options.staffPassword = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-uid") {
      options.staffUid = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-refresh-token") {
      options.staffRefreshToken = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key") {
      options.firebaseApiKey = next;
      index += 1;
      continue;
    }
    if (arg === "--auth-mode") {
      options.authMode = next.toLowerCase();
      index += 1;
      continue;
    }
  }

  const allowedAuthModes = new Set(["auto", "refresh-token", "password-ui"]);
  if (!allowedAuthModes.has(options.authMode)) {
    throw new Error(`Unsupported --auth-mode value: ${options.authMode}`);
  }

  return options;
}

function resolveBrowserAuthStrategy(options) {
  const refreshReady = Boolean(
    options.firebaseApiKey && options.staffEmail && options.staffUid && options.staffRefreshToken
  );
  const passwordReady = Boolean(options.staffEmail && options.staffPassword);

  if (options.authMode === "refresh-token") {
    return refreshReady
      ? { mode: "refresh-token", passwordFallbackReady: passwordReady }
      : { mode: "unavailable", reason: "refresh-token bootstrap needs api key + email + uid + refresh token." };
  }

  if (options.authMode === "password-ui") {
    return passwordReady
      ? { mode: "password-ui", passwordFallbackReady: true }
      : { mode: "unavailable", reason: "password-ui auth needs staff email + password." };
  }

  if (refreshReady) {
    return { mode: "refresh-token", passwordFallbackReady: passwordReady };
  }
  if (passwordReady) {
    return { mode: "password-ui", passwordFallbackReady: true };
  }
  return {
    mode: "unavailable",
    reason: "Need refresh-token credentials (email + uid + refreshToken) or an explicit staff password fallback.",
  };
}

async function installRefreshTokenSignInRoute(page, { apiKey, email, uid, idToken, refreshToken }) {
  const expectedEmail = clean(email).toLowerCase();
  const expectedApiKey = clean(apiKey);
  const responseBody = JSON.stringify(buildPasswordSignInResponse({ email, uid, idToken, refreshToken }));
  let handled = false;

  const handler = async (route, request) => {
    const url = request.url();
    if (!url.includes("accounts:signInWithPassword") || !url.includes(`key=${expectedApiKey}`)) {
      await route.continue();
      return;
    }

    let payload = {};
    try {
      payload = JSON.parse(request.postData() || "{}");
    } catch {
      payload = {};
    }

    const requestEmail = clean(payload?.email).toLowerCase();
    if (expectedEmail && requestEmail && requestEmail !== expectedEmail) {
      await route.continue();
      return;
    }

    handled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responseBody,
    });
  };

  await page.route("**/accounts:signInWithPassword?key=*", handler);
  return {
    wasHandled: () => handled,
    remove: async () => {
      await page.unroute("**/accounts:signInWithPassword?key=*", handler);
    },
  };
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

async function signInWithEmail(page, email, password, { allowPlaceholderPassword = false } = {}) {
  const effectivePassword =
    clean(password) || (allowPlaceholderPassword ? "refresh-token-bootstrap" : "");
  if (!clean(email) || !effectivePassword) {
    throw new Error("Missing authenticated staff credentials for sign-in.");
  }

  const signedOutCard = page.locator(".signed-out-card");
  await signedOutCard.waitFor({ timeout: 30000 });

  const emailInput = signedOutCard.locator("input[type='email']").first();
  const passwordInput = signedOutCard.locator("input[type='password']").first();
  const submitPrimary = signedOutCard.locator("button.primary").first();
  const submitFallback = signedOutCard.getByRole("button", { name: /^Sign in$/i }).first();
  const submit = (await submitPrimary.count()) > 0 ? submitPrimary : submitFallback;

  await emailInput.fill(email);
  await passwordInput.fill(effectivePassword);
  await submit.click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  const nowSignedOut = await waitForAuthReady(page);
  if (!nowSignedOut) return;

  const signedOutError = signedOutCard.locator(".signed-out-status").first();
  if ((await signedOutError.count()) > 0) {
    const message = clean(await signedOutError.textContent()) || "sign in failed";
    throw new Error(`Sign in blocked: ${message}`);
  }

  throw new Error("Sign in did not transition to authenticated shell.");
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function takeScreenshot(page, outputDir, filename) {
  await ensureDir(outputDir);
  const screenshotPath = resolve(outputDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function takeViewportScreenshot(page, outputDir, filename) {
  await ensureDir(outputDir);
  const screenshotPath = resolve(outputDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function waitForText(page, pattern, timeout = 20000) {
  await page.getByText(pattern).first().waitFor({ timeout });
}

async function waitForCondition(readValue, isReady, timeout = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await readValue();
    if (isReady(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  const lastValue = await readValue();
  throw new Error(`Timed out waiting for expected value. Last observed value: ${JSON.stringify(lastValue)}`);
}

async function waitForCheckboxState(locator, expected, timeout = 15000) {
  await waitForCondition(async () => await locator.isChecked(), (value) => value === expected, timeout);
}

async function waitForTextValue(locator, expected, timeout = 15000) {
  await waitForCondition(async () => await locator.inputValue(), (value) => value === expected, timeout);
}

async function waitForBodyTextMatch(page, patterns, timeout = 20000) {
  return await waitForCondition(
    async () => clean(await page.locator("body").textContent()),
    (value) => patterns.some((pattern) => pattern.test(value)),
    timeout
  );
}

async function navigate(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function authenticate(page, options, summary) {
  await navigate(page, options.baseUrl);
  const isSignedOut = await waitForAuthReady(page);
  if (!isSignedOut) {
    summary.auth.resolvedBrowserAuthMode = "existing-session";
    return;
  }

  const strategy = resolveBrowserAuthStrategy(options);
  if (strategy.mode === "unavailable") {
    throw new Error(strategy.reason);
  }

  if (strategy.mode === "refresh-token") {
    try {
      const env = {
        ...process.env,
        ...(options.credentialsPath ? { PORTAL_AGENT_STAFF_CREDENTIALS: options.credentialsPath } : {}),
        ...(options.credentialsJson ? { PORTAL_AGENT_STAFF_CREDENTIALS_JSON: options.credentialsJson } : {}),
        ...(options.staffEmail ? { PORTAL_STAFF_EMAIL: options.staffEmail } : {}),
        ...(options.staffPassword ? { PORTAL_STAFF_PASSWORD: options.staffPassword } : {}),
        ...(options.staffRefreshToken ? { PORTAL_STAFF_REFRESH_TOKEN: options.staffRefreshToken } : {}),
        ...(options.firebaseApiKey
          ? { PORTAL_FIREBASE_API_KEY: options.firebaseApiKey, FIREBASE_WEB_API_KEY: options.firebaseApiKey }
          : {}),
      };
      const minted = await mintStaffIdTokenFromPortalEnv({
        env,
        defaultCredentialsPath: DEFAULT_CREDENTIALS_PATH,
      });
      if (!minted.ok || !minted.token) {
        throw new Error(`Could not mint Firebase ID token: ${minted.reason}`);
      }
      const route = await installRefreshTokenSignInRoute(page, {
        apiKey: options.firebaseApiKey,
        email: options.staffEmail,
        uid: options.staffUid,
        idToken: minted.token,
        refreshToken: minted.refreshToken || options.staffRefreshToken,
      });
      try {
        await signInWithEmail(page, options.staffEmail, options.staffPassword, {
          allowPlaceholderPassword: true,
        });
        if (!route.wasHandled()) {
          throw new Error("Refresh-token bootstrap route was not exercised during sign-in.");
        }
      } finally {
        await route.remove();
      }
      summary.auth.resolvedBrowserAuthMode = "refresh-token";
      summary.auth.tokenSource = minted.source;
      return;
    } catch (error) {
      if (!strategy.passwordFallbackReady) {
        throw error;
      }
      summary.warnings.push(
        `Refresh-token browser bootstrap failed; falling back to password UI auth. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  await signInWithEmail(page, options.staffEmail, options.staffPassword);
  summary.auth.resolvedBrowserAuthMode = "password-ui";
}

async function setCheckbox(page, locator, nextChecked) {
  await locator.setChecked(nextChecked, { force: true });
  await waitForCheckboxState(locator, nextChecked);
}

async function runStaffPolicyCheck(page, options, summary) {
  await navigate(page, `${options.baseUrl}/staff/cockpit/platform`);
  await waitForText(page, /Reservation notification policy/i, 30000);

  const noteField = page.getByLabel(/^Operator note$/i).first();
  const saveButton = page.getByRole("button", { name: /^Save notification policy$/i }).first();

  await noteField.waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const originalNote = await noteField.inputValue();
  const marker = `[live-check ${new Date().toISOString()}]`;
  const nextNote = originalNote ? `${originalNote.trim()} ${marker}` : marker;
  let persistedScreenshot = "";
  let restoredScreenshot = "";
  let restored = false;
  let persisted = false;

  const restoreOriginal = async () => {
    await navigate(page, `${options.baseUrl}/staff/cockpit/platform`);
    await waitForText(page, /Reservation notification policy/i, 30000);
    await noteField.waitFor({ timeout: 20000 });
    await noteField.fill(originalNote);
    await saveButton.click({ timeout: 10000 });
    const restoreStatus = await waitForBodyTextMatch(
      page,
      [/Reservation notification policy updated\./i, /Notification policy update failed:[^\n]*/i],
      20000
    );
    const restoreErrorMatch = restoreStatus.match(/Notification policy update failed:[^\n]*/i);
    if (restoreErrorMatch) {
      throw new Error(restoreErrorMatch[0]);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForText(page, /Reservation notification policy/i, 30000);
    await noteField.waitFor({ timeout: 20000 });
    await waitForTextValue(noteField, originalNote, 20000);
    restoredScreenshot = await takeScreenshot(page, options.outputDir, "staff-reservation-policy-restored.png");
    restored = true;
  };

  try {
    await noteField.fill(nextNote);
    await saveButton.click({ timeout: 10000 });
    const saveStatus = await waitForBodyTextMatch(
      page,
      [/Reservation notification policy updated\./i, /Notification policy update failed:[^\n]*/i],
      20000
    );
    const saveErrorMatch = saveStatus.match(/Notification policy update failed:[^\n]*/i);
    if (saveErrorMatch) {
      throw new Error(saveErrorMatch[0]);
    }
    persisted = true;

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForText(page, /Reservation notification policy/i, 30000);
    await noteField.waitFor({ timeout: 20000 });
    await waitForTextValue(noteField, nextNote, 20000);

    persistedScreenshot = await takeScreenshot(page, options.outputDir, "staff-reservation-policy-persisted.png");
    await restoreOriginal();
  } finally {
    if (persisted && !restored) {
      try {
        await restoreOriginal();
      } catch (error) {
        summary.warnings.push(
          `Best-effort staff policy restore failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  summary.staffPolicy = {
    originalNote,
    persistedNote: nextNote,
    restoredNote: originalNote,
    persistedScreenshot,
    restoredScreenshot,
  };
}

async function runProfileNotificationCheck(page, options, summary) {
  await navigate(page, `${options.baseUrl}/profile`);
  await waitForText(page, /Reservations & pickup/i, 30000);
  await page.waitForTimeout(1500);

  const reservationsToggle = page.getByLabel(/^Reservation and pickup updates$/i).first();
  const readyToggle = page.getByLabel(/^Ready for pickup$/i).first();
  const reminderToggle = page.getByLabel(/^Pickup reminders$/i).first();
  const saveButton = page.getByRole("button", { name: /^Save notifications$/i }).first();

  await reservationsToggle.waitFor({ timeout: 20000 });

  const originalStates = {
    notifyReservations: await reservationsToggle.isChecked(),
    reservationPickupReady: await readyToggle.isChecked(),
    reservationPickupReminder: await reminderToggle.isChecked(),
  };

  const changedStates = {
    notifyReservations: !originalStates.notifyReservations,
    reservationPickupReady: !originalStates.reservationPickupReady,
    reservationPickupReminder: !originalStates.reservationPickupReminder,
  };

  let persistedStates = null;
  let restoredStates = null;
  let persistedScreenshot = "";
  let restoredScreenshot = "";
  let persisted = false;
  let restored = false;

  const restoreOriginal = async () => {
    await navigate(page, `${options.baseUrl}/profile`);
    await waitForText(page, /Reservations & pickup/i, 30000);
    await reservationsToggle.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await setCheckbox(page, reservationsToggle, originalStates.notifyReservations);
    await setCheckbox(page, readyToggle, originalStates.reservationPickupReady);
    await setCheckbox(page, reminderToggle, originalStates.reservationPickupReminder);
    await saveButton.click({ timeout: 10000 });
    const restoreStatus = await waitForBodyTextMatch(
      page,
      [/Notification settings saved\./i, /Failed to save notifications\./i],
      20000
    );
    const restoreErrorMatch = restoreStatus.match(/Failed to save notifications\./i);
    if (restoreErrorMatch) {
      throw new Error(restoreErrorMatch[0]);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForText(page, /Reservations & pickup/i, 30000);
    await reservationsToggle.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    restoredStates = {
      notifyReservations: await reservationsToggle.isChecked(),
      reservationPickupReady: await readyToggle.isChecked(),
      reservationPickupReminder: await reminderToggle.isChecked(),
    };
    if (
      restoredStates.notifyReservations !== originalStates.notifyReservations ||
      restoredStates.reservationPickupReady !== originalStates.reservationPickupReady ||
      restoredStates.reservationPickupReminder !== originalStates.reservationPickupReminder
    ) {
      throw new Error(
        `Profile notification restore mismatch. Expected ${JSON.stringify(originalStates)} but found ${JSON.stringify(
          restoredStates
        )}.`
      );
    }
    restoredScreenshot = await takeScreenshot(page, options.outputDir, "profile-reservation-notifications-restored.png");
    restored = true;
  };

  try {
    await setCheckbox(page, reservationsToggle, changedStates.notifyReservations);
    await setCheckbox(page, readyToggle, changedStates.reservationPickupReady);
    await setCheckbox(page, reminderToggle, changedStates.reservationPickupReminder);

    await saveButton.click({ timeout: 10000 });
    const saveStatus = await waitForBodyTextMatch(
      page,
      [/Notification settings saved\./i, /Failed to save notifications\./i],
      20000
    );
    const saveErrorMatch = saveStatus.match(/Failed to save notifications\./i);
    if (saveErrorMatch) {
      throw new Error(saveErrorMatch[0]);
    }
    persisted = true;

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForText(page, /Reservations & pickup/i, 30000);
    await reservationsToggle.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);

    persistedStates = {
      notifyReservations: await reservationsToggle.isChecked(),
      reservationPickupReady: await readyToggle.isChecked(),
      reservationPickupReminder: await reminderToggle.isChecked(),
    };

    if (
      persistedStates.notifyReservations !== changedStates.notifyReservations ||
      persistedStates.reservationPickupReady !== changedStates.reservationPickupReady ||
      persistedStates.reservationPickupReminder !== changedStates.reservationPickupReminder
    ) {
      throw new Error(
        `Profile notification readback mismatch. Expected ${JSON.stringify(changedStates)} but found ${JSON.stringify(
          persistedStates
        )}.`
      );
    }

    persistedScreenshot = await takeScreenshot(
      page,
      options.outputDir,
      "profile-reservation-notifications-persisted.png"
    );
    await restoreOriginal();
  } finally {
    if (persisted && !restored) {
      try {
        await restoreOriginal();
      } catch (error) {
        summary.warnings.push(
          `Best-effort profile notification restore failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  summary.profileNotifications = {
    originalStates,
    changedStates,
    persistedStates,
    restoredStates,
    persistedScreenshot,
    restoredScreenshot,
  };
}

async function captureLiveFeatureScreenshots(page, options, summary) {
  const profileNavButton = page.getByRole("button", { name: /^Open profile$/i }).first();
  if ((await profileNavButton.count()) > 0) {
    await profileNavButton.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
  } else {
    await navigate(page, `${options.baseUrl}/profile`);
  }
  await waitForText(page, /Reservations & pickup/i, 30000);
  const profileScreenshot = await takeScreenshot(
    page,
    options.outputDir,
    "profile-reservation-notifications-live.png"
  );

  await navigate(page, `${options.baseUrl}/staff/cockpit/platform`);
  const staffHeader = page.getByText(/Reservation notification policy/i).first();
  await staffHeader.waitFor({ timeout: 30000 });
  await staffHeader.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const staffScreenshot = await takeViewportScreenshot(
    page,
    options.outputDir,
    "staff-reservation-policy-live.png"
  );

  summary.liveScreenshots = {
    profileScreenshot,
    staffScreenshot,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const credentials = resolvePortalAgentStaffCredentials({
    credentialsJson: options.credentialsJson,
    credentialsPath: options.credentialsPath,
    defaultCredentialsPath: DEFAULT_CREDENTIALS_PATH,
  });

  options.staffEmail = options.staffEmail || clean(credentials?.email);
  options.staffPassword = options.staffPassword || clean(credentials?.password);
  options.staffUid = options.staffUid || clean(credentials?.uid);
  options.staffRefreshToken =
    options.staffRefreshToken || clean(credentials?.refreshToken || credentials?.tokens?.refresh_token);

  const summary = {
    status: "running",
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    reportPath: options.reportPath,
    startedAtIso: new Date().toISOString(),
    auth: {
      staffEmail: options.staffEmail,
      staffUid: options.staffUid,
      authMode: options.authMode,
      resolvedBrowserAuthMode: "",
      tokenSource: "",
    },
    warnings: [],
    consoleMessages: [],
    pageErrors: [],
    staffPolicy: null,
    profileNotifications: null,
  };

  await ensureDir(options.outputDir);

  const browser = await chromium.launch({ headless: options.headless });
  let context = null;
  let page = null;

  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      userAgent: "MonsoonFirePortalReservationPolicyCheck/1.0",
    });
    page = await context.newPage();

    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warning") {
        summary.consoleMessages.push({ type, text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      summary.pageErrors.push(clean(error?.message || error));
    });

    await authenticate(page, options, summary);
    if (options.screenshotsOnly) {
      await captureLiveFeatureScreenshots(page, options, summary);
      summary.status = "passed";
      summary.completedAtIso = new Date().toISOString();
      await context.close();
      context = null;
      page = null;
    } else {
    await runStaffPolicyCheck(page, options, summary);
    await runProfileNotificationCheck(page, options, summary);

    summary.status = "passed";
    summary.completedAtIso = new Date().toISOString();

    await context.close();
    context = null;
    page = null;
    }
  } catch (error) {
    summary.status = "failed";
    summary.completedAtIso = new Date().toISOString();
    summary.error = error instanceof Error ? error.message : String(error);
    if (page) {
      summary.failureScreenshot = await takeScreenshot(page, options.outputDir, "failure-state.png").catch(() => "");
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    await browser.close();
  }

  await ensureDir(dirname(options.reportPath));
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
    if (summary.staffPolicy?.persistedScreenshot) {
      process.stdout.write(`staff screenshot: ${summary.staffPolicy.persistedScreenshot}\n`);
    }
    if (summary.profileNotifications?.persistedScreenshot) {
      process.stdout.write(`profile screenshot: ${summary.profileNotifications.persistedScreenshot}\n`);
    }
    if (summary.error) {
      process.stdout.write(`error: ${summary.error}\n`);
    }
  }

  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal reservation policy live check failed: ${message}`);
  process.exit(1);
});
