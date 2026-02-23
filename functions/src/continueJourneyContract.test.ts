import test from "node:test";
import assert from "node:assert/strict";

import { buildContinueJourneyContract } from "./continueJourneyContract";
import { Timestamp } from "./shared";
import { TimelineEventType } from "./timelineEventTypes";

test("buildContinueJourneyContract enforces draft/lineage/timeline post-conditions", () => {
  const out = buildContinueJourneyContract({
    uid: "uid_1",
    fromBatchId: "batch_source",
    requestedTitle: "",
    sourceBatch: {
      title: "Bisque set",
      ownerDisplayName: "Alex",
      intakeMode: "SELF_SERVICE",
      journeyRootBatchId: "batch_root",
    },
    at: Timestamp.fromMillis(1700000000000),
  });

  assert.equal(out.rootId, "batch_root");
  assert.equal(out.newBatchDocument["state"], "DRAFT");
  assert.equal(out.newBatchDocument["isClosed"], false);
  assert.equal(out.newBatchDocument["journeyRootBatchId"], "batch_root");
  assert.equal(out.newBatchDocument["journeyParentBatchId"], "batch_source");
  assert.equal(out.newBatchDocument["title"], "Bisque set (resubmission)");

  assert.equal(out.timelineEvent.type, TimelineEventType.CONTINUE_JOURNEY);
  assert.equal(out.timelineEvent.notes, "Continued journey from batch_source");
  assert.deepEqual(out.timelineEvent.extra, { fromBatchId: "batch_source" });

  assert.equal(out.integrationEventData["state"], "DRAFT");
  assert.equal(out.integrationEventData["isClosed"], false);
  assert.equal(out.integrationEventData["title"], "Bisque set");
  assert.equal(out.integrationEventData["journeyRootBatchId"], "batch_root");
  assert.deepEqual(out.integrationEventSubject, { fromBatchId: "batch_source" });
});

test("buildContinueJourneyContract uses source id as root when missing and honors explicit title", () => {
  const out = buildContinueJourneyContract({
    uid: "uid_2",
    fromBatchId: "batch_a",
    requestedTitle: "Glaze cycle 2",
    sourceBatch: {
      title: "Original",
      ownerDisplayName: null,
      intakeMode: "",
      journeyRootBatchId: null,
    },
    at: Timestamp.fromMillis(1700000010000),
  });

  assert.equal(out.rootId, "batch_a");
  assert.equal(out.newBatchDocument["journeyRootBatchId"], "batch_a");
  assert.equal(out.newBatchDocument["title"], "Glaze cycle 2");
  assert.equal(out.newBatchDocument["intakeMode"], "SELF_SERVICE");
  assert.equal(out.integrationEventData["title"], "Glaze cycle 2");
});
