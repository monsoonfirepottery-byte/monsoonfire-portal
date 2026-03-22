import assert from "node:assert/strict";
import test from "node:test";

import {
  exchangePortalRulesRefreshToken,
  loadGoogleAuthorizedUserCredentials,
} from "./google-oauth-refresh.mjs";

test("loadGoogleAuthorizedUserCredentials parses authorized_user ADC payloads", async () => {
  const adc = await loadGoogleAuthorizedUserCredentials({
    explicitPath: "ignored.json",
    readFileImpl: async () =>
      JSON.stringify({
        type: "authorized_user",
        client_id: "client-id.apps.googleusercontent.com",
        client_secret: "client-secret",
        refresh_token: "1//adc-refresh-token",
      }),
  });

  assert.deepEqual(adc, {
    configPath: "ignored.json",
    refreshToken: "1//adc-refresh-token",
    clientId: "client-id.apps.googleusercontent.com",
    clientSecret: "client-secret",
    source: "google-application-default-credentials",
  });
});

test("exchangePortalRulesRefreshToken falls back to ADC client metadata when needed", async () => {
  const requests = [];
  const exchanged = await exchangePortalRulesRefreshToken("1//adc-refresh-token", {
    source: "env_refresh_token",
    adcResultSource: "env_refresh_token_adc_client",
    adcCredentials: {
      clientId: "adc-client-id.apps.googleusercontent.com",
      clientSecret: "adc-client-secret",
    },
    fetchImpl: async (_url, init) => {
      requests.push(String(init.body));
      const params = new URLSearchParams(String(init.body));
      const clientId = params.get("client_id");
      if (clientId === "adc-client-id.apps.googleusercontent.com") {
        return new Response(JSON.stringify({ access_token: "adc-access-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(exchanged.accessToken, "adc-access-token");
  assert.equal(exchanged.source, "env_refresh_token_adc_client");
  assert.equal(requests.length, 2);
});
