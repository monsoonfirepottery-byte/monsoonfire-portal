import test from "node:test";
import assert from "node:assert/strict";

import { buildStudioDigest, decideStudioDigestAction, normalizeDigestText, pickNextWorkshopForDigest } from "./portal-studio-digest.mjs";

test("normalizeDigestText collapses whitespace and casing", () => {
  assert.equal(normalizeDigestText("  Kiln   Status:\nReady Soon  "), "kiln status: ready soon");
});

test("buildStudioDigest produces a stable ops snapshot", () => {
  const digest = buildStudioDigest({
    activeFiring: {
      title: "Cone 6 glaze load",
      status: "FIRING",
    },
    nextFiring: {
      title: "Bisque load",
      startAt: "2026-03-13T17:00:00.000Z",
    },
    nextWorkshop: {
      title: "Wheel Lab",
      startAt: "2026-03-14T18:00:00.000Z",
    },
  });

  assert.equal(digest.title, "Studio operations snapshot");
  assert.match(digest.body, /Kiln status:/);
  assert.match(digest.body, /Next workshop: Wheel Lab/);
  assert.match(digest.body, /Store pickup:/);
  assert.ok(digest.digestFingerprint);
});

test("pickNextWorkshopForDigest skips qa fixture workshops", () => {
  const nextWorkshop = pickNextWorkshopForDigest(
    [
      {
        id: "qa-fixture-workshop-20260312",
        title: "QA Fixture Workshop 2026-03-12",
        status: "published",
        startAt: "2026-03-12T21:00:00.000Z",
        fixture: { seededBy: "portal-fixture-steward" },
      },
      {
        id: "wheel-lab-mar-2026",
        title: "Wheel Lab",
        status: "published",
        startAt: "2026-03-13T18:00:00.000Z",
      },
    ],
    new Date("2026-03-12T20:00:00.000Z")
  );

  assert.equal(nextWorkshop?.id, "wheel-lab-mar-2026");
});

test("decideStudioDigestAction skips when today's digest is unchanged", () => {
  assert.deepEqual(
    decideStudioDigestAction({
      dateKey: "2026-03-12",
      nextDigestFingerprint: "abc123",
      todaysDigest: { digestFingerprint: "abc123" },
      latestDigest: { digestFingerprint: "older" },
    }),
    { action: "skip", reason: "unchanged_today" }
  );
});

test("decideStudioDigestAction skips when the latest prior digest matches", () => {
  assert.deepEqual(
    decideStudioDigestAction({
      dateKey: "2026-03-12",
      nextDigestFingerprint: "same-as-last",
      todaysDigest: null,
      latestDigest: { digestFingerprint: "same-as-last" },
    }),
    { action: "skip", reason: "unchanged_since_last_digest" }
  );
});

test("decideStudioDigestAction upserts when today's digest needs a refresh", () => {
  assert.deepEqual(
    decideStudioDigestAction({
      dateKey: "2026-03-12",
      nextDigestFingerprint: "newer",
      todaysDigest: { digestFingerprint: "older" },
      latestDigest: { digestFingerprint: "older" },
    }),
    { action: "upsert", reason: "refresh_today" }
  );
});
