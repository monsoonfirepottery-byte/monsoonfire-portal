import test from "node:test";
import assert from "node:assert/strict";
import { readStripeModel, resolveStripeReaderPolicy } from "./stripeReader";

async function withPatchedEnv(
  patch: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("readStripeModel stays on stub mode outside production live mode", async () => {
  await withPatchedEnv(
    {
      NODE_ENV: "production",
      STRIPE_MODE: "test",
      STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
      STUDIO_BRAIN_STRIPE_READER_MODE: undefined,
    },
    async () => {
      const model = await readStripeModel();
      assert.equal(model.mode, "stub");
      assert.equal(model.requestedMode, "auto");
      assert.equal(model.unsettledPayments, 0);
      assert.equal(model.warnings?.length, 0);
    },
  );
});

test("readStripeModel blocks production live mode when stub override is not enabled", async () => {
  await withPatchedEnv(
    {
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
      STUDIO_BRAIN_STRIPE_READER_MODE: "auto",
    },
    async () => {
      await assert.rejects(() => readStripeModel(), /stripe reader blocked/);
    },
  );
});

test("readStripeModel blocks explicit stub mode in production live mode without override", async () => {
  await withPatchedEnv(
    {
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STUDIO_BRAIN_STRIPE_READER_MODE: "stub",
      STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
    },
    async () => {
      await assert.rejects(() => readStripeModel(), /stub mode requested in production live mode without override/);
    },
  );
});

test("readStripeModel allows explicit production stub override", async () => {
  await withPatchedEnv(
    {
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STUDIO_BRAIN_STRIPE_READER_MODE: "stub",
      STUDIO_BRAIN_ALLOW_STRIPE_STUB: "true",
    },
    async () => {
      const model = await readStripeModel();
      assert.equal(model.mode, "stub");
      assert.equal(model.requestedMode, "stub");
      assert.equal(model.warnings?.length, 2);
      assert.ok(model.warnings?.[0]?.includes("override enabled"));
    },
  );
});

test("resolveStripeReaderPolicy blocks live_read mode because it is not implemented", () => {
  const policy = resolveStripeReaderPolicy({
    nodeEnv: "production",
    stripeMode: "live",
    readerMode: "live_read",
    allowStubOverride: false,
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.mode, "live_read");
  assert.equal(policy.requestedMode, "live_read");
});

test("resolveStripeReaderPolicy falls back to auto mode when configured mode is invalid", () => {
  const policy = resolveStripeReaderPolicy({
    nodeEnv: "development",
    stripeMode: "test",
    readerMode: "invalid_mode",
    allowStubOverride: false,
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.mode, "stub");
  assert.equal(policy.requestedMode, "auto");
  assert.equal(policy.warnings.some((entry) => entry.includes("invalid stripe reader mode")), true);
});
