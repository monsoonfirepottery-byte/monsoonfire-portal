import test from "node:test";
import assert from "node:assert/strict";

import { Timestamp } from "./shared";
import {
  parseIntegrationEventDoc,
  parseJukeboxConfigDoc,
  parseMaterialsOrderDoc,
  parseReservationDoc,
} from "./firestoreConverters";

test("parseReservationDoc normalizes malformed reservation fields safely", () => {
  const earliest = Timestamp.fromMillis(1700000000000);
  const out = parseReservationDoc({
    ownerUid: "owner-1",
    status: "submitted",
    linkedBatchId: "batch-123",
    preferredWindow: {
      earliestDate: earliest,
      latestDate: "invalid",
    },
    notes: {
      general: "needs care",
    },
  });

  assert.equal(out.ownerUid, "owner-1");
  assert.equal(out.status, "submitted");
  assert.equal(out.linkedBatchId, "batch-123");
  assert.equal(out.preferredWindow.earliestDate?.toMillis(), earliest.toMillis());
  assert.equal(out.preferredWindow.latestDate, null);
  assert.equal(out.notes.general, "needs care");
  assert.equal(out.notes.clayBody, null);
});

test("parseMaterialsOrderDoc rejects malformed items payloads", () => {
  const out = parseMaterialsOrderDoc({
    uid: "u_123",
    status: "checkout_pending",
    items: [
      { productId: "prod_valid", quantity: 2, trackInventory: true },
      { productId: "", quantity: 1 },
      { productId: "prod_negative", quantity: -3 },
      { quantity: 1 },
    ],
  });

  assert.equal(out.uid, "u_123");
  assert.equal(out.status, "checkout_pending");
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0], {
    productId: "prod_valid",
    quantity: 2,
    trackInventory: true,
  });
});

test("parseIntegrationEventDoc applies deterministic fallback values", () => {
  const out = parseIntegrationEventDoc(
    {
      subject: { batchId: "b_1" },
      data: { state: "DRAFT" },
      cursor: "not-a-number",
    },
    "fallback_uid"
  );

  assert.equal(out.uid, "fallback_uid");
  assert.equal(out.type, "unknown");
  assert.equal(out.cursor, 0);
  assert.deepEqual(out.subject, { batchId: "b_1" });
});

test("parseJukeboxConfigDoc normalizes allowlist and defaults", () => {
  const out = parseJukeboxConfigDoc({
    enabled: true,
    ipAllowlistCidrs: ["192.168.1.0/24", 42, "10.0.0.0/8"],
    geoCenter: { lat: 33.5, lng: -112.1 },
    geoRadiusMeters: "150",
    maxQueuePerUser: 0,
    cooldownSeconds: -10,
    skipVoteThreshold: 0,
  });

  assert.equal(out.enabled, true);
  assert.deepEqual(out.ipAllowlistCidrs, ["192.168.1.0/24", "10.0.0.0/8"]);
  assert.deepEqual(out.geoCenter, { lat: 33.5, lng: -112.1 });
  assert.equal(out.geoRadiusMeters, 150);
  assert.equal(out.maxQueuePerUser, 1);
  assert.equal(out.cooldownSeconds, 0);
  assert.equal(out.skipVoteThreshold, 1);
});
