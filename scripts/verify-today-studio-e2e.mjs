import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadPortalAutomationEnv } from "./lib/runtime-secrets.mjs";
import { mintStaffIdTokenFromPortalEnv, resolvePortalAgentStaffCredentials } from "./lib/firebase-auth-token.mjs";

loadPortalAutomationEnv();
const baseUrl = process.argv[2] || "https://portal.monsoonfire.com";
const label = process.argv[3] || "live";
const outDir = resolve("output/playwright/staff-workspace");
await mkdir(outDir, { recursive: true });
process.env.PORTAL_FIREBASE_API_KEY ||= process.env.VITE_FIREBASE_API_KEY;
const credentials = resolvePortalAgentStaffCredentials();
const minted = await mintStaffIdTokenFromPortalEnv();
if (!minted.ok || !credentials?.email || !credentials?.uid) throw new Error("Staff verification credentials unavailable.");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const ticketResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/staffListFiringPickupReviews")) ticketResponses.push(response.status());
  });
  // Serve staged assets at the real portal origin so production CORS and Auth
  // behavior are verified against the real backend, without publishing first.
  if (baseUrl.startsWith("http://127.0.0.1")) {
    await page.route("https://portal.monsoonfire.com/**", async (route) => {
      if (!["document", "script", "stylesheet", "image", "font", "manifest"].includes(route.request().resourceType())) return route.continue();
      const url = new URL(route.request().url());
      const response = await route.fetch({url: `${baseUrl}${url.pathname}${url.search}`});
      await route.fulfill({response});
    });
  }
  // Reuse the repository canary's refresh-token sign-in with a real staff token.
  await page.route("**/accounts:signInWithPassword?key=*", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.email !== credentials.email) return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      kind: "identitytoolkit#VerifyPasswordResponse", localId: credentials.uid,
      email: credentials.email, displayName: "Staff verification",
      idToken: minted.token, refreshToken: process.env.PORTAL_STAFF_REFRESH_TOKEN || credentials.refreshToken,
      expiresIn: "3600", registered: true,
    }) });
  });
  const browserBase = baseUrl.startsWith("http://127.0.0.1") ? "https://portal.monsoonfire.com" : baseUrl;
  await page.goto(`${browserBase}/staff/cockpit/finance`, { waitUntil: "domcontentloaded" });
  await page.locator(".signed-out-card").waitFor({timeout: 30000});
  const toggle = page.getByRole("button", {name: /use a password instead/i});
  if (await toggle.count()) await toggle.click();
  await page.locator('form.signed-out-email input[type="email"]').first().fill(credentials.email);
  await page.locator('input[type="password"]').fill("staff-canary-refresh-bootstrap");
  await page.getByRole("button", {name: "Sign in", exact:true}).last().click();
  try { await page.locator('.firing-billing-module').waitFor({timeout:25000}); } catch (e) { await page.screenshot({path: `${outDir}/candidate-signin-failure.png`,fullPage:true}); console.log("URL",page.url(),"ERRORS",errors); throw e; }
  const checks = [];
  const cases = [
    ["intake", "View drop-offs", "/staff/cockpit/checkins"],
    ["calendar", "View calendar", "/staff/cockpit/studio-reservations"],
    ["kiln", "View firings", "/staff/cockpit/firings"],
    ["counter", "Open tickets", "/staff/cockpit/finance"],
    ["desk", "Open inbox", "/messages"],
    ["shelves", "Write announcement", "/staff/cockpit"],
  ];

  for (const [marker, action, path] of cases) {
    await page.goto(`${browserBase}/staff/cockpit/finance`, {waitUntil:"domcontentloaded"});
    await page.getByRole("navigation", {name:"Daily work"}).getByRole("button",{name:"Today",exact:true}).click({timeout:45000});
    try { await page.locator('.staff-studio-scene').waitFor({timeout:20000}); } catch (e) { console.log("FAILED",marker,page.url()); throw e; }
    await page.locator(`.staff-studio-marker-${marker}`).click();
    await page.locator('.staff-studio-detail').getByRole('button',{name:action,exact:true}).click();
    try { if (marker === "desk") { await page.getByRole("heading", {name:/messages/i}).first().waitFor({timeout:15000}); } else { await page.waitForURL(url => url.pathname === path, {timeout:15000}); } } catch (e) { console.log("ROUTE MISMATCH", marker, "actual", page.url(), "expected", path); throw e; }
    console.log("PASSED", marker);
    if (marker === "shelves") await page.getByTestId("staff-announcement-composer").waitFor({timeout:15000});
    checks.push({marker, result: marker === "desk" ? "Messages heading visible" : marker === "shelves" ? "Announcement composer visible" : path});

  }
  await page.goto(`${browserBase}/staff/cockpit/finance`, {waitUntil:"domcontentloaded"});
  await page.getByRole("navigation", {name:"Daily work"}).getByRole("button",{name:"Today",exact:true}).click({timeout:45000});
  await page.locator('.staff-studio-scene').waitFor({timeout:45000});
  await page.locator(".staff-studio-scene img").evaluate((img) => img.decode());
  await page.screenshot({path:`${outDir}/today-candidate-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`${outDir}/today-candidate-mobile.png`,fullPage:true});
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("Mobile overflow");
  console.log(JSON.stringify({checks,errors}));
} finally { await browser.close(); }

