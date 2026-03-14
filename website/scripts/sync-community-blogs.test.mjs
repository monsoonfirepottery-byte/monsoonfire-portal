import test from "node:test";
import assert from "node:assert/strict";

import {
  renderBlogIndexPage,
  renderBlogPostPage,
  renderRssFeed,
  updateSitemapXml,
} from "./sync-community-blogs.mjs";

const sampleExperience = {
  generatedAtMs: Date.parse("2026-03-13T09:00:00.000Z"),
  posts: [
    {
      id: "blog-1",
      slug: "kiln-queue-update",
      title: "Kiln queue update",
      excerpt: "A short note about the next glaze cycle.",
      bodyHtml: "<p>The next glaze cycle is loading tonight.</p>",
      tags: ["kiln", "glaze"],
      readingMinutes: 2,
      authorName: "Studio staff",
      publishedAtMs: Date.parse("2026-03-13T08:00:00.000Z"),
      updatedAtMs: Date.parse("2026-03-13T09:00:00.000Z"),
      featuredImage: {
        url: "https://example.com/kiln.jpg",
        alt: "Glaze kiln shelves",
      },
      canonicalUrl: "https://monsoonfire.com/blog/kiln-queue-update/",
      marketingFocus: "kiln-firing",
      previousSlug: "member-rhythm-note",
      nextSlug: null,
      relatedSlugs: ["member-rhythm-note"],
    },
    {
      id: "blog-2",
      slug: "member-rhythm-note",
      title: "Member rhythm note",
      excerpt: "A steady studio rhythm matters.",
      bodyHtml: "<p>A steady studio rhythm matters.</p>",
      tags: ["membership"],
      readingMinutes: 3,
      authorName: "Studio staff",
      publishedAtMs: Date.parse("2026-03-12T08:00:00.000Z"),
      updatedAtMs: Date.parse("2026-03-12T09:00:00.000Z"),
      featuredImage: null,
      canonicalUrl: "https://monsoonfire.com/blog/member-rhythm-note/",
      marketingFocus: "memberships",
      previousSlug: null,
      nextSlug: "kiln-queue-update",
      relatedSlugs: ["kiln-queue-update"],
    },
  ],
  externalHighlights: [
    {
      id: "ext-1",
      sourceId: "source-1",
      sourceTitle: "Ceramic Arts Daily",
      sourceUrl: "https://example.com",
      title: "Glaze timing notes",
      excerpt: "An outside read on firing rhythm and glaze timing.",
      canonicalUrl: "https://example.com/glaze-timing",
      imageUrl: "https://example.com/glaze.jpg",
      imageAlt: "Glaze timing notes",
      publishedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
      updatedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
      importedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
      status: "featured",
      authorName: "External author",
      tags: ["glaze"],
      studioNote: "Worth tracking beside our own firing notes.",
    },
  ],
};

test("renderBlogIndexPage includes feature, recent posts, and external rail", () => {
  const html = renderBlogIndexPage(sampleExperience, sampleExperience.generatedAtMs);
  assert.match(html, /Short reads from the studio floor/);
  assert.match(html, /Latest studio note/);
  assert.match(html, /Member rhythm note/);
  assert.match(html, /Around the studio/);
  assert.match(html, /Glaze timing notes/);
});

test("renderBlogPostPage includes share controls, CTA, related posts, and JSON-LD hook content", () => {
  const html = renderBlogPostPage(sampleExperience.posts[0], sampleExperience);
  assert.match(html, /Share this note/);
  assert.match(html, /Explore kiln firing/);
  assert.match(html, /More studio notes/);
  assert.match(html, /Around the studio/);
  assert.match(html, /application\/ld\+json/);
});

test("renderRssFeed includes published posts", () => {
  const xml = renderRssFeed(sampleExperience, sampleExperience.generatedAtMs);
  assert.match(xml, /<rss version="2.0">/);
  assert.match(xml, /Kiln queue update/);
  assert.match(xml, /https:\/\/monsoonfire\.com\/blog\/kiln-queue-update\//);
});

test("updateSitemapXml appends blog index and post urls without removing existing pages", () => {
  const baseXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://monsoonfire.com/</loc><lastmod>2026-02-01</lastmod></url>\n</urlset>`;
  const nextXml = updateSitemapXml(baseXml, sampleExperience.posts, sampleExperience.generatedAtMs);
  assert.match(nextXml, /https:\/\/monsoonfire\.com\/<\/loc>/);
  assert.match(nextXml, /https:\/\/monsoonfire\.com\/blog\/<\/loc>/);
  assert.match(nextXml, /https:\/\/monsoonfire\.com\/blog\/kiln-queue-update\//);
});
