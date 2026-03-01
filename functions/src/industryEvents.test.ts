import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateIndustryEventFreshness,
  filterIndustryEvents,
  normalizeIndustryEvent,
  normalizeIndustryEventMode,
  sortIndustryEvents,
} from "./industryEvents";

test("normalizeIndustryEventMode infers mode from location/remoteUrl when explicit value is missing", () => {
  assert.equal(normalizeIndustryEventMode("", { location: "Phoenix, AZ", remoteUrl: null }), "local");
  assert.equal(normalizeIndustryEventMode("", { location: null, remoteUrl: "https://example.com/live" }), "remote");
  assert.equal(
    normalizeIndustryEventMode("", { location: "Phoenix, AZ", remoteUrl: "https://example.com/live" }),
    "hybrid"
  );
  assert.equal(normalizeIndustryEventMode("remote", { location: "Phoenix, AZ", remoteUrl: null }), "remote");
});

test("normalizeIndustryEvent applies safe defaults and normalizes aliases", () => {
  const normalized = normalizeIndustryEvent("evt_1", {
    title: "NCECA Annual Conference",
    subtitle: "Ceramic gathering",
    mode: "invalid",
    startsAt: "2026-03-25T09:00:00.000Z",
    state: "AZ",
    source: "NCECA",
    sourceLink: "https://nceca.net",
    registerUrl: "https://nceca.net/register",
    tags: ["Conference", "Clay", "", "Clay"],
    featured: true,
    status: "published",
  });

  assert.equal(normalized.id, "evt_1");
  assert.equal(normalized.mode, "local");
  assert.equal(normalized.summary, "Ceramic gathering");
  assert.equal(normalized.region, "AZ");
  assert.equal(normalized.sourceName, "NCECA");
  assert.equal(normalized.sourceUrl, "https://nceca.net");
  assert.equal(normalized.registrationUrl, "https://nceca.net/register");
  assert.deepEqual(normalized.tags, ["conference", "clay"]);
  assert.equal(normalized.featured, true);
  assert.equal(normalized.status, "published");
});

test("filterIndustryEvents excludes drafts, cancelled, and past events by default", () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const events = [
    normalizeIndustryEvent("published_upcoming", {
      title: "Upcoming Local",
      mode: "local",
      status: "published",
      startAt: "2026-03-04T10:00:00.000Z",
    }),
    normalizeIndustryEvent("draft_upcoming", {
      title: "Draft Local",
      mode: "local",
      status: "draft",
      startAt: "2026-03-04T10:00:00.000Z",
    }),
    normalizeIndustryEvent("cancelled_upcoming", {
      title: "Cancelled Local",
      mode: "local",
      status: "cancelled",
      startAt: "2026-03-04T10:00:00.000Z",
    }),
    normalizeIndustryEvent("published_past", {
      title: "Past Local",
      mode: "local",
      status: "published",
      endAt: "2026-02-01T10:00:00.000Z",
    }),
  ];

  const filtered = filterIndustryEvents(events, { nowMs });
  assert.deepEqual(
    filtered.map((event) => event.id),
    ["published_upcoming"]
  );
});

test("sortIndustryEvents places featured upcoming events first and past events last", () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const events = [
    normalizeIndustryEvent("b", {
      title: "Later upcoming",
      status: "published",
      startAt: "2026-03-05T10:00:00.000Z",
    }),
    normalizeIndustryEvent("a", {
      title: "Featured upcoming",
      status: "published",
      startAt: "2026-03-03T10:00:00.000Z",
      featured: true,
    }),
    normalizeIndustryEvent("c", {
      title: "Past event",
      status: "published",
      endAt: "2026-01-10T10:00:00.000Z",
    }),
  ];

  const sorted = sortIndustryEvents(events, nowMs);
  assert.deepEqual(
    sorted.map((event) => event.id),
    ["a", "b", "c"]
  );
});

test("evaluateIndustryEventFreshness marks published events without verification as stale review", () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const decision = evaluateIndustryEventFreshness(
    {
      status: "published",
      startAt: "2026-03-20T12:00:00.000Z",
      endAt: null,
      verifiedAt: null,
    },
    { nowMs }
  );

  assert.equal(decision.outcome, "stale_review");
  assert.equal(decision.nextStatus, "published");
  assert.equal(decision.needsReview, true);
  assert.equal(decision.shouldRetire, false);
});

test("evaluateIndustryEventFreshness retires past published events after threshold", () => {
  const nowMs = Date.parse("2026-03-10T12:00:00.000Z");
  const decision = evaluateIndustryEventFreshness(
    {
      status: "published",
      startAt: "2026-03-05T12:00:00.000Z",
      endAt: "2026-03-05T14:00:00.000Z",
      verifiedAt: "2026-03-01T00:00:00.000Z",
    },
    { nowMs, retirePastMs: 48 * 60 * 60 * 1000 }
  );

  assert.equal(decision.outcome, "retired");
  assert.equal(decision.nextStatus, "cancelled");
  assert.equal(decision.shouldRetire, true);
  assert.equal(decision.retiredReason, "past_event_auto_retire");
});

test("evaluateIndustryEventFreshness keeps recently verified upcoming events fresh", () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const decision = evaluateIndustryEventFreshness(
    {
      status: "published",
      startAt: "2026-03-20T12:00:00.000Z",
      endAt: null,
      verifiedAt: "2026-02-25T00:00:00.000Z",
    },
    { nowMs, staleReviewMs: 21 * 24 * 60 * 60 * 1000 }
  );

  assert.equal(decision.outcome, "fresh");
  assert.equal(decision.nextStatus, "published");
  assert.equal(decision.needsReview, false);
  assert.equal(decision.shouldRetire, false);
});
