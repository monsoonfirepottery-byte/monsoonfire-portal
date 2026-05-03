import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const previewFiles = [
  "index.html",
  "firing-services/index.html",
  "support-pickup/index.html",
  "preview.css",
  "preview.js",
  "assets/dropoff-estimate-examples.png",
  "agent-service-catalog.json",
  "ai.txt",
  "llms.txt",
];

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

test.describe("firing care preview source", () => {
  test("source and ncsitebuilder mirrors stay byte-for-byte aligned", async () => {
    for (const file of previewFiles) {
      const source = await readFile(path.resolve("website/firing-care-preview", file));
      const mirror = await readFile(path.resolve("website/ncsitebuilder/firing-care-preview", file));
      expect(Buffer.compare(mirror, source), `${file} mirror drifted`).toBe(0);
    }
  });

  test("preview pages are noindex and use the preview asset bundle", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    for (const pagePath of [
      "/firing-care-preview/",
      "/firing-care-preview/firing-services/",
      "/firing-care-preview/support-pickup/",
    ]) {
      await page.goto(pagePath, { waitUntil: "networkidle" });
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[href*="/firing-care-preview/preview.css"]')).toHaveCount(1);
      await expect(page.locator('script[src*="/firing-care-preview/preview.js"]')).toHaveCount(1);
      await expect(page.locator("main#main")).toBeVisible();
      await expect(page.getByText("A2C")).toHaveCount(0);
      await expect(page.getByText("Agent-readable preview note")).toHaveCount(0);
      await expect(page.getByText("What this site should make obvious")).toHaveCount(0);
      await expect(page.getByText("Reference plan")).toHaveCount(0);
    }

    await page.goto("/firing-care-preview/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Bring the work. We'll handle the fire." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clear steps, fewer surprises." })).toBeVisible();
    await expect(page.getByText("Before you drop off")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "A few details help us care for the work." })).toHaveCount(0);

    await page.goto("/firing-care-preview/firing-services/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Drop off with a clear plan." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick is the goal. Careful is the rule." })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("support page exposes Ember chat and keeps attachment UI local until used", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto("/firing-care-preview/support-pickup/", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Need pickup help?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tell Ember what would help." })).toBeVisible();
    await expect(page.getByText("Tell Ember what changed.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "I'm ready for my stuff!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Is my work ready?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "I have a date coming up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "I have dropoff details" })).toBeVisible();
    const faq = page.locator(".support-faq-section");
    await expect(faq).toBeVisible();
    await expect(faq.getByRole("heading", { name: "Three quick answers." })).toBeVisible();
    await expect(faq.locator(".support-faq-item")).toHaveCount(3);
    await expect(faq).toContainText("Can I change my pickup time?");
    await expect(faq).toContainText("Is my work ready?");
    await expect(faq).toContainText("Can I update a dropoff or deadline?");
    await expect(page.getByText("What support can move")).toHaveCount(0);
    await expect(page.getByText("What staff confirms")).toHaveCount(0);

    const chat = page.locator("[data-ember-chat]");
    await expect(chat).toBeVisible();
    await expect(chat).toHaveAttribute("data-chat-endpoint", /support\.chat\.message/);
    await expect(chat).toHaveAttribute("data-attachment-endpoint", /support\.chat\.attachment/);
    await expect(page.locator("[data-ember-attachment-input]")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await expect(page.locator("[data-ember-dock]")).toBeHidden();
    await expect(page.locator("[data-ember-checklist-panel]")).toBeHidden();
    await expect(page.locator("[data-ember-attachment-list]")).toBeHidden();

    expect(await page.locator("[data-ember-prompt]").count()).toBe(4);
    expect(consoleErrors).toEqual([]);
  });

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
            personaVersion: "ember-support-v20.preview.2026-05-01",
            guardrailVersion: "support-web-guardrails-v3",
            opsLabels: ["staff-review", "has-pieces"],
            modelDrafting: { configured: false, active: false, mode: "deterministic_templates" },
            triage: { intent: "account_status" },
            nextAction: "staff_review_created",
          },
        }),
      });
    });

    await page.goto("/firing-care-preview/support-pickup/", { waitUntil: "networkidle" });
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
              expiresAt: "2026-05-01T05:00:00.000Z",
            },
            attachmentStore: "studio-brain-postgres",
            emberMessage: "I added that photo to the studio note.",
          },
        }),
      });
    });

    await page.goto("/firing-care-preview/support-pickup/", { waitUntil: "networkidle" });
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
