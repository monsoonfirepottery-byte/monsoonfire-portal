import test from "node:test";
import assert from "node:assert/strict";
import { installRefreshTokenSignInRoute } from "./portal-authenticated-canary.mjs";

for (const [name, key, email, expected, origin = "https://identitytoolkit.googleapis.com", method = "POST"] of [
  ["configured key and intended staff account", "test-key", "staff@example.test", "fulfilled"],
  ["unrelated API key", "unrelated-key", "staff@example.test", "continued"],
  ["another account", "test-key", "other@example.test", "continued"],
  ["missing account", "test-key", "", "continued"],
  ["another host", "test-key", "staff@example.test", "continued", "https://example.test"],
  ["a GET request", "test-key", "staff@example.test", "continued", undefined, "GET"],
]) {
  test(`auth bootstrap handles ${name}`, async () => {
    let handler;
    let outcome;
    const page = {
      route: async (_pattern, callback) => { handler = callback; },
      unroute: async () => {},
    };
    const installed = await installRefreshTokenSignInRoute(page, {
      apiKey: "test-key", email: "staff@example.test", uid: "test-staff",
      idToken: "test-token", refreshToken: "test-refresh",
    });
    await handler({
      continue: async () => { outcome = "continued"; },
      fulfill: async (response) => {
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.body).localId, "test-staff");
        outcome = "fulfilled";
      },
    }, {
      url: () => `${origin}/v1/accounts:signInWithPassword?key=${key}`,
      method: () => method,
      postData: () => JSON.stringify({ email }),
    });
    assert.equal(outcome, expected);
    assert.equal(installed.wasHandled(), expected === "fulfilled");
    await installed.remove();
  });
}
