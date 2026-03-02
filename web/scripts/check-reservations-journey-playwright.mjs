#!/usr/bin/env node

import path from "node:path";
import { promises as fs } from "node:fs";

const PORTAL_URL = process.env.PORTAL_URL || "http://localhost:5173";
const CLIENT_EMAIL = process.env.PORTAL_CLIENT_EMAIL || "";
const CLIENT_PASSWORD = process.env.PORTAL_CLIENT_PASSWORD || "";
const STAFF_EMAIL = process.env.PORTAL_STAFF_EMAIL || "";
const STAFF_PASSWORD = process.env.PORTAL_STAFF_PASSWORD || "";
const AGENT_STAFF_CREDENTIALS_PATH = process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "";
const SCREENSHOT_PATH =
  process.env.PORTAL_RESERVATIONS_SCREENSHOT_PATH ||
  path.join("tmp", "reservations-journey-validation.png");
const METRICS_PATH =
  process.env.PORTAL_RESERVATIONS_METRICS_PATH ||
  path.join("tmp", "reservations-journey-metrics.json");
const MAX_CLICKS_TO_GUARDRAIL = Number.parseInt(process.env.PORTAL_RESERVATIONS_MAX_CLICKS || "8", 10);

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

async function resolveClientCredentials() {
  let email = String(CLIENT_EMAIL || "").trim();
  let password = String(CLIENT_PASSWORD || "").trim();
  let source = "env";

  if ((!email || !password) && AGENT_STAFF_CREDENTIALS_PATH) {
    try {
      const raw = await fs.readFile(AGENT_STAFF_CREDENTIALS_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (!email) {
        email = String(parsed?.email ?? parsed?.staffEmail ?? "").trim();
      }
      if (!password) {
        password = String(parsed?.password ?? parsed?.staffPassword ?? "").trim();
      }
      if (email && password) {
        source = `credentials-file:${AGENT_STAFF_CREDENTIALS_PATH}`;
      }
    } catch (error) {
      throw new Error(`Could not read credentials from ${AGENT_STAFF_CREDENTIALS_PATH}: ${error?.message || error}`);
    }
  }

  if (!email && STAFF_EMAIL) {
    email = String(STAFF_EMAIL).trim();
    source = "staff-env";
  }
  if (!password && STAFF_PASSWORD) {
    password = String(STAFF_PASSWORD).trim();
    source = source === "staff-env" ? "staff-env" : "mixed-env";
  }

  if (!password) {
    throw new Error(
      "Set PORTAL_CLIENT_PASSWORD/PORTAL_STAFF_PASSWORD or provide PORTAL_AGENT_STAFF_CREDENTIALS with email+password."
    );
  }
  if (!email) {
    throw new Error(
      "Set PORTAL_CLIENT_EMAIL/PORTAL_STAFF_EMAIL or provide PORTAL_AGENT_STAFF_CREDENTIALS with email+password."
    );
  }

  return { email, password, source };
}

function regexSafe(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openWareCheckin(page, clickTracked) {
  const directCta = page.getByRole("button", { name: /^Check in work$/i }).first();
  if ((await directCta.count()) > 0) {
    await clickTracked(directCta, "Open ware check-in (dashboard CTA)", { timeout: 30000 });
    return;
  }

  const sectionButton = page
    .locator("button.nav-section-title", {
      hasText: new RegExp(`^${regexSafe("Kiln Rentals")}$`, "i"),
    })
    .first();
  if ((await sectionButton.count()) === 0) {
    throw new Error("Ware check-in entry point unavailable (missing dashboard CTA and Kiln Rentals nav section).");
  }

  const expanded = (await sectionButton.getAttribute("aria-expanded")) === "true";
  if (!expanded) {
    await clickTracked(sectionButton, "Open Kiln Rentals nav section", { timeout: 12000 });
    await page.waitForTimeout(250);
  }

  const controlsId = await sectionButton.getAttribute("aria-controls");
  const wareCheckinButton = controlsId
    ? page
        .locator(`#${controlsId}`)
        .locator("button", { hasText: new RegExp(`^${regexSafe("Ware Check-in")}$`, "i") })
        .first()
    : page.getByRole("button", { name: /^Ware Check-in$/i }).first();
  if ((await wareCheckinButton.count()) === 0) {
    throw new Error("Ware Check-in nav button not found under Kiln Rentals.");
  }
  await clickTracked(wareCheckinButton, "Open ware check-in (nav)", { timeout: 12000 });
}

async function main() {
  const playwright = await getPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const credentials = await resolveClientCredentials();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
    });
    const page = await context.newPage();
    const clickTrace = [];
    let clickCount = 0;

    const trackClick = (label) => {
      clickCount += 1;
      clickTrace.push({
        step: clickCount,
        label,
      });
    };

    const clickTracked = async (locator, label, options = {}) => {
      await locator.click(options);
      trackClick(label);
    };

    const checkTracked = async (locator, label, options = {}) => {
      await locator.check(options);
      trackClick(label);
    };

    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.locator(".signed-out-card").getByRole("textbox", { name: /^Email$/i }).fill(credentials.email);
    await page.locator(".signed-out-card").getByRole("textbox", { name: /^Password$/i }).fill(credentials.password);
    await clickTracked(
      page.locator(".signed-out-card").getByRole("button", { name: /^Sign in$/i }).last(),
      "Sign in"
    );
    await page.locator("#portal-sidebar-nav").first().waitFor({ timeout: 30000 });

    await openWareCheckin(page, clickTracked);
    await page.getByRole("heading", { name: /^Ware Check-in$/i }).waitFor({ timeout: 30000 });

    const extrasSummary = page
      .locator("details.checkin-optional-step > summary", { hasText: /Helpful extras/i })
      .first();
    const extrasStep = extrasSummary.locator("xpath=..");
    const extrasOpen = await extrasStep.evaluate((node) => node instanceof HTMLDetailsElement && node.open);
    if (!extrasOpen) {
      await clickTracked(extrasSummary, "Open helpful extras");
      await page.waitForTimeout(250);
    }

    const pickupToggle = page
      .locator("label.addon-toggle", {
        hasText: /Pickup run: we collect your drop-off for firing/i,
      })
      .locator("input[type='checkbox']")
      .first();
    await checkTracked(pickupToggle, "Enable pickup run", { force: true });

    await page.getByText(/^Delivery address$/i).waitFor({ timeout: 15000 });
    const submitButton = page
      .getByRole("button", {
        name: /^(Submit check-in|Send my check-in|Save check-in)$/i,
      })
      .first();
    await clickTracked(submitButton, "Submit check-in");
    await page
      .getByText(/Add the delivery address so we can schedule pickup\/return\./i)
      .waitFor({ timeout: 15000 });

    if (Number.isFinite(MAX_CLICKS_TO_GUARDRAIL) && MAX_CLICKS_TO_GUARDRAIL > 0 && clickCount > MAX_CLICKS_TO_GUARDRAIL) {
      throw new Error(
        `Reservations journey exceeded click budget (${clickCount} > ${MAX_CLICKS_TO_GUARDRAIL}) before delivery-address guardrail.`
      );
    }

    await fs.mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
    await fs.writeFile(
      METRICS_PATH,
      `${JSON.stringify(
        {
          status: "passed",
          goal: "pickup guardrail requires delivery address",
          clickBudget: MAX_CLICKS_TO_GUARDRAIL,
          clickCount,
          clickTrace,
          credentialsSource: credentials.source,
          screenshotPath: SCREENSHOT_PATH,
          portalUrl: PORTAL_URL,
          capturedAtIso: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );

    console.log("PASS: reservations journey guardrails validated (pickup requires delivery address).");
    console.log(`Screenshot: ${SCREENSHOT_PATH}`);
    console.log(`Click efficiency: ${clickCount} clicks (budget ${MAX_CLICKS_TO_GUARDRAIL}).`);
    console.log(`Metrics: ${METRICS_PATH}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || error}`);
  process.exit(1);
});
