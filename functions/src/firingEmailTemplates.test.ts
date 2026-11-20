import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRING_EMAIL_TEMPLATE_KEYS,
  FIRING_EMAIL_TEMPLATES,
  firingEmailTemplateForTicketStatus,
  renderFiringEmailTemplate,
} from "./firingEmailTemplates";

test("the complete nine-template family is registered with unique assets", () => {
  assert.equal(FIRING_EMAIL_TEMPLATE_KEYS.length, 9);
  assert.equal(new Set(FIRING_EMAIL_TEMPLATE_KEYS).size, 9);
  assert.equal(
    new Set(FIRING_EMAIL_TEMPLATE_KEYS.map((key) => FIRING_EMAIL_TEMPLATES[key].imageFile)).size,
    9
  );
});

test("ticket states map only to approved automatic service templates", () => {
  assert.equal(firingEmailTemplateForTicketStatus("in_studio"), "work_received");
  assert.equal(firingEmailTemplateForTicketStatus("firing"), "firing_underway");
  assert.equal(firingEmailTemplateForTicketStatus("cooling"), "cooling_down");
  assert.equal(firingEmailTemplateForTicketStatus("picked_up"), "thank_you");
  assert.equal(firingEmailTemplateForTicketStatus("pickup_complete"), "thank_you");
  assert.equal(firingEmailTemplateForTicketStatus("closed_picked_up"), "thank_you");
  assert.equal(firingEmailTemplateForTicketStatus("ready_for_pickup"), null);
  assert.equal(firingEmailTemplateForTicketStatus("awaiting_pickup_review"), null);
  assert.equal(firingEmailTemplateForTicketStatus("expected_dropoff"), null);
  assert.equal(firingEmailTemplateForTicketStatus(null), null);
});

test("each template renders live text, accessible alt text, and an inline JPEG", () => {
  for (const key of FIRING_EMAIL_TEMPLATE_KEYS) {
    const rendered = renderFiringEmailTemplate(key, {
      recipientName: "Jamie",
      ticketId: "MF-EXAMPLE-1",
      previewBlockedCommercial: true,
    });
    const definition = FIRING_EMAIL_TEMPLATES[key];
    assert.match(rendered.html, new RegExp(`alt="${definition.altText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(rendered.html.includes(`src="cid:${rendered.attachment.cid}"`));
    assert.ok(rendered.html.includes("MF-EXAMPLE-1"));
    assert.ok(rendered.text.includes("MF-EXAMPLE-1"));
    assert.equal(rendered.attachment.contentType, "image/jpeg");
    assert.equal(rendered.attachment.encoding, "base64");
    assert.ok(Buffer.from(rendered.attachment.content, "base64").length > 200_000);

    const representativeMail = JSON.stringify({
      to: "jamie@example.com",
      message: {
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        attachments: [rendered.attachment],
      },
    });
    assert.ok(Buffer.byteLength(representativeMail) < 900_000);
  }
});

test("dynamic copy is escaped in HTML while remaining readable in plain text", () => {
  const rendered = renderFiringEmailTemplate("action_needed", {
    recipientName: "<Jamie & Co>",
    ticketId: "MF-<1>",
    detail: "Reply with <clay> & glaze.",
    nextStep: "We’ll review <before firing>.",
  });
  assert.ok(rendered.html.includes("&lt;Jamie &amp; Co&gt;"));
  assert.ok(rendered.html.includes("Reply with &lt;clay&gt; &amp; glaze."));
  assert.ok(!rendered.html.includes("Reply with <clay>"));
  assert.ok(rendered.text.includes("Reply with <clay> & glaze."));
});

test("commercial follow-up stays blocked outside an explicit preview", () => {
  assert.equal(FIRING_EMAIL_TEMPLATES.next_firing.sendReady, false);
  assert.throws(
    () => renderFiringEmailTemplate("next_firing", { recipientName: "Jamie" }),
    /blocked for send/
  );
  const preview = renderFiringEmailTemplate("next_firing", { previewBlockedCommercial: true });
  assert.ok(preview.html.includes("Newsletter route preview — do not send"));
  assert.ok(preview.text.includes("NEWSLETTER ROUTE PREVIEW — DO NOT SEND"));
  assert.match(preview.text, /17926 West Montebello Ave\., Litchfield Park, AZ 85340/);
  assert.match(preview.text, /Unsubscribe control/);
  assert.ok(!preview.text.includes("This is a service message"));
});
