import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin } from "../../shared";

test("requireAdmin allows staff decoded tokens", async () => {
  const req: { headers: Record<string, unknown>; __mfAuth: { uid: string; staff: boolean; roles: string[] } } = {
    headers: {},
    __mfAuth: { uid: "staff-1", staff: true, roles: ["staff"] },
  };
  const result = await requireAdmin(req);
  assert.equal(result.ok, true);
});

test("requireAdmin allows dev admin token in emulator when configured", async () => {
  const original = {
    ALLOW_DEV_ADMIN_TOKEN: process.env.ALLOW_DEV_ADMIN_TOKEN,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  };
  process.env.ALLOW_DEV_ADMIN_TOKEN = "true";
  process.env.FUNCTIONS_EMULATOR = "true";
  process.env.ADMIN_TOKEN = "dev-secret";
  const req: { headers: Record<string, unknown>; __mfAuth: { uid: string; staff: boolean; roles: string[] } } = {
    headers: { "x-admin-token": "dev-secret" },
    __mfAuth: { uid: "user-1", staff: false, roles: [] },
  };
  const result = await requireAdmin(req);
  assert.equal(result.ok, true);
  process.env.ALLOW_DEV_ADMIN_TOKEN = original.ALLOW_DEV_ADMIN_TOKEN;
  process.env.FUNCTIONS_EMULATOR = original.FUNCTIONS_EMULATOR;
  process.env.ADMIN_TOKEN = original.ADMIN_TOKEN;
});

test("requireAdmin denies when decoded token is missing", async () => {
  const req: { headers: Record<string, unknown> } = { headers: {} };
  const result = await requireAdmin(req);
  assert.equal(result.ok, false);
});
