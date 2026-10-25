import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEME_STORAGE_KEY = "mf:firingCareTheme";
const ACCESSIBILITY_STORAGE_KEY = "mf:firingCareA11y";
const ACCOUNT_HANDOFF_HOST = "monsoonfire.kilnfire.com";
const WEBSITE_VERSION = "2.1.4";

const productionPages = [
  {
    path: "./",
    label: "home",
    heading: "Bring the work. We'll handle the fire.",
    canonical: "https://monsoonfire.com/",
  },
  {
    path: "firing-services/",
    label: "firing services",
    heading: "Pricing starts with fit.",
    canonical: "https://monsoonfire.com/firing-services/",
  },
  {
    path: "support-pickup/",
    label: "support pickup",
    heading: "Need pickup help?",
    canonical: "https://monsoonfire.com/support-pickup/",
  },
  {
    path: "policies/",
    label: "policies",
    heading: "Studio policies and expectations.",
    canonical: null,
  },
];

const axePages = ["./", "firing-services/", "support-pickup/", "policies/"];

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

test.describe("production v2 surface", () => {
  for (const entry of productionPages) {
    test(`loads ${entry.label} without client errors`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await page.goto(entry.path, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: entry.heading })).toBeVisible();
      await expect(page.locator("main#main")).toBeVisible();
      await expect(page.locator(".preview-ribbon")).toHaveCount(0);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
      if (entry.canonical) {
        await expect(page.locator("html")).toHaveAttribute("data-mf-version", WEBSITE_VERSION);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", entry.canonical);
      }
      expect(consoleErrors, `Console errors on ${entry.label}`).toEqual([]);
    });
  }

  test("home page carries the v2.1 feedback copy", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });

    await expect(page.getByText("Our kiln, your work.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start request" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "How firing works" })).toBeVisible();
    await expect(page.getByText("Zero Anxiety Checkin, either in person or via dropoff.")).toBeVisible();
    await expect(page.getByText("Low Temp Firings")).toBeVisible();
    await expect(page.getByText("Mid Temp Firings")).toBeVisible();
    await expect(page.getByRole("link", { name: "Using our portal" })).toHaveAttribute("href", "https://monsoonfire.kilnfire.com");
    await expect(page.getByRole("link", { name: "Use our contact agent" })).toHaveAttribute("href", "/support-pickup/");
    await expect(page.getByText("Ember can answer questions, gather the right details, and help set up appointments with the studio.")).toBeVisible();
    await expect(page.getByText("Billing follows completion.")).toHaveCount(0);
    await expect(page.getByText("Create a pickup appointment, then come by after confirmation.")).toBeVisible();
  });

  test("firing services page carries the v2.1 feedback copy", async ({ page }) => {
    await page.goto("firing-services/", { waitUntil: "networkidle" });

    await expect(page.locator(".page-hero")).toHaveCount(0);
    await expect(page.getByText("Example: small batch")).toBeVisible();
    await expect(page.getByText("Example: wide or tall pieces")).toBeVisible();
    await expect(page.getByText("Use our portal to set up a dropoff time and date.")).toBeVisible();
    await expect(page.getByText("Watch for pickup notice")).toBeVisible();
    await expect(page.getByText("email or SMS")).toBeVisible();
    await expect(page.getByText("Create a pickup appointment after notification, then collect the finished batch in one visit.")).toBeVisible();
    await expect(page.getByText("Match the work to the heat range.")).toBeVisible();
    await expect(page.locator('img[src="/assets/images/cone-scale-common-clay-types.png"]')).toBeVisible();
  });

  test("primary navigation is the v2 production map", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });
    const nav = page.locator("header nav");
    await expect(nav.getByRole("link", { name: "Firing Care" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Firing Services" })).toHaveAttribute("href", "/firing-services/");
    await expect(nav.getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support-pickup/");
    await expect(page.locator('a[href*="/firing-care-preview/"]')).toHaveCount(0);
  });

  test("footer uses the production site map", async ({ page }) => {
    for (const pagePath of ["./", "firing-services/", "support-pickup/", "policies/"]) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      const footer = page.locator("footer.footer");

      await expect(footer.getByRole("link", { name: "Monsoon Fire" })).toHaveAttribute("href", "/");
      await expect(footer.getByRole("link", { name: "Firing Care" })).toHaveAttribute("href", "/");
      await expect(footer.getByRole("link", { name: "Firing Services" })).toHaveAttribute("href", "/firing-services/");
      await expect(footer.getByRole("link", { name: "Support and pickup" })).toHaveAttribute("href", "/support-pickup/");
      const studioAccountHref = await footer.getByRole("link", { name: "Studio account" }).getAttribute("href");
      expect(new URL(studioAccountHref || "").origin).toBe("https://monsoonfire.kilnfire.com");
      await expect(footer.getByRole("link", { name: "Use Ember" })).toHaveAttribute("href", "/support-pickup/#ember-chat");
      await expect(footer.getByRole("link", { name: "Policies" })).toHaveAttribute("href", "/policies/");
      await expect(footer.getByRole("link", { name: "Accessibility" })).toHaveAttribute("href", "/policies/accessibility/");
      await expect(footer.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:support@monsoonfire.com");

      for (const stalePath of ["/contact/", "/services/", "/kiln-firing/", "/support/", "/memberships/", "/classes/", "/supplies/", "/gallery/", "/faq/"]) {
        await expect(footer.locator(`a[href="${stalePath}"]`), `${stalePath} should not appear in footer on ${pagePath}`).toHaveCount(0);
      }
    }
  });

  test("account handoff links intentionally use Kilnfire", async ({ page }) => {
    for (const pagePath of ["./", "firing-services/", "support-pickup/"]) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      const links = page.locator('a[href^="https://monsoonfire.kilnfire.com"]');
      expect(await links.count(), `Kilnfire handoff links missing on ${pagePath}`).toBeGreaterThan(0);

      const hrefs = await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
      for (const href of hrefs) {
        const parsed = new URL(href);
        expect(parsed.hostname).toBe(ACCOUNT_HANDOFF_HOST);
        expect(`${parsed.protocol}//${parsed.hostname}`).toBe("https://monsoonfire.kilnfire.com");
      }
    }
  });

  test("support page exposes Ember chat without contacting production during load", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.route("**/v1/support.chat.message", async (route) => {
      await route.abort("blockedbyclient");
    });
    await page.goto("support-pickup/", { waitUntil: "networkidle" });
    const chat = page.locator("[data-ember-chat]");
    await expect(chat).toBeVisible();
    await expect(chat).toHaveAttribute("data-chat-endpoint", /support\.chat\.message/);
    await expect(chat).toHaveAttribute("data-attachment-endpoint", /support\.chat\.attachment/);
    await expect(page.getByRole("heading", { name: "Tell Ember what would help." })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("theme behavior", () => {
  test("theme toggle switches and persists via localStorage", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });
    const themeToggle = page.locator('[data-theme-toggle="true"]').first();
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
  const assertAccessibilitySettings = async (page, expectedTheme) => {
    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);

    const toolbarButton = page.locator('[aria-controls="site-a11y-panel"]').first();
    await expect(toolbarButton).toBeVisible();
    await toolbarButton.focus();
    await page.keyboard.press("Enter");

    const panel = page.locator("#site-a11y-panel");
    await expect(panel).toBeVisible();
    await expect(toolbarButton).toHaveAttribute("aria-expanded", "true");

    await panel.locator('button[data-setting="text-size"][data-value="large"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
    await expect(panel.getByRole("button", { name: "Larger text" })).toHaveAttribute("aria-pressed", "true");

    await panel.getByRole("button", { name: "High contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    await expect(panel.getByRole("button", { name: "High contrast" })).toHaveAttribute("aria-pressed", "true");

    await panel.getByRole("button", { name: /Reduced motion/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(panel.getByRole("button", { name: /Reduced motion/ })).toHaveAttribute("aria-pressed", "true");

    await panel.getByRole("button", { name: "Focus highlight" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-focus", "high");
    await expect(panel.getByRole("button", { name: "Focus highlight" })).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Tab");

    const appliedStyles = await page.evaluate(() => {
      const bodyStyle = window.getComputedStyle(document.body);
      const bodyBeforeStyle = window.getComputedStyle(document.body, "::before");
      const focusedControl = document.activeElement;
      const focusedStyle = focusedControl ? window.getComputedStyle(focusedControl) : null;
      return {
        bodyFontSize: bodyStyle.fontSize,
        bodyBeforeDisplay: bodyBeforeStyle.display,
        bodyBeforeAnimationName: bodyBeforeStyle.animationName,
        focusedOutlineWidth: focusedStyle?.outlineWidth || "",
      };
    });

    expect(Number.parseFloat(appliedStyles.bodyFontSize)).toBeGreaterThanOrEqual(19);
    expect(appliedStyles.bodyBeforeDisplay).toBe("none");
    expect(appliedStyles.bodyBeforeAnimationName).toBe("none");
    expect(Number.parseFloat(appliedStyles.focusedOutlineWidth)).toBeGreaterThanOrEqual(4);

    const storedSettings = await page.evaluate((storageKey) => JSON.parse(window.localStorage.getItem(storageKey) || "{}"), ACCESSIBILITY_STORAGE_KEY);
    expect(storedSettings).toEqual({
      textSize: "large",
      contrast: "high",
      motion: "reduced",
      focus: "high",
    });

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toolbarButton).toHaveAttribute("aria-expanded", "false");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("html")).toHaveAttribute("data-focus", "high");
  };

  test("toolbar opens via keyboard and applies settings", async ({ page }) => {
    await page.goto("./", { waitUntil: "networkidle" });

    const toolbarButton = page.locator('[aria-controls="site-a11y-panel"]').first();
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

  for (const theme of ["light", "dark"]) {
    test(`toolbar settings apply and persist in ${theme} theme`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme });
      await context.addInitScript(({ themeKey, themeValue }) => {
        window.localStorage.setItem(themeKey, themeValue);
      }, { themeKey: THEME_STORAGE_KEY, themeValue: theme });
      const page = await context.newPage();
      await page.goto("./", { waitUntil: "networkidle" });

      await assertAccessibilitySettings(page, theme);

      await context.close();
    });
  }

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

    await page.goto("firing-services/", { waitUntil: "networkidle" });
    await page.screenshot({ path: testInfo.outputPath(`firing-services-${theme}.png`), fullPage: true });

    await page.goto("support-pickup/", { waitUntil: "networkidle" });
    await page.screenshot({ path: testInfo.outputPath(`support-pickup-${theme}.png`), fullPage: true });

    await context.close();
  }
});
