import test from "node:test";
import assert from "node:assert/strict";

import type { CommunityBlogRecord } from "./communityBlogs";
import {
  normalizeCommunityBlogSlug,
  prepareCommunityBlogStatusChange,
  renderCommunityBlogMarkdown,
} from "./communityBlogs";

function makeRecord(overrides: Partial<CommunityBlogRecord> = {}): CommunityBlogRecord {
  return {
    id: "blog-1",
    slug: "hello-kiln-queue",
    title: "Hello kiln queue",
    excerpt: "Short note about the kiln queue.",
    bodyMarkdown: "# Heading\n\nA **bold** note with [a link](https://example.com).\n\n- One\n- Two",
    bodyHtml: "<h1>Heading</h1>",
    featuredImage: null,
    inlineImages: [],
    tags: ["kiln", "queue"],
    tonePreset: "studio_notes",
    marketingFocus: "studio-services",
    status: "draft",
    readingMinutes: 1,
    distributions: {},
    safety: null,
    createdAtMs: 100,
    updatedAtMs: 100,
    stagedAtMs: null,
    publishedAtMs: null,
    archivedAtMs: null,
    deletedAtMs: null,
    createdByUid: "staff-1",
    updatedByUid: "staff-1",
    authorUid: "staff-1",
    authorName: "Studio Staff",
    lastStatusChangedByUid: null,
    lastPublishOverrideReason: null,
    deletedReason: null,
    ...overrides,
  };
}

test("normalizeCommunityBlogSlug creates clean stable slugs", () => {
  assert.equal(normalizeCommunityBlogSlug("  Studio & Queue Updates!!! "), "studio-and-queue-updates");
  assert.equal(normalizeCommunityBlogSlug(""), "studio-note");
});

test("renderCommunityBlogMarkdown renders safe rich text blocks", () => {
  const html = renderCommunityBlogMarkdown([
    "# Kiln note",
    "",
    "A **bold** update with [details](https://example.com) and <script>bad()</script>.",
    "",
    "> cooling now",
    "",
    "- shelf one",
    "- shelf two",
    "",
    "![Fresh cups](https://example.com/cups.jpg)",
  ].join("\n"));

  assert.match(html, /<h1>Kiln note<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<figure class="community-blog-body-figure">/);
});

test("prepareCommunityBlogStatusChange blocks high-risk publish without override", () => {
  assert.throws(
    () =>
      prepareCommunityBlogStatusChange({
        record: makeRecord(),
        nextStatus: "published",
        publishKillSwitch: false,
        actorUid: "staff-2",
        safety: {
          score: 88,
          severity: "high",
          flagged: true,
          triggers: [],
          inspectedUrlCount: 1,
          scannedAtMs: 123,
          scannedByUid: "staff-2",
          overrideReason: null,
        },
      }),
    /override reason/i
  );
});

test("prepareCommunityBlogStatusChange publishes when override is supplied", () => {
  const next = prepareCommunityBlogStatusChange({
    record: makeRecord(),
    nextStatus: "published",
    publishKillSwitch: false,
    actorUid: "staff-2",
    overrideReason: "Reviewed and approved by staff.",
    safety: {
      score: 88,
      severity: "high",
      flagged: true,
      triggers: [],
      inspectedUrlCount: 1,
      scannedAtMs: 123,
      scannedByUid: "staff-2",
      overrideReason: "Reviewed and approved by staff.",
    },
  });

  assert.equal(next.status, "published");
  assert.equal(next.updatedByUid, "staff-2");
  assert.equal(next.lastStatusChangedByUid, "staff-2");
  assert.equal(next.lastPublishOverrideReason, "Reviewed and approved by staff.");
  assert.ok((next.publishedAtMs ?? 0) > 0);
});
