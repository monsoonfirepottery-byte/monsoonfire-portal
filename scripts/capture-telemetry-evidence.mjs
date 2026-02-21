#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5173";
const functionsBaseUrl =
  process.env.FUNCTIONS_BASE_URL ||
  "http://127.0.0.1:5001/monsoonfire-portal/us-central1";
const outDir = process.env.TELEMETRY_OUT_DIR
  ? resolve(process.env.TELEMETRY_OUT_DIR)
  : resolve("artifacts", "telemetry", "after-seed");
const seedUserEmail = process.env.SEED_USER_EMAIL || "seed.client@monsoonfire.local";
const seedUserPassword = process.env.SEED_USER_PASSWORD || "SeedPass!123";
const seededThreadId = process.env.SEED_THREAD_ID || "seed-thread-client-staff";

async function sleep(ms) {
  return await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function collectPanel(page) {
  const rows = await page.$$eval(".telemetry-row", (els) =>
    els.map((el) => {
      const label = el.querySelector("span")?.textContent?.trim() || "";
      const value = el.querySelector("strong")?.textContent?.trim() || "";
      return { label, value };
    })
  );
  const map = {};
  for (const row of rows) {
    map[row.label] = row.value;
  }
  return map;
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(outDir, name), fullPage: true });
}

async function openTelemetryPanel(page) {
  const toggle = page.locator(".telemetry-toggle").first();
  await toggle.waitFor({ timeout: 20000 });
  const panelBody = page.locator(".telemetry-body");
  if (await panelBody.isVisible().catch(() => false)) return;
  await toggle.click();
  if (await panelBody.isVisible().catch(() => false)) return;
  await toggle.click();
  await panelBody.waitFor({ timeout: 5000 });
}

async function ensureSignedIn(page, results) {
  const signedOutCard = page.locator(".signed-out-card").first();
  if (!await signedOutCard.isVisible().catch(() => false)) {
    return true;
  }

  const emailInput = page.locator(".signed-out-email input[type='email']").first();
  const passwordInput = page.locator(".signed-out-email input[type='password']").first();
  const signInButton = page.locator(".signed-out-email button.primary").first();

  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(seedUserEmail);
  }
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(seedUserPassword);
  }
  if (await signInButton.isVisible().catch(() => false)) {
    await signInButton.click();
  }

  const signedIn = await page.waitForFunction(
    () => !document.querySelector(".signed-out-card"),
    { timeout: 30000 }
  ).then(() => true).catch(() => false);
  if (signedIn) return true;

  const emulatorSignIn = page.getByRole("button", { name: /Sign in \(emulator\)/i });
  if (await emulatorSignIn.isVisible().catch(() => false)) {
    await emulatorSignIn.click();
    const fallbackSignedIn = await page.waitForFunction(
      () => !document.querySelector(".signed-out-card"),
      { timeout: 30000 }
    ).then(() => true).catch(() => false);
    if (fallbackSignedIn) {
      results.notes.push("Used anonymous emulator sign-in fallback because seeded email sign-in did not complete in time.");
      return true;
    }
  }

  results.notes.push("Unable to complete sign-in for telemetry capture.");
  return false;
}

