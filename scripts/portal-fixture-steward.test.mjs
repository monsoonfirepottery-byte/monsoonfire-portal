import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FIXTURE_FLAGS,
  buildFixtureCleanupPaths,
  buildFixtureIds,
  mergeFixtureState,
  parseArgs,
} from "./portal-fixture-steward.mjs";

test("parseArgs disables announcement seeding by default", () => {
  const options = parseArgs(["--api-key", "test-key"]);
  assert.equal(options.fixtureFlags.seedAnnouncement, false);
  assert.equal(options.fixtureFlags.seedBatchPiece, DEFAULT_FIXTURE_FLAGS.seedBatchPiece);
  assert.equal(options.fixtureFlags.seedNotification, DEFAULT_FIXTURE_FLAGS.seedNotification);
});

test("parseArgs accepts explicit fixture toggles", () => {
  const options = parseArgs([
    "--api-key",
    "test-key",
    "--seed-announcement",
    "--no-seed-workshop-event",
    "--no-seed-direct-messages",
  ]);

  assert.equal(options.fixtureFlags.seedAnnouncement, true);
  assert.equal(options.fixtureFlags.seedWorkshopEvent, false);
  assert.equal(options.fixtureFlags.seedDirectMessages, false);
});

test("buildFixtureIds is deterministic for a Phoenix day", () => {
  assert.deepEqual(
    buildFixtureIds({
      prefix: "qa-fixture",
      runDateKey: "2026-03-12",
    }),
    {
      compact: "20260312",
      batchClientRequestId: "qa-fixture-batch-20260312",
      pieceId: "qa-fixture-piece-20260312",
      announcementId: "qa-fixture-studio-update-20260312",
      notificationId: "qa-fixture-notification-20260312",
      workshopEventId: "qa-fixture-workshop-20260312",
      threadId: "qa-fixture-thread-20260312",
      messageId: "qa-fixture-message-20260312",
      messageRfc822Id: "<qa-fixture-message-20260312@monsoonfire.local>",
    }
  );
});

test("mergeFixtureState preserves prior same-day references on partial reruns", () => {
  const merged = mergeFixtureState(
    {
      runDate: "2026-03-12",
      uid: "staff-1",
      batchId: "batch-1",
      pieceId: "piece-1",
      workshopEventId: "workshop-1",
      fixtureFlags: {
        seedBatchPiece: true,
        seedWorkshopEvent: true,
      },
    },
    {
      runDate: "2026-03-12",
      uid: "staff-1",
      notificationId: "notification-1",
      fixtureFlags: {
        seedNotification: true,
      },
    }
  );

  assert.equal(merged.batchId, "batch-1");
  assert.equal(merged.pieceId, "piece-1");
  assert.equal(merged.workshopEventId, "workshop-1");
  assert.equal(merged.notificationId, "notification-1");
  assert.equal(merged.fixtureFlags.seedAnnouncement, false);
  assert.equal(merged.fixtureFlags.seedNotification, true);
});

test("buildFixtureCleanupPaths skips null references", () => {
  assert.deepEqual(
    buildFixtureCleanupPaths({
      uid: "staff-1",
      notificationId: "notification-1",
      batchId: "batch-1",
      pieceId: "piece-1",
      threadId: null,
      messageId: null,
      announcementId: null,
      workshopEventId: null,
    }),
    [
      "users/staff-1/notifications/notification-1",
      "batches/batch-1/pieces/piece-1",
      "batches/batch-1",
    ]
  );
});
