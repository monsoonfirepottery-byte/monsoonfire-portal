import assert from "node:assert/strict";
import test from "node:test";
import { reservationFiringRequests } from "./reservationFiringBridge";

test("a paid reservation carries its own pricing version and add-on requests into review", () => {
  assert.deepEqual(reservationFiringRequests({ ownerUid: "artist", status: "REQUESTED", intakeMode: "SHELF_PURCHASE", firingRange: "high", pricingVersion: 2, addOns: { privateRequested: true, rushRequested: true, communityShelfFillInAllowed: true, useStudioGlazes: true } }, "artist"), { firingRange: "high", pricingVersion: 2, private: true, rush: true, communitySharing: true, otherRequestedServices: ["Studio glaze access"] });
  assert.equal(reservationFiringRequests({ ownerUid: "artist", intakeMode: "SHELF_PURCHASE", addOns: {} }, "artist").pricingVersion, null);
  assert.equal(reservationFiringRequests({ ownerUid: "artist", intakeMode: "SHELF_PURCHASE" }, "artist").firingRange, null);
});

test("a different client's, cancelled, or free community reservation cannot become a billable ticket", () => {
  assert.throws(() => reservationFiringRequests({ ownerUid: "other" }, "artist"), /OWNER_MISMATCH/);
  assert.throws(() => reservationFiringRequests({ ownerUid: "artist", intakeMode: "SHELF_PURCHASE", status: "CANCELLED" }, "artist"), /NOT_ACTIVE/);
  assert.throws(() => reservationFiringRequests({ ownerUid: "artist", intakeMode: "COMMUNITY_SHELF" }, "artist"), /NOT_BILLABLE/);
  assert.throws(() => reservationFiringRequests({ ownerUid: "artist" }, "artist"), /NOT_BILLABLE/);
});
