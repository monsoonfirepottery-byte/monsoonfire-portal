import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCoverQuality } from "./library";

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

test("evaluateCoverQuality requires verification for Open Library-only book covers without Google volume signal", () => {
  const result = evaluateCoverQuality("https://covers.openlibrary.org/b/id/12345-M.jpg", {
    mediaType: "book",
    source: "openlibrary",
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "openlibrary_cover_requires_verification");
});

test("evaluateCoverQuality approves trusted Open Library covers for books when Google volume signal exists", () => {
  const result = evaluateCoverQuality("https://covers.openlibrary.org/b/id/12345-M.jpg", {
    mediaType: "book",
    source: "openlibrary",
    googleVolumeId: "DswLAQAAMAAJ",
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
