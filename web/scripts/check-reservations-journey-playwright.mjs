#!/usr/bin/env node

import path from "node:path";
import { promises as fs } from "node:fs";

const PORTAL_URL = process.env.PORTAL_URL || "http://localhost:5173";
const CLIENT_EMAIL = process.env.PORTAL_CLIENT_EMAIL || process.env.PORTAL_STAFF_EMAIL || "studio-client@monsoonfire.local";
const CLIENT_PASSWORD = process.env.PORTAL_CLIENT_PASSWORD || process.env.PORTAL_STAFF_PASSWORD || "";
const SCREENSHOT_PATH =
  process.env.PORTAL_RESERVATIONS_SCREENSHOT_PATH ||
  path.join("tmp", "reservations-journey-validation.png");

if (!CLIENT_PASSWORD) {
  console.error("Set PORTAL_CLIENT_PASSWORD (or PORTAL_STAFF_PASSWORD) first for reservations journey checks.");
  process.exit(2);
}

async function getPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("playwright is not installed for this script.");
    console.error("Install one of:");
    console.error("  cd web && npm install -D playwright");
    console.error("  npx playwright install");
    throw error;
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

    await page.locator(".signed-out-card").getByRole("textbox", { name: /^Email$/i }).fill(CLIENT_EMAIL);
    await page.locator(".signed-out-card").getByRole("textbox", { name: /^Password$/i }).fill(CLIENT_PASSWORD);
    await page.locator(".signed-out-card").getByRole("button", { name: /^Sign in$/i }).last().click();

    await page.getByRole("button", { name: /^Check in work$/i }).click({ timeout: 30000 });
    await page.getByRole("heading", { name: /^Ware Check-in$/i }).waitFor({ timeout: 30000 });

    const pickupToggle = page
      .locator("label.addon-toggle", {
        hasText: /Pickup run: we collect your drop-off for firing/i,
      })
      .locator("input[type='checkbox']")
      .first();
    await pickupToggle.check({ force: true });

    await page.getByText(/^Delivery address$/i).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Submit check-in/i }).click();
    await page
      .getByText(/Add the delivery address so we can schedule pickup\/return\./i)
      .waitFor({ timeout: 15000 });

    await fs.mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    console.log("PASS: reservations journey guardrails validated (pickup requires delivery address).");
    console.log(`Screenshot: ${SCREENSHOT_PATH}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || error}`);
  process.exit(1);
});
