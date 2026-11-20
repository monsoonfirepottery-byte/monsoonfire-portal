import assert from "node:assert/strict";
import test from "node:test";
import { firingTicketLockId, hasExistingFiringTicket, manualFiringKey, staffCreateFiringTicketSchema, staffTicketInitialState } from "./staffFiringTicket";

const base = {
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  ownerUid: "artist-1", heatId: "mid", spaceId: "large", firingType: "glaze",
  stage: "already_unloaded", firingId: "firing-1", reviewedExistingTicketsAndPayments: true, note: "",
};

test("retroactive creation requires an existing firing and an explicit review", () => {
  assert.equal(staffCreateFiringTicketSchema.safeParse(base).success, true);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, firingId: null }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, reviewedExistingTicketsAndPayments: false }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, stage: "new_dropoff" }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, firingId: "firing/other" }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, ownerUid: "artist/other" }).success, false);
});

test("a live ticket for the same firing and owner or email blocks another", () => {
  const identity = { ownerUid: "artist-1", email: "Artist@example.com", firingId: "firing-1" };
  assert.equal(hasExistingFiringTicket([{ firingId: "firing-1", ownerUid: "artist-1" }], identity), true);
  assert.equal(hasExistingFiringTicket([{ firingId: "firing-1", email: "artist@example.com" }], identity), true);
  assert.equal(hasExistingFiringTicket([{ firingId: "firing-1", ownerUid: "artist-1", status: "deleted" }], identity), false);
  assert.equal(hasExistingFiringTicket([{ firingId: "firing-2", ownerUid: "artist-1" }], identity), false);
});

test("a past studio firing requires a valid date, kiln and evidence and cannot also name a portal firing", () => {
  const manualFiring = { date: "2026-10-28", kiln: "Studio Kiln", evidence: "Kiln log entry" };
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, firingId: null, manualFiring }).success, true);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, manualFiring }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, firingId: null, manualFiring: { ...manualFiring, date: "2026-02-31" } }).success, false);
  assert.equal(staffCreateFiringTicketSchema.safeParse({ ...base, firingId: null, manualFiring: { ...manualFiring, evidence: "" } }).success, false);
  assert.equal(manualFiringKey(manualFiring), manualFiringKey({ ...manualFiring, kiln: " studio  kiln " }));
});

test("retroactive tickets start on billing hold for reconciliation", () => {
  assert.deepEqual(staffTicketInitialState("already_unloaded"), {
    status: "awaiting_pickup_review", billingStatus: "hold_for_review",
  });
  assert.deepEqual(staffTicketInitialState("new_dropoff"), { status: "in_studio", billingStatus: "unbilled" });
});

test("duplicate locks bind both firing and identity without collisions between identity types", () => {
  assert.equal(firingTicketLockId("firing-1", "email", "artist@example.com"), firingTicketLockId("firing-1", "email", "artist@example.com"));
  assert.notEqual(firingTicketLockId("firing-1", "uid", "artist@example.com"), firingTicketLockId("firing-1", "email", "artist@example.com"));
  assert.notEqual(firingTicketLockId("firing-1", "uid", "artist-1"), firingTicketLockId("firing-2", "uid", "artist-1"));
});
