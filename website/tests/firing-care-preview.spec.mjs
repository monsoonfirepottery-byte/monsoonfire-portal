import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const mirroredFiles = [
  "index.html",
  "agent-docs/index.html",
  "firing-services/index.html",
  "support-pickup/index.html",
  "assets/css/firing-care.css",
  "assets/js/firing-care.js",
  "assets/images/dropoff-estimate-examples.png",
  "assets/images/cone-scale-common-clay-types.png",
  "agent-service-catalog.json",
  "ai.txt",
  "llms.txt",
  ".htaccess",
  "web.config",
  "sitemap.xml",
];
const WEBSITE_VERSION = "2.1.4";

const listHtmlFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "ncsitebuilder") continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listHtmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(entryPath);
    }
  }

  return files;
};

const collectConsoleErrors = (page) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error?.message || String(error)}`);
  });
  return errors;
};

test.describe("firing care production source", () => {
  test("source and ncsitebuilder mirrors stay byte-for-byte aligned", async () => {
    for (const file of mirroredFiles) {
      const source = await readFile(path.resolve("website", file));
      const mirror = await readFile(path.resolve("website/ncsitebuilder", file));
      expect(Buffer.compare(mirror, source), `${file} mirror drifted`).toBe(0);
    }
  });

  test("sitewide footers use the production footer map", async () => {
    const htmlFiles = await listHtmlFiles(path.resolve("website"));

    for (const file of htmlFiles) {
      const relativeFile = path.relative(path.resolve("website"), file);
      const html = await readFile(file, "utf8");
      const footerMatch = html.match(/<footer class="footer" aria-label="Site footer">[\s\S]*?<\/footer>/);
      expect(footerMatch, `${relativeFile} is missing the shared footer`).toBeTruthy();

      const footer = footerMatch?.[0] || "";
      for (const expected of [
        'class="container footer-grid footer-grid--site"',
        'href="/">Monsoon Fire</a>',
        'href="/">Firing Care</a>',
        'href="/firing-services/">Firing Services</a>',
        'href="/support-pickup/">Support and pickup</a>',
        'href="https://monsoonfire.kilnfire.com"',
        'href="/support-pickup/#ember-chat">Use Ember</a>',
        'href="/policies/">Policies</a>',
        'href="/policies/accessibility/">Accessibility</a>',
        'href="mailto:support@monsoonfire.com">Email support</a>',
      ]) {
        expect(footer, `${relativeFile} footer missing ${expected}`).toContain(expected);
      }

      for (const stalePath of ["/contact/", "/services/", "/kiln-firing/", "/support/", "/memberships/", "/classes/", "/supplies/", "/gallery/", "/faq/"]) {
        expect(footer, `${relativeFile} footer has stale ${stalePath} link`).not.toContain(`href="${stalePath}"`);
      }
    }
  });

  test("production pages are indexable and use production asset paths", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    for (const pagePath of ["/", "/firing-services/", "/support-pickup/"]) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
      await expect(page.locator('link[href*="/assets/css/firing-care.css"]')).toHaveCount(1);
      await expect(page.locator('script[src*="/assets/js/firing-care.js"]')).toHaveCount(1);
      await expect(page.locator('link[href*="/firing-care-preview/"]')).toHaveCount(0);
      await expect(page.locator('script[src*="/firing-care-preview/"]')).toHaveCount(0);
      await expect(page.locator("main#main")).toBeVisible();
      await expect(page.getByText("Private preview")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-mf-version", WEBSITE_VERSION);
    }

    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Bring the work. We'll handle the fire." })).toBeVisible();
    await expect(page.getByText("Our kiln, your work.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start request" })).toHaveCount(0);
    await expect(page.getByText("Zero Anxiety Checkin, either in person or via dropoff.")).toBeVisible();
    await expect(page.getByText("Low Temp Firings")).toBeVisible();
    await expect(page.getByText("Mid Temp Firings")).toBeVisible();
    await expect(page.getByRole("link", { name: "Using our portal" })).toHaveAttribute("href", "https://monsoonfire.kilnfire.com");
    await expect(page.getByRole("link", { name: "Use our contact agent" })).toHaveAttribute("href", "/support-pickup/");
    await expect(page.getByText("Billing follows completion.")).toHaveCount(0);
    await expect(page.getByText("Create a pickup appointment, then come by after confirmation.")).toBeVisible();

    await page.goto("/firing-services/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Pricing starts with fit." })).toBeVisible();
    await expect(page.locator(".page-hero")).toHaveCount(0);
    await expect(page.getByText("Example: small batch")).toBeVisible();
    await expect(page.getByText("Watch for pickup notice")).toBeVisible();
    await expect(page.getByText("Create a pickup appointment after notification, then collect the finished batch in one visit.")).toBeVisible();
    await expect(page.getByText("Match the work to the heat range.")).toBeVisible();
    await expect(page.locator('img[src="/assets/images/dropoff-estimate-examples.png"]')).toHaveCount(1);
    await expect(page.locator('img[src="/assets/images/cone-scale-common-clay-types.png"]')).toHaveCount(1);

    await page.goto("/support-pickup/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Need pickup help?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tell Ember what would help." })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("routing contract deprecates preview and old marketing paths", async () => {
    const htaccess = await readFile(path.resolve("website/.htaccess"), "utf8");
    const sitemap = await readFile(path.resolve("website/sitemap.xml"), "utf8");

    for (const expected of [
      "RewriteRule ^firing-care-preview/?$ / [R=301,L,NC]",
      "RewriteRule ^firing-care-preview/firing-services/?$ /firing-services/ [R=301,L,NC]",
      "RewriteRule ^firing-care-preview/support-pickup/?$ /support-pickup/ [R=301,L,NC]",
      "RewriteRule ^(?:services|kiln-firing|Kiln-Rentals)/?$ /firing-services/ [R=301,L,NC]",
      "RewriteRule ^(?:support|contact|faq|Community-Guide)/?$ /support-pickup/ [R=301,L,NC]",
      "RewriteRule ^(?:memberships|classes|supplies|gallery|kiln-status|Memberships|Classes|Store|Gallery)/?$ - [G,L,NC]",
    ]) {
      expect(htaccess).toContain(expected);
    }

    expect(htaccess).not.toContain("RewriteRule ^ index.html [L]");
    expect(sitemap).toContain("https://monsoonfire.com/firing-services/");
    expect(sitemap).toContain("https://monsoonfire.com/support-pickup/");
    expect(sitemap).not.toContain("https://monsoonfire.com/firing-care-preview/");
    expect(sitemap).not.toContain("https://monsoonfire.com/memberships/");
  });

  test("agent catalog is production scoped and hands off to Kilnfire", async () => {
    const catalog = JSON.parse(await readFile(path.resolve("website/agent-service-catalog.json"), "utf8"));
    expect(catalog.preview).toBe(false);
    expect(catalog.version).toBe(WEBSITE_VERSION);
    expect(catalog.visibility).toBe("public-production");
    expect(catalog.provider.studioAccountUrl).toBe("https://monsoonfire.kilnfire.com");
    expect(catalog.canonicalCta.url).toBe("https://monsoonfire.kilnfire.com");
    expect(catalog.agentOnlySurfaces).toEqual(["/llms.txt", "/ai.txt", "/agent-service-catalog.json"]);
  });
});

test.describe("Ember support production behavior", () => {
  test("Ember chat handles a staff-review response without calling production during tests", async ({ page }) => {
    await page.route("**/v1/support.chat.message", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            sessionId: "ember_test_session",
            emberMessage: "I turned that into a clear studio note for staff to review.",
            replyMode: "staff_review",
            humanReviewRequired: true,
            supportRequestId: "support_test_123456",
            supportRequestShortId: "support_",
            contactRequested: true,
            supportEmailQueued: true,
            handoffStatus: "sent_to_studio",
            staffPreviewText: "Pickup/status request for Sam Potter.\nPieces: 2 mugs.\nReady for staff review.",
            attachments: [],
            threadChecklist: [
              { key: "client_reference", label: "Name or order", state: "done", detail: "Sam Potter" },
              { key: "piece_summary", label: "Pieces", state: "done", detail: "2 mugs" },
              { key: "contact_method", label: "Contact method", state: "needed", detail: "Add email or phone if staff should reply." },
              { key: "studio_handoff", label: "Studio handoff", state: "done", detail: "Saved and queued for staff review." },
            ],
            thread: {
              state: "sent_to_studio",
              title: "Studio note is with staff",
              detail: "Pickup/status request for Sam Potter.",
            },
            nextQuestion: "Want staff to reply directly? Add an email or phone below.",
            personaVersion: "ember-support-v20.production.2026-05-04",
            guardrailVersion: "support-web-guardrails-v3",
            opsLabels: ["staff-review", "has-pieces"],
            modelDrafting: { configured: false, active: false, mode: "deterministic_templates" },
            triage: { intent: "account_status" },
            nextAction: "staff_review_created",
          },
        }),
      });
    });

    await page.goto("/support-pickup/", { waitUntil: "networkidle" });
    await page.locator("[data-ember-chat-input]").fill("Ready status: Sam Potter, pieces are 2 mugs.");
    await page.locator("[data-ember-chat-form]").getByRole("button", { name: "Send" }).click();

    await expect(page.locator("[data-ember-thread-card]")).toBeVisible();
    await expect(page.locator("[data-ember-thread-title]")).toContainText("Studio note is with staff");
    await expect(page.locator("[data-ember-contact-panel]")).toBeVisible();
    await expect(page.locator("[data-ember-preview-panel]")).toBeVisible();
    await expect(page.locator("[data-ember-action-toast]")).toBeVisible();
    await expect(page.locator("[data-ember-action-text]")).toContainText("Sent to studio");
    await expect(page.locator("[data-ember-checklist-panel]")).toBeVisible();
    await expect(page.locator("[data-ember-checklist] li")).toHaveCount(4);
    await expect(page.locator("[data-ember-checklist]")).toContainText("Contact method");
  });

  test("Ember restores local drafts and renders uploaded photo history", async ({ page }) => {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );

    await page.route("**/v1/support.chat.attachment", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.fileName).toBe("dropoff.jpg");
      expect(body.contentType).toBe("image/jpeg");
      expect(body.dataBase64).toBeTruthy();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            sessionId: "ember_photo_session",
            attachment: {
              fileName: body.fileName,
              contentType: body.contentType,
              sizeBytes: body.sizeBytes,
              expiresAt: "2026-05-05T05:00:00.000Z",
            },
            attachmentStore: "studio-brain-postgres",
            emberMessage: "I added that photo to the studio note.",
          },
        }),
      });
    });

    await page.goto("/support-pickup/", { waitUntil: "networkidle" });
    await page.locator("[data-ember-chat-input]").fill("Dropoff update: wide bowl and glaze note.");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("[data-ember-chat-input]")).toHaveValue("Dropoff update: wide bowl and glaze note.");

    await page.locator("[data-ember-attachment-input]").setInputFiles({
      name: "dropoff.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    await expect(page.locator("[data-ember-attachment-list]")).toBeVisible();
    await expect(page.locator("[data-ember-attachment-list]")).toContainText("dropoff.jpg");
    await expect(page.locator("[data-ember-checklist-panel]")).toBeVisible();
    await expect(page.locator("[data-ember-chat-status]")).toContainText("Photo is attached");
  });
});
