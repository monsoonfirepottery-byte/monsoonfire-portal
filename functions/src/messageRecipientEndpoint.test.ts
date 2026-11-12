import test from "node:test";
import assert from "node:assert/strict";
import { staffVerifyMessageRecipient } from "./index";
import type * as SharedModule from "./shared";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const shared = require("./shared") as typeof SharedModule;

function response() {
  return {
    statusCode: 200, body: null as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    set(name: string, value: string) { this.headers[name] = value; return this; },
  };
}

test("recipient endpoint authorizes staff and distinguishes lookup outcomes", async () => {
  const original = { cors: shared.applyCors, auth: shared.requireAuthUid, staff: shared.requireAdmin, lookup: shared.adminAuth.getUser };
  let lookups = 0;
  let outcome: "active" | "disabled" | "missing" | "error" = "active";
  shared.applyCors = () => false;
  shared.adminAuth.getUser = (async () => {
    lookups += 1;
    if (outcome === "missing") throw { code: "auth/user-not-found" };
    if (outcome === "error") throw new Error("private upstream detail");
    return { disabled: outcome === "disabled" } as Awaited<ReturnType<typeof shared.adminAuth.getUser>>;
  }) as typeof shared.adminAuth.getUser;
  const invoke = async (method: string, body: unknown) => {
    const res = response();
    await staffVerifyMessageRecipient({ method, body, headers: {} } as never, res as never);
    return res;
  };
  try {
    shared.requireAuthUid = async () => ({ ok: false, message: "Unauthorized" });
    assert.equal((await invoke("POST", { uid: "maker" })).statusCode, 401);
    shared.requireAuthUid = async () => ({ ok: true, uid: "staff", decoded: {} as import("firebase-admin/auth").DecodedIdToken });
    shared.requireAdmin = async () => ({ ok: false, message: "Forbidden", code: "FORBIDDEN", httpStatus: 403 });
    assert.equal((await invoke("POST", { uid: "maker" })).statusCode, 403);
    shared.requireAdmin = async () => ({ ok: true, mode: "staff" });
    assert.equal((await invoke("GET", {})).statusCode, 405);
    assert.equal((await invoke("POST", { uid: "" })).statusCode, 400);
    assert.equal(lookups, 0);
    for (const [mode, expected] of [["active", "active"], ["disabled", "disabled"], ["missing", "not_found"]] as const) {
      outcome = mode;
      const res = await invoke("POST", { uid: "maker" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.deepEqual(res.body, { ok: true, data: { uid: "maker", status: expected } });
    }
    outcome = "error";
    const error = await invoke("POST", { uid: "maker" });
    assert.equal(error.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(error.body), /private upstream detail/);
  } finally {
    shared.applyCors = original.cors;
    shared.requireAuthUid = original.auth;
    shared.requireAdmin = original.staff;
    shared.adminAuth.getUser = original.lookup;
  }
});