async function navTo(page, label) {
  if (label === "Messages") {
    await page.locator("button[title='Messages']").first().click({ timeout: 30000 });
    await sleep(1200);
    return;
  }

  if (label === "Staff") {
    await page.locator("button[title='Staff']").first().click({ timeout: 30000 });
    await sleep(1200);
    return;
  }

  if (label === "My Pieces") {
    await page.evaluate(() => {
      const section = document.querySelector("button.nav-section-title[title='Studio & Resources']");
      if (section && section.getAttribute("aria-expanded") !== "true") {
        section.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      const target = document.querySelector("button.nav-subitem[title='My Pieces']");
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(1200);
    return;
  }

  if (label === "Glaze Board") {
    await page.evaluate(() => {
      const section = document.querySelector("button.nav-section-title[title='Studio & Resources']");
      if (section && section.getAttribute("aria-expanded") !== "true") {
        section.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      const target = document.querySelector("button.nav-subitem[title='Glaze Board']");
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(1200);
    return;
  }

  const byTitle = page.getByTitle(label).first();
  if (await byTitle.isVisible().catch(() => false)) {
    await byTitle.click({ timeout: 30000 });
    await sleep(1200);
    return;
  }

  const byRole = page.getByRole("button", { name: new RegExp(label, "i") }).first();
  await byRole.click({ timeout: 30000 });
  await sleep(1200);
}

async function grantStaffRoleForCurrentSession(page, results) {
  const claimResult = await page.evaluate(async ({ endpoint }) => {
    const runtimeWindow = window;
    const getToken =
      runtimeWindow.__mfGetIdToken ||
      runtimeWindow.mfDebug?.getIdToken ||
      null;

    if (!getToken) {
      return { ok: false, reason: "missing_token_helper" };
    }

    const token = await getToken();
    if (!token || typeof token !== "string") {
      return { ok: false, reason: "token_unavailable" };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        reason: "http_error",
        status: response.status,
        payload,
      };
    }

    try {
      await getToken();
    } catch {
      // non-fatal
    }

    return {
      ok: true,
      payload,
    };
  }, { endpoint: `${functionsBaseUrl.replace(/\/+$/, "")}/emulatorGrantStaffRole` });

  if (!claimResult.ok) {
    results.notes.push(`Failed to grant staff role for telemetry session: ${JSON.stringify(claimResult)}`);
    return false;
  }

  await sleep(1000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1200);
  return true;
}

async function attemptEnableStaffView(page, results) {
  const staffButton = page.getByRole("button", { name: /Staff/i }).first();
  if (await staffButton.isVisible().catch(() => false)) return true;

  const granted = await grantStaffRoleForCurrentSession(page, results);
  if (!granted) return false;

  return await staffButton.isVisible().catch(() => false);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1510, height: 960 } });

  const results = {
    baseUrl,
    functionsBaseUrl,
    seededLogin: seedUserEmail,
    capturedAt: new Date().toISOString(),
    samples: [],
    notes: [],
  };

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 45000 });
    await screenshot(page, "00-landing.png");

    const signedIn = await ensureSignedIn(page, results);
    if (!signedIn) {
      await writeFile(resolve(outDir, "telemetry-results.json"), JSON.stringify(results, null, 2));
      throw new Error("Unable to establish a signed-in session.");
    }

    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
    await sleep(1200);

    await openTelemetryPanel(page);

    // A) Startup (10s idle)
    await sleep(10000);
    const startup = await collectPanel(page);
    results.samples.push({ step: "A_startup_10s_idle", telemetry: startup, screenshot: "01-startup.png" });
    await screenshot(page, "01-startup.png");

    // B) Messages view before opening a thread
    await navTo(page, "Messages");
    const messagesBefore = await collectPanel(page);
    results.samples.push({ step: "B_messages_view_open", telemetry: messagesBefore, screenshot: "02-messages-view.png" });
    await screenshot(page, "02-messages-view.png");

    // C) Open seeded thread and verify default cap
    await page.getByTestId("messages-thread-list").waitFor({ timeout: 30000 });
    const seededThreadButton = page.getByTestId(`thread-item-${seededThreadId}`).first();
    if (await seededThreadButton.isVisible().catch(() => false)) {
      await seededThreadButton.click();
    } else {
      const firstThreadButton = page.locator("[data-testid^='thread-item-']").first();
      if (!await firstThreadButton.isVisible().catch(() => false)) {
        throw new Error("No direct message thread row is available to open.");
      }
      await firstThreadButton.click();
      results.notes.push(`Seeded thread '${seededThreadId}' not found in thread list; used first available thread.`);
    }
    await page.getByTestId("messages-message-list").waitFor({ timeout: 30000 });
    const initialMessageCount = await page.locator("[data-testid='messages-message-list'] .bubble").count();
    if (initialMessageCount < 50) {
      throw new Error(`Expected at least 50 messages in seeded thread; found ${initialMessageCount}.`);
    }
    await sleep(500);
    const threadOpened = await collectPanel(page);
    results.samples.push({
      step: "C_thread_open_initial",
      telemetry: { ...threadOpened, "Message bubbles": String(initialMessageCount) },
      screenshot: "03-thread-open.png",
    });
    await screenshot(page, "03-thread-open.png");

    // D) Load older messages (required when seeded thread has >120 messages)
    const olderButton = page.getByTestId("messages-load-older");
    await olderButton.waitFor({ state: "visible", timeout: 30000 });
    await olderButton.click();
    await page.waitForFunction(
      () => {
        const list = document.querySelector("[data-testid='messages-message-list']");
        if (!list) return false;
        return list.querySelectorAll(".bubble").length >= 100;
      },
      undefined,
      { timeout: 30000 }
    );
    const afterLoadOlderCount = await page.locator("[data-testid='messages-message-list'] .bubble").count();
    if (afterLoadOlderCount <= initialMessageCount) {
      throw new Error(
        `Expected Load older to increase message count (before ${initialMessageCount}, after ${afterLoadOlderCount}).`
      );
    }
    await sleep(500);
    const olderOnce = await collectPanel(page);
    results.samples.push({
      step: "D_load_older_once",
      telemetry: { ...olderOnce, "Message bubbles": String(afterLoadOlderCount) },
      screenshot: "04-load-older-1.png",
    });
    await screenshot(page, "04-load-older-1.png");

    // E) My Pieces initial
    await navTo(page, "My Pieces");
    const myPieces = await collectPanel(page);
    results.samples.push({ step: "E_my_pieces_initial", telemetry: myPieces, screenshot: "06-my-pieces.png" });
    await screenshot(page, "06-my-pieces.png");

    // F) Load more batches/pieces where available
    const moreBatches = page.getByRole("button", { name: /Load more check-ins/i });
    if (await moreBatches.isVisible().catch(() => false)) {
      await moreBatches.click();
      await sleep(900);
    }
    const morePieces = page.getByRole("button", { name: /Load more pieces/i });
    if (await morePieces.isVisible().catch(() => false)) {
      await morePieces.click();
      await sleep(900);
    }
    const myPiecesMore = await collectPanel(page);
    results.samples.push({ step: "F_my_pieces_load_more", telemetry: myPiecesMore, screenshot: "07-my-pieces-load-more.png" });
    await screenshot(page, "07-my-pieces-load-more.png");

    // G) Glaze board idle 10s
    await navTo(page, "Glaze Board");
    await sleep(10000);
    const glazeBoard = await collectPanel(page);
    results.samples.push({ step: "G_glaze_board_idle_10s", telemetry: glazeBoard, screenshot: "08-glaze-board.png" });
    await screenshot(page, "08-glaze-board.png");

    // H) Staff view before module load
    const staffReady = await attemptEnableStaffView(page, results);
    const staffButton = page.getByRole("button", { name: /Staff/i }).first();
    if (staffReady && await staffButton.isVisible().catch(() => false)) {
      await staffButton.click();
      await sleep(1200);
      const staffBefore = await collectPanel(page);
      results.samples.push({ step: "H_staff_before_load", telemetry: staffBefore, screenshot: "09-staff-before-load.png" });
      await screenshot(page, "09-staff-before-load.png");

      // I) Load current module
      const loadModuleButton = page.getByRole("button", { name: /Load current module/i });
      if (await loadModuleButton.isVisible().catch(() => false)) {
        await loadModuleButton.click();
        await sleep(1800);
      } else {
        results.notes.push("Load current module button not visible in this session.");
      }
      const staffAfter = await collectPanel(page);
      results.samples.push({ step: "I_staff_after_load", telemetry: staffAfter, screenshot: "10-staff-after-load.png" });
      await screenshot(page, "10-staff-after-load.png");
    } else {
      results.notes.push("Staff button not visible for current signed-in role.");
    }

    await writeFile(resolve(outDir, "telemetry-results.json"), JSON.stringify(results, null, 2));

    const mdLines = [
      "# Telemetry evidence",
      `- Base URL: ${baseUrl}`,
      `- Functions URL: ${functionsBaseUrl}`,
      `- Seeded login: ${seedUserEmail}`,
      `- Captured at: ${results.capturedAt}`,
      "",
      "## Samples",
    ];

    for (const sample of results.samples) {
      mdLines.push(`- ${sample.step}:`);
      for (const [key, value] of Object.entries(sample.telemetry)) {
        mdLines.push(`  - ${key}: ${value}`);
      }
      mdLines.push(`  - Screenshot: ${sample.screenshot}`);
    }

    if (results.notes.length) {
      mdLines.push("", "## Notes");
      for (const note of results.notes) {
        mdLines.push(`- ${note}`);
      }
    }

    await writeFile(resolve(outDir, "telemetry-results.md"), mdLines.join("\n"));
    console.log(`Saved evidence to ${outDir}`);
  } finally {
    await browser.close();
  }
}

await main();
