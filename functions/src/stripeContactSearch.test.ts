import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripeContactQuery, stripeContactRows, stripeGuestEmail, stripeGuestRows } from "./stripeContactSearch";

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
