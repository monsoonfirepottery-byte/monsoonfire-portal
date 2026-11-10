import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripeContactQuery, stripeContactRows } from "./stripeContactSearch";

test("search uses bounded escaped-by-rejection clauses", () => {
  assert.equal(stripeContactQuery(" Alex "), 'name~"Alex" OR email~"Alex"');
  for (const invalid of ["ab", 'x" OR name~"abc', "bad\\name", "abc\nxyz"]) {
    assert.throws(() => stripeContactQuery(invalid));
  }
  assert.match(stripeContactQuery("O'Connor"), /O'Connor/);
});

test("returns only contact fields for customers with email", () => {
  assert.deepEqual(stripeContactRows([
    { id: "cus_1", name: " Alex ", email: " alex@example.com " },
    { id: "cus_2", name: "No email", email: null },
    { id: "cus_3", name: null, email: "evil@example.com\r\nBcc:x" },
  ]), [{ id: "cus_1", displayName: "Alex", email: "alex@example.com" }]);
});
