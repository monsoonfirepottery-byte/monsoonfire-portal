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
    },
    async () => {
      const model = await readStripeModel();
      assert.equal(model.mode, "stub");
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
    },
    async () => {
      await assert.rejects(() => readStripeModel(), /stub fallback is blocked/);
    },
  );
});

test("readStripeModel allows explicit production stub override", async () => {
  await withPatchedEnv(
    {
      NODE_ENV: "production",
      STRIPE_MODE: "live",
      STUDIO_BRAIN_ALLOW_STRIPE_STUB: "true",
    },
    async () => {
      const model = await readStripeModel();
      assert.equal(model.mode, "stub");
      assert.equal(model.warnings?.length, 2);
      assert.ok(model.warnings?.[0]?.includes("override enabled"));
    },
  );
});

test("resolveStripeReaderPolicy returns live-read policy when production override is disabled", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const policy = resolveStripeReaderPolicy({ stripeMode: "live", allowStubOverride: false });
    assert.equal(policy.allowed, false);
    assert.equal(policy.mode, "live_read");
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});
