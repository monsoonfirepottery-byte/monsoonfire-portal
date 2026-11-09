import { strict as assert } from "node:assert";
import { test } from "node:test";
import { verifyMessageRecipient } from "./messageRecipientVerification";

test("recipient lookup distinguishes active, disabled, missing, and unavailable", async () => {
  assert.equal(await verifyMessageRecipient("a", async () => ({ disabled: false })), "active");
  assert.equal(await verifyMessageRecipient("a", async () => ({ disabled: true })), "disabled");
  assert.equal(await verifyMessageRecipient("a", async () => { throw { code: "auth/user-not-found" }; }), "not_found");
  await assert.rejects(verifyMessageRecipient("a", async () => { throw new Error("service unavailable"); }), /service unavailable/);
});
