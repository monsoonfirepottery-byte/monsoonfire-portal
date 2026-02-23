import test from "node:test";
import assert from "node:assert/strict";
import {
  NON_DEV_MATERIALS_SEED_ACK,
  resolveSeedMaterialsCatalogPolicy,
} from "./materials";

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
