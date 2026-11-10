import test from "node:test";
import assert from "node:assert/strict";
import { staffSearchStripeContacts, staffSearchStripeGuests, staffSearchStripeGuestsByName } from "./index";
import type * as SharedModule from "./shared";
import type * as StripeRuntimeModule from "./stripeRuntime";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const shared = require("./shared") as typeof SharedModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const stripeRuntime = require("./stripeRuntime") as typeof StripeRuntimeModule;

function response() {
  return {
    statusCode: 200, body: null as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    set(name: string, value: string) { this.headers[name] = value; return this; },
  };
}

test("Stripe contact endpoints require staff and reject invalid input before accessing Stripe", async () => {
  const originals = { cors: shared.applyCors, auth: shared.requireAuthUid, staff: shared.requireAdmin, config: stripeRuntime.loadStripeConfig };
  let configCalls = 0;
  shared.applyCors = () => false;
  stripeRuntime.loadStripeConfig = async () => { configCalls += 1; throw new Error("Unexpected Stripe access"); };
  const endpoints = [
    { fn: staffSearchStripeContacts, valid: { search: "Alex" }, invalid: { search: "ab" } },
    { fn: staffSearchStripeGuests, valid: { email: "alex@example.com" }, invalid: { email: "bad" } },
    { fn: staffSearchStripeGuestsByName, valid: { search: "Alex" }, invalid: { search: "ab" } },
  ];
  const allowed = { ok: true as const, uid: "staff", decoded: {} as import("firebase-admin/auth").DecodedIdToken };
  try {
    for (const { fn, valid, invalid } of endpoints) {
      shared.requireAuthUid = async () => ({ ok: false, message: "Unauthorized" });
      let res = response();
      await fn({ method: "POST", body: valid, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers["Cache-Control"], "no-store");
      shared.requireAuthUid = async () => allowed;
      shared.requireAdmin = async () => ({ ok: false, message: "Forbidden", code: "FORBIDDEN", httpStatus: 403 });
      res = response();
      await fn({ method: "POST", body: valid, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 403);
      shared.requireAdmin = async () => ({ ok: true, mode: "staff" });
      res = response();
      await fn({ method: "POST", body: invalid, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 400);
      res = response();
      await fn({ method: "GET", body: valid, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 405);
    }
    assert.equal(configCalls, 0);
  } finally {
    shared.applyCors = originals.cors;
    shared.requireAuthUid = originals.auth;
    shared.requireAdmin = originals.staff;
    stripeRuntime.loadStripeConfig = originals.config;
  }
});

test("Stripe contact endpoints return only contact data and pagination; upstream errors stay generic", async () => {
  const originals = { cors: shared.applyCors, auth: shared.requireAuthUid, staff: shared.requireAdmin, config: stripeRuntime.loadStripeConfig, client: stripeRuntime.getStripeClient };
  shared.applyCors = () => false;
  shared.requireAuthUid = async () => ({ ok: true, uid: "staff", decoded: {} as import("firebase-admin/auth").DecodedIdToken });
  shared.requireAdmin = async () => ({ ok: true, mode: "staff" });
  stripeRuntime.loadStripeConfig = async () => ({ mode: "test" } as Awaited<ReturnType<typeof stripeRuntime.loadStripeConfig>>);
  const customer = { id: "cus_1", name: "Alex", email: "alex@example.com", balance: 1234 };
  const session = { id: "cs_test_1", customer: null, customer_details: { name: "Alex Guest", email: "alex@example.com" }, amount_total: 1234 };
  let upstreamFails = false;
  stripeRuntime.getStripeClient = (() => ({
    customers: { search: async () => { if (upstreamFails) throw new Error("private upstream detail"); return { data: [customer], has_more: true, next_page: "page_2" }; } },
    checkout: { sessions: { list: async () => { if (upstreamFails) throw new Error("private upstream detail"); return { data: [session], has_more: true }; } } },
  })) as unknown as typeof stripeRuntime.getStripeClient;
  const endpoints = [
    { fn: staffSearchStripeContacts, body: { search: "Alex" }, expected: { contacts: [{ id: "cus_1", displayName: "Alex", email: "alex@example.com" }], mode: "test", hasMore: true, nextPage: "page_2" } },
    { fn: staffSearchStripeGuests, body: { email: "alex@example.com" }, expected: { contacts: [{ id: "cs_test_1", displayName: "Alex Guest", email: "alex@example.com" }], mode: "test", hasMore: true, nextPage: "cs_test_1" } },
    { fn: staffSearchStripeGuestsByName, body: { search: "Alex" }, expected: { contacts: [{ id: "cs_test_1", displayName: "Alex Guest", email: "alex@example.com" }], mode: "test", hasMore: false, nextPage: null, scanned: 1 } },
  ];
  try {
    for (const { fn, body, expected } of endpoints) {
      // A one-page result avoids inventing a repeated cursor in the bounded name scan.
      if (fn === staffSearchStripeGuestsByName) {
        stripeRuntime.getStripeClient = (() => ({ checkout: { sessions: { list: async () => {
          if (upstreamFails) throw new Error("private upstream detail");
          return { data: [session], has_more: false };
        } } } })) as unknown as typeof stripeRuntime.getStripeClient;
      }
      let res = response();
      await fn({ method: "POST", body, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.deepEqual(res.body, { ok: true, data: expected });
      upstreamFails = true;
      res = response();
      await fn({ method: "POST", body, headers: {} } as never, res as never);
      assert.equal(res.statusCode, 503);
      assert.doesNotMatch(JSON.stringify(res.body), /private upstream detail/);
      upstreamFails = false;
    }
  } finally {
    shared.applyCors = originals.cors;
    shared.requireAuthUid = originals.auth;
    shared.requireAdmin = originals.staff;
    stripeRuntime.loadStripeConfig = originals.config;
    stripeRuntime.getStripeClient = originals.client;
  }
});
