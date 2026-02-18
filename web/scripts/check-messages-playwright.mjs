#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const PORTAL_URL = process.env.PORTAL_URL || "http://localhost:5173";
const STAFF_EMAIL = process.env.PORTAL_STAFF_EMAIL || "studio-brain-staff@monsoonfire.local";
const STAFF_PASSWORD = process.env.PORTAL_STAFF_PASSWORD || "";
const SCREENSHOT_PATH = process.env.PORTAL_SCREENSHOT_PATH || path.join("tmp", "messages-no-ccbcc.png");

if (!STAFF_PASSWORD) {
  console.error("Set PORTAL_STAFF_PASSWORD first for staff login checks.");
  process.exit(1);
}

async function getPlaywright() {
  try {
    const module = await import("playwright");
    return module;
  } catch (error) {
    console.error("playwright is not installed for this script.");
    console.error("Install one of:");
    console.error("  cd web && npm install -D playwright");
    console.error("  npx playwright install");
    console.error("Then rerun this script.");
    throw error;
  }
}

async function verifyNoLegacyRecipientFields(page) {
  const newThread = page.locator(".new-thread");
  await newThread.waitFor({ state: "visible", timeout: 20000 });

  const ccLabelCount = await newThread.locator("label", { hasText: /^\s*Cc\s*$/i }).count();
  const bccLabelCount = await newThread.locator("label", { hasText: /^\s*Bcc\s*$/i }).count();

  if (ccLabelCount > 0 || bccLabelCount > 0) {
    throw new Error(
      `Found legacy recipient labels in compose form: CC=${ccLabelCount}, BCC=${bccLabelCount}`
    );
  }

  const selectLabelCount = await newThread.locator("select[multiple]").count();
  if (selectLabelCount > 0) {
    throw new Error("Found an unexpected multiselect field in the compose form.");
  }
}

async function main() {
  const playwright = await getPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
    });
    const page = await context.newPage();

    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.locator(".signed-out-card").getByRole("textbox", { name: /^Email$/i }).fill(STAFF_EMAIL);
  await page.locator(".signed-out-card").getByRole("textbox", { name: /^Password$/i }).fill(STAFF_PASSWORD);
  await page.locator(".signed-out-card").getByRole("button", { name: /^Sign in$/i }).last().click();

    await page.getByRole("button", { name: "Messages" }).click({ timeout: 30000 });
    await page.getByRole("button", { name: "Start new message" }).click({ timeout: 15000 });

    await verifyNoLegacyRecipientFields(page);

    const screenshotDir = path.dirname(SCREENSHOT_PATH);
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    console.log("PASS: no legacy CC/BCC fields rendered in new message form.");
    console.log(`Screenshot: ${SCREENSHOT_PATH}`);

    await context.close();
    return;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || error}`);
  process.exit(1);
});
