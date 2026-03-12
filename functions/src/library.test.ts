import test from "node:test";
import assert from "node:assert/strict";

import { assessLibraryThinMetadata, deriveLibraryItemSummary, evaluateCoverQuality } from "./library";

test("evaluateCoverQuality returns missing for empty cover URL", () => {
  const result = evaluateCoverQuality(null);
  assert.equal(result.status, "missing");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "missing_cover");
});

test("evaluateCoverQuality returns invalid_cover_url for malformed URL", () => {
  const result = evaluateCoverQuality("not-a-url");
  assert.equal(result.status, "needs_review");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "invalid_cover_url");
});

test("evaluateCoverQuality flags low confidence URL patterns before trust checks", () => {
  const result = evaluateCoverQuality("https://covers.openlibrary.org/b/id/12345-S.jpg", {
    mediaType: "book",
    source: "openlibrary",
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "low_confidence_cover_url");
});

test("evaluateCoverQuality approves trusted Open Library book covers without requiring a Google volume signal", () => {
  const result = evaluateCoverQuality("https://covers.openlibrary.org/b/id/12345-M.jpg", {
    mediaType: "book",
    source: "openlibrary",
  });
  assert.equal(result.status, "approved");
  assert.equal(result.needsReview, false);
  assert.equal(result.reason, null);
});

test("evaluateCoverQuality requires review when a book-centric provider is used for non-book media", () => {
  const result = evaluateCoverQuality("https://covers.openlibrary.org/b/id/12345-M.jpg", {
    mediaType: "dvd",
    source: "openlibrary",
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "provider_book_cover_for_non_book_media");
});

test("evaluateCoverQuality flags untrusted providers for manual review", () => {
  const result = evaluateCoverQuality("https://example.com/covers/handbuilt-forms.jpg", {
    mediaType: "book",
    source: "manual",
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "untrusted_cover_source");
});

test("assessLibraryThinMetadata reports complete ISBN-backed book rows as not thin", () => {
  const result = assessLibraryThinMetadata({
    title: "Kiln Book",
    authors: ["Studio Staff"],
    summary: "A detailed studio reference for loading, maintenance, and troubleshooting.",
    description:
      "A detailed studio reference that covers loading, maintenance, glaze fit, firing schedules, shared shelf workflows, upkeep routines, and practical troubleshooting for community kilns.",
    publisher: "Monsoon Fire Press",
    publishedDate: "2026",
    pageCount: 220,
    subjects: ["kiln care", "glazes"],
    coverUrl: "https://books.googleusercontent.com/books/content?id=cover-ok&printsec=frontcover&img=1&zoom=1",
    coverQualityStatus: "approved",
    mediaType: "book",
    isbn: "9780132350884",
  });
  assert.equal(result.thin, false);
  assert.deepEqual(result.reasons, []);
});

test("assessLibraryThinMetadata reports thin imported rows when core metadata is sparse", () => {
  const result = assessLibraryThinMetadata({
    title: "ISBN 9780132350884",
    authors: [],
    description: "Reference copy from local Monsoon Fire ISBN catalog.",
    publisher: "",
    publishedDate: "",
    pageCount: null,
    subjects: [],
    coverUrl: null,
    coverQualityStatus: "missing",
    source: "local_reference",
    mediaType: "book",
    isbn: "9780132350884",
  });
  assert.equal(result.thin, true);
  assert.ok(result.reasons.includes("title_placeholder"));
  assert.ok(result.reasons.includes("summary_missing"));
  assert.ok(result.reasons.includes("description_thin"));
  assert.ok(result.reasons.includes("cover_unapproved"));
});

test("deriveLibraryItemSummary trims provider descriptions into a concise synopsis", () => {
  const summary = deriveLibraryItemSummary(
    "<p>A practical glaze notebook for testing line blends and documenting firing results.</p> <p>It also covers shelf workflow and studio sharing routines.</p>"
  );
  assert.equal(
    summary,
    "A practical glaze notebook for testing line blends and documenting firing results. It also covers shelf workflow and studio sharing routines."
  );
});

test("deriveLibraryItemSummary ignores local placeholder descriptions", () => {
  const summary = deriveLibraryItemSummary("Reference copy from local Monsoon Fire ISBN catalog.");
  assert.equal(summary, null);
});
