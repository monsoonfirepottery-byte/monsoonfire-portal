import test from "node:test";
import assert from "node:assert/strict";

import {
  compareMaterialsCatalogRows,
  NON_DEV_MATERIALS_SEED_ACK,
  readTimestampMillis,
  resolveSeedMaterialsCatalogPolicy,
  type MaterialsCatalogRow,
} from "./materials";
import { Timestamp } from "./shared";

function createRow(name: string, category: string | null, priceCents = 1000): MaterialsCatalogRow {
  return {
    id: name,
    name,
    description: null,
    category,
    sku: null,
    priceCents,
    currency: "USD",
    stripePriceId: null,
    imageUrl: null,
    trackInventory: false,
    inventoryOnHand: null,
    inventoryReserved: null,
    inventoryAvailable: null,
    active: true,
    updatedAtMs: 0,
  };
}

test("compareMaterialsCatalogRows follows storefront category and variant ordering", () => {
  const names = [
    createRow("Needle Tool", "Tools"),
    createRow("Studio Day Pass", "Studio Access"),
    createRow("B-Mix - 50 lb", "Clays"),
    createRow("B-Mix - 25 lb", "Clays"),
    createRow("Wax Resist", "Finishing"),
  ]
    .sort(compareMaterialsCatalogRows)
    .map((row) => row.name);

  assert.deepEqual(names, [
    "Studio Day Pass",
    "B-Mix - 25 lb",
    "B-Mix - 50 lb",
    "Needle Tool",
    "Wax Resist",
  ]);
});

test("seed policy blocks requests without force=true", () => {
  const policy = resolveSeedMaterialsCatalogPolicy(
    { force: false },
    {
      NODE_ENV: "development",
      FUNCTIONS_EMULATOR: "true",
    } as NodeJS.ProcessEnv,
  );

  assert.equal(policy.allowed, false);
  assert.equal(policy.source, "blocked");
  assert.equal(policy.requiresForce, true);
});

test("seed policy allows explicit force=true in emulator runtime", () => {
  const policy = resolveSeedMaterialsCatalogPolicy(
    { force: true },
    {
      NODE_ENV: "development",
      FUNCTIONS_EMULATOR: "true",
    } as NodeJS.ProcessEnv,
  );

  assert.equal(policy.allowed, true);
  assert.equal(policy.source, "emulator");
});

test("seed policy blocks non-dev requests unless env + acknowledgement are both present", () => {
  const policy = resolveSeedMaterialsCatalogPolicy(
    {
      force: true,
      acknowledge: NON_DEV_MATERIALS_SEED_ACK,
    },
    {
      NODE_ENV: "production",
      FUNCTIONS_EMULATOR: "false",
      ALLOW_NON_DEV_SAMPLE_SEEDING: "false",
    } as NodeJS.ProcessEnv,
  );

  assert.equal(policy.allowed, false);
  assert.equal(policy.source, "blocked");
  assert.equal(policy.requiresAcknowledgement, true);
});

test("seed policy allows non-dev requests only with explicit env flag and acknowledgement", () => {
  const policy = resolveSeedMaterialsCatalogPolicy(
    {
      force: true,
      acknowledge: NON_DEV_MATERIALS_SEED_ACK,
      reason: "approved migration seed",
    },
    {
      NODE_ENV: "production",
      FUNCTIONS_EMULATOR: "false",
      ALLOW_NON_DEV_SAMPLE_SEEDING: "true",
      NON_DEV_SAMPLE_SEEDING_ACK: NON_DEV_MATERIALS_SEED_ACK,
    } as NodeJS.ProcessEnv,
  );

  assert.equal(policy.allowed, true);
  assert.equal(policy.source, "non_dev_explicit");
});

test("readTimestampMillis handles Firestore timestamps and timestamp-like objects", () => {
  const ts = Timestamp.fromMillis(1_700_000_000_000);

  assert.equal(readTimestampMillis(ts), 1_700_000_000_000);
  assert.equal(
    readTimestampMillis({
      seconds: 1_700_000_000,
      nanoseconds: 250_000_000,
    }),
    1_700_000_000_250
  );
  assert.equal(readTimestampMillis("2026-03-12T10:00:00.000Z"), Date.parse("2026-03-12T10:00:00.000Z"));
});
