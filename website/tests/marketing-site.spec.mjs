import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEME_STORAGE_KEY = "mf:websiteTheme";
const ACCESSIBILITY_STORAGE_KEY = "mf:websiteAccessibility";

const majorPages = [
  { path: "./", label: "home", requiredSelector: "main#main h1" },
  { path: "services/", label: "services", requiredSelector: "main#main" },
  { path: "kiln-firing/", label: "kiln-firing", requiredSelector: "main#main h1" },
  { path: "faq/", label: "faq", requiredSelector: "main#main" },
  { path: "support/", label: "support", requiredSelector: "main#main" },
  { path: "contact/", label: "contact", requiredSelector: "form[data-contact-intake]" },
  { path: "policies/", label: "policies", requiredSelector: "main#main" },
];

const portalEntryPages = [
  "./",
  "services/",
  "kiln-firing/",
  "faq/",
  "support/",
  "contact/",
  "policies/",
  "memberships/",
  "supplies/",
];

const axePages = ["./", "kiln-firing/", "support/", "contact/", "policies/"];

const ignoredConsoleErrorPatterns = [
  /ERR_BLOCKED_BY_CLIENT/i,
];

const collectConsoleErrors = (page) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => {
    const text = error?.message || String(error);
    if (ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text))) return;
    errors.push(`pageerror: ${text}`);
  });
  return errors;
};

const formatViolations = (violations) => {
  if (!violations.length) return "No serious or critical violations.";
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ");
      return `${violation.id} (${violation.impact}): ${violation.help} -> ${nodes}`;
    })
    .join("\n");
};

test.describe("marketing smoke coverage", () => {
  for (const entry of majorPages) {
    test(`loads ${entry.label} without client errors`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await page.goto(entry.path, { waitUntil: "networkidle" });
      await expect(page.locator(entry.requiredSelector).first()).toBeVisible();
      expect(consoleErrors, `Console errors on ${entry.label}`).toEqual([]);
    });
  }

  test("community hub includes key outbound links", async ({ page }) => {
    await page.goto("faq/", { waitUntil: "networkidle" });
    const links = page.locator('a[href*="discord"], a[href*="instagram"], a[href*="mailto:"], a[href*="kilnfire.com"]');
    expect(await links.count()).toBeGreaterThan(0);
  });

  test("portal entry links stay on kilnfire host", async ({ page }) => {
    for (const pagePath of portalEntryPages) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      const legacyPortalLinks = page.locator('a[href*="portal.monsoonfire.com"]');
      expect(await legacyPortalLinks.count(), `Legacy portal host found on ${pagePath}`).toBe(0);
    }
  });
});

test.describe("theme behavior", () => {
  test("theme toggle switches and persists via localStorage", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });
    const themeToggle = page.locator('[data-theme-toggle="true"]');
    await expect(themeToggle).toBeVisible();

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await themeToggle.click();
    const toggledTheme = await page.locator("html").getAttribute("data-theme");

    expect(initialTheme).toBeTruthy();
    expect(toggledTheme).toBeTruthy();
    expect(toggledTheme).not.toBe(initialTheme);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", toggledTheme || "");
    const storedTheme = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), THEME_STORAGE_KEY);
    expect(storedTheme).toBe(toggledTheme);
  });

  test("defaults follow prefers-color-scheme when no stored theme", async ({ browser }) => {
    const darkContext = await browser.newContext({ colorScheme: "dark" });
    const darkPage = await darkContext.newPage();
    await darkPage.addInitScript(([themeKey, accessibilityKey]) => {
      window.localStorage.removeItem(themeKey);
      window.localStorage.removeItem(accessibilityKey);
    }, [THEME_STORAGE_KEY, ACCESSIBILITY_STORAGE_KEY]);
    await darkPage.goto("./", { waitUntil: "networkidle" });
    await expect(darkPage.locator("html")).toHaveAttribute("data-theme", "dark");
    await darkContext.close();

    const lightContext = await browser.newContext({ colorScheme: "light" });
    const lightPage = await lightContext.newPage();
    await lightPage.addInitScript(([themeKey, accessibilityKey]) => {
      window.localStorage.removeItem(themeKey);
      window.localStorage.removeItem(accessibilityKey);
    }, [THEME_STORAGE_KEY, ACCESSIBILITY_STORAGE_KEY]);
    await lightPage.goto("./", { waitUntil: "networkidle" });
    await expect(lightPage.locator("html")).toHaveAttribute("data-theme", "light");
    await lightContext.close();
  });
});

test.describe("accessibility toolbar behavior", () => {
  test("toolbar opens via keyboard and applies settings", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });

    const toolbarButton = page.locator('[aria-controls="site-a11y-panel"]');
    await expect(toolbarButton).toBeVisible();
    await toolbarButton.focus();
    await page.keyboard.press("Enter");

    const panel = page.locator("#site-a11y-panel");
    await expect(panel).toBeVisible();

    await panel.locator('button[data-setting="text-size"][data-value="large"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");

    await panel.getByRole("button", { name: "High contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");

    await panel.getByRole("button", { name: /Reduced motion/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

    await panel.getByRole("button", { name: "Focus highlight" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-focus", "high");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("skip link remains keyboard discoverable", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await expect(page.locator(".skip-link")).toHaveAttribute("href", "#main");
  });
});

test.describe("axe serious and critical checks", () => {
  for (const pagePath of axePages) {
    test(`axe scan for ${pagePath}`, async ({ page }) => {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      const result = await new AxeBuilder({ page }).analyze();
      const severeViolations = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
      expect(severeViolations, formatViolations(severeViolations)).toEqual([]);
    });
  }
});

test("captures key-page screenshots in light and dark themes", async ({ browser }, testInfo) => {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext();
    await context.addInitScript(({ storageKey, value }) => {
      window.localStorage.setItem(storageKey, value);
    }, { storageKey: THEME_STORAGE_KEY, value: theme });
    const page = await context.newPage();

    await page.goto("./", { waitUntil: "networkidle" });
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`), fullPage: true });

    await page.goto("kiln-firing/", { waitUntil: "networkidle" });
    await page.screenshot({ path: testInfo.outputPath(`kiln-firing-${theme}.png`), fullPage: true });

    await context.close();
  }
});
