import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scanStripeGuestNames, stripeContactQuery, stripeContactRows, stripeGuestEmail, stripeGuestNameQuery, stripeGuestRows } from "./stripeContactSearch";

test("search uses bounded escaped-by-rejection clauses", () => {
  assert.equal(stripeContactQuery(" Alex "), "name~\"Alex\" OR email~\"Alex\"");
  for (const invalid of ["ab", "x\" OR name~\"abc", "bad\\name", "abc\nxyz"]) {
    assert.throws(() => stripeContactQuery(invalid));
  }
  assert.match(stripeContactQuery("O'Connor"), /O'Connor/);
});

test("guest lookup accepts only one safe complete email", () => {
  assert.equal(stripeGuestEmail(" person@example.com "), "person@example.com");
  for (const invalid of ["a@example.com,b@example.com", "person@example.com?bcc=x", "person@example.com\r\nBcc:x", "bad..name@example.com", "partial"]) {
    assert.equal(stripeGuestEmail(invalid), null);
  }
});

test("guest results exclude customer-linked, mismatched, and missing email sessions", () => {
  assert.deepEqual(stripeGuestRows([
    { id: "cs_test_1", customer: null, customer_details: { email: "Person@Example.com", name: " Maker " } },
    { id: "cs_test_2", customer: "cus_1", customer_details: { email: "person@example.com", name: "Existing" } },
    { id: "cs_test_3", customer: null, customer_details: { email: "different@example.com" } },
    { id: "cs_test_4", customer: null, customer_details: null },
  ], "person@example.com"), [{ id: "cs_test_1", displayName: "Maker", email: "Person@Example.com" }]);
});

test("guest name scan is bounded, preserves cursor through unmatched pages, and exposes only contact fields", async () => {
  const seen: Array<string | undefined> = [];
  const result = await scanStripeGuestNames(async (after) => {
    seen.push(after);
    const page = seen.length;
    return {
      data: [{ id: `cs_test_${page}`, customer: null, customer_details: { name: page === 2 ? "  María Maker  " : "Other", email: "maker@example.com" } }],
      has_more: true,
    };
  }, "MARÍA");
  assert.deepEqual(seen, [undefined, "cs_test_1", "cs_test_2"]);
  assert.deepEqual(result, { contacts: [{ id: "cs_test_2", displayName: "María Maker", email: "maker@example.com" }], scanned: 3, hasMore: true, nextPage: "cs_test_3" });
});

test("guest name scan stops at end and excludes customer-linked sessions", async () => {
  const result = await scanStripeGuestNames(async () => ({
    data: [
      { id: "cs_test_1", customer: "cus_1", customer_details: { name: "Alex", email: "alex@example.com" } },
      { id: "cs_test_2", customer: null, customer_details: { name: "Alex Guest", email: null } },
    ], has_more: false,
  }), "alex");
  assert.deepEqual(result, { contacts: [{ id: "cs_test_2", displayName: "Alex Guest", email: "" }], scanned: 2, hasMore: false, nextPage: null });
  for (const invalid of ["ab", "a\nbc"]) assert.equal(stripeGuestNameQuery(invalid), null);
  await assert.rejects(scanStripeGuestNames(async () => ({ data: [], has_more: true }), "alex"));
});

test("returns only contact fields, including customers without usable email", () => {
  assert.deepEqual(stripeContactRows([
    { id: "cus_1", name: " Alex ", email: " alex@example.com " },
    { id: "cus_2", name: "No email", email: null },
    { id: "cus_3", name: null, email: "evil@example.com\r\nBcc:x" },
  ]), [
    { id: "cus_1", displayName: "Alex", email: "alex@example.com" },
    { id: "cus_2", displayName: "No email", email: "" },
    { id: "cus_3", displayName: "Unnamed contact", email: "" },
  ]);
});
