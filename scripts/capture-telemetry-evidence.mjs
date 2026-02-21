#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5173";
const outDir = resolve("artifacts", "telemetry");

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
  const toggle = page.getByRole("button", { name: /Firestore telemetry/i });
  await toggle.waitFor({ timeout: 20000 });
  const panelBody = page.locator(".telemetry-body");
  if (await panelBody.isVisible().catch(() => false)) return;
  await toggle.click();
  if (await panelBody.isVisible().catch(() => false)) return;
  await toggle.click();
  await panelBody.waitFor({ timeout: 5000 });
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

async function attemptEnableStaffView(page, results) {
  const staffButton = page.getByRole("button", { name: /Staff/i }).first();
  if (await staffButton.isVisible().catch(() => false)) return true;

  const idToken = await page.evaluate(async () => {
    const runtimeWindow = window;
    if (!runtimeWindow.mfDebug || typeof runtimeWindow.mfDebug.getIdToken !== "function") {
      return "";
    }
    return await runtimeWindow.mfDebug.getIdToken();
  });

  if (!idToken) {
    results.notes.push("Staff button unavailable and mfDebug token helper not found.");
    return false;
  }

  const claimResult = await page.evaluate(async ({ token }) => {
    const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: token,
        customAttributes: JSON.stringify({ staff: true, roles: ["staff"] }),
        returnSecureToken: true,
      }),
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, payload };
  }, { token: idToken });

  if (!claimResult.ok) {
    results.notes.push(`Failed to set staff claim in Auth emulator: ${JSON.stringify(claimResult.payload)}`);
    return false;
  }

  const signOut = page.getByRole("button", { name: /Sign out/i }).first();
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await sleep(1200);
  }
  const emulatorSignIn = page.getByRole("button", { name: /Sign in \\(emulator\\)/i });
  if (await emulatorSignIn.isVisible().catch(() => false)) {
    await emulatorSignIn.click();
    await sleep(1800);
  }

  return await staffButton.isVisible().catch(() => false);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1510, height: 960 } });

  const results = {
    baseUrl,
    capturedAt: new Date().toISOString(),
    samples: [],
    notes: [],
  };

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 45000 });
    await screenshot(page, "00-landing.png");

    const emulatorSignIn = page.getByRole("button", { name: /Sign in \(emulator\)/i });
    if (await emulatorSignIn.isVisible()) {
      await emulatorSignIn.click();
    } else {
      results.notes.push("Emulator sign-in button was not visible; attempted to continue with existing session.");
    }

    await page.locator("main").waitFor({ timeout: 30000 });
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

    // C) Open a thread (or create one)
    const threadItem = page.locator(".thread-item").first();
    if (await threadItem.isVisible().catch(() => false)) {
      await threadItem.click();
    } else {
      const newThreadButton = page.getByRole("button", { name: /Start new message/i });
      if (await newThreadButton.isVisible().catch(() => false)) {
        await newThreadButton.click();
        const subjectInput = page.locator(".new-thread input[type='text']").first();
        const bodyInput = page.locator(".new-thread textarea").first();
        if (await subjectInput.isVisible().catch(() => false)) {
          await subjectInput.fill("Telemetry test thread");
        }
        if (await bodyInput.isVisible().catch(() => false)) {
          await bodyInput.fill("Telemetry probe message");
        }
        const sendNew = page.getByRole("button", { name: /Send new message/i });
        if (await sendNew.isVisible().catch(() => false)) {
          await sendNew.click();
        }
      }
      await sleep(1200);
      if (await threadItem.isVisible().catch(() => false)) {
        await threadItem.click();
      }
    }
    await sleep(1200);
    const threadOpened = await collectPanel(page);
    results.samples.push({ step: "C_thread_open_initial", telemetry: threadOpened, screenshot: "03-thread-open.png" });
    await screenshot(page, "03-thread-open.png");

    // D) Load older messages if available
    const olderButton = page.getByRole("button", { name: /Load older messages/i });
    if (await olderButton.isVisible().catch(() => false)) {
      await olderButton.click();
      await sleep(1000);
      const olderOnce = await collectPanel(page);
      results.samples.push({ step: "D_load_older_once", telemetry: olderOnce, screenshot: "04-load-older-1.png" });
      await screenshot(page, "04-load-older-1.png");

      if (await olderButton.isVisible().catch(() => false)) {
        await olderButton.click();
        await sleep(1000);
        const olderTwice = await collectPanel(page);
        results.samples.push({ step: "D_load_older_twice", telemetry: olderTwice, screenshot: "05-load-older-2.png" });
        await screenshot(page, "05-load-older-2.png");
      }
    } else {
      results.notes.push("Load older messages button not available with current local dataset.");
    }

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
      `# Telemetry evidence`,
      `- Base URL: ${baseUrl}`,
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
