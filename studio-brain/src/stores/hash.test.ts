import test from "node:test";
import assert from "node:assert/strict";
import { stableHashDeep } from "./hash";

test("stableHashDeep is order-insensitive for object keys", () => {
  const a = { z: 1, a: { b: 2, c: [3, 4] } };
  const b = { a: { c: [3, 4], b: 2 }, z: 1 };

  assert.equal(stableHashDeep(a), stableHashDeep(b));
});
