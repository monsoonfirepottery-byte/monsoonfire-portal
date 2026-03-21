import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaimsForPortalRole,
  isAdminFromDecoded,
  isStaffFromDecoded,
  requireAdmin,
  requireAdminRole,
} from "../../shared";

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

test("buildClaimsForPortalRole preserves unrelated claims when promoting to admin", () => {
  const claims = buildClaimsForPortalRole(
    {
      betaAccess: true,
      roles: ["member-support", "staff"],
    },
    "admin"
  );

  assert.deepEqual(claims, {
    betaAccess: true,
    staff: true,
    admin: true,
    roles: ["member-support", "staff", "admin"],
  });
});

test("buildClaimsForPortalRole removes portal authority when demoting to member", () => {
  const claims = buildClaimsForPortalRole(
    {
      admin: true,
      staff: true,
      roles: ["admin", "staff", "betaAccess"],
      studio: "phoenix",
    },
    "member"
  );

  assert.deepEqual(claims, {
    roles: ["betaAccess"],
    studio: "phoenix",
  });
});

test("isAdminFromDecoded recognizes admin roles while isStaffFromDecoded keeps admin staff access", () => {
  const decoded = {
    uid: "admin-1",
    roles: ["staff", "admin"],
  };

  assert.equal(isAdminFromDecoded(decoded), true);
  assert.equal(isStaffFromDecoded(decoded), true);
});

test("requireAdminRole allows admin decoded tokens", async () => {
  const req: { headers: Record<string, unknown>; __mfAuth: { uid: string; admin: boolean; roles: string[] } } = {
    headers: {},
    __mfAuth: { uid: "admin-1", admin: true, roles: ["staff", "admin"] },
  };

  const result = await requireAdminRole(req);
  assert.deepEqual(result, { ok: true, mode: "admin" });
});

test("requireAdminRole denies staff-only decoded tokens", async () => {
  const req: { headers: Record<string, unknown>; __mfAuth: { uid: string; staff: boolean; roles: string[] } } = {
    headers: {},
    __mfAuth: { uid: "staff-1", staff: true, roles: ["staff"] },
  };

  const result = await requireAdminRole(req);
  assert.equal(result.ok, false);
});

test("requireAdminRole allows dev admin token in emulator when configured", async () => {
  const original = {
    ALLOW_DEV_ADMIN_TOKEN: process.env.ALLOW_DEV_ADMIN_TOKEN,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  };

  process.env.ALLOW_DEV_ADMIN_TOKEN = "true";
  process.env.FUNCTIONS_EMULATOR = "true";
  process.env.ADMIN_TOKEN = "dev-secret";

  try {
    const req: { headers: Record<string, unknown>; __mfAuth: { uid: string; staff: boolean; roles: string[] } } = {
      headers: { "x-admin-token": "dev-secret" },
      __mfAuth: { uid: "user-1", staff: false, roles: [] },
    };
    const result = await requireAdminRole(req);
    assert.deepEqual(result, { ok: true, mode: "dev" });
  } finally {
    process.env.ALLOW_DEV_ADMIN_TOKEN = original.ALLOW_DEV_ADMIN_TOKEN;
    process.env.FUNCTIONS_EMULATOR = original.FUNCTIONS_EMULATOR;
    process.env.ADMIN_TOKEN = original.ADMIN_TOKEN;
  }
});
