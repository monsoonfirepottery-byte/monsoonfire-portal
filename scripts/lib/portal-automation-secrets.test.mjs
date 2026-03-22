import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOnePasswordLoginCredentials,
  mergePortalAutomationEnv,
  parsePortalAgentStaffPayload,
  validatePortalAgentStaffCredentials,
  validatePortalAutomationEnv,
} from "./portal-automation-secrets.mjs";

test("mergePortalAutomationEnv preserves local-only host paths and rewrites the agent credential path", () => {
  const merged = mergePortalAutomationEnv({
    remoteEnvText: [
      "PORTAL_STAFF_EMAIL=helixwuff@gmail.com",
      "PORTAL_FIREBASE_API_KEY=AIzaSyExamplePortalKey_1234567890",
      "FIREBASE_WEB_API_KEY=AIzaSyExamplePortalKey_1234567890",
      "FIREBASE_RULES_API_TOKEN=1//rules-refresh-token",
    ].join("\n"),
    existingEnvText: [
      "GOOGLE_APPLICATION_CREDENTIALS=C:\\Users\\micah\\secrets\\portal\\firebase-service-account.json",
      "WEBSITE_DEPLOY_KEY=C:\\Users\\micah\\.ssh\\namecheap-portal",
    ].join("\n"),
    portalAgentStaffPath: "C:\\Users\\micah\\secrets\\portal\\portal-agent-staff.json",
  });

  assert.equal(
    merged.envValues.GOOGLE_APPLICATION_CREDENTIALS,
    "C:\\Users\\micah\\secrets\\portal\\firebase-service-account.json"
  );
  assert.equal(merged.envValues.WEBSITE_DEPLOY_KEY, "C:\\Users\\micah\\.ssh\\namecheap-portal");
  assert.equal(
    merged.envValues.PORTAL_AGENT_STAFF_CREDENTIALS,
    "C:\\Users\\micah\\secrets\\portal\\portal-agent-staff.json"
  );
  assert.equal(merged.envValues.PORTAL_STAFF_PASSWORD, undefined);
  assert.deepEqual(merged.preservedKeys.sort(), ["GOOGLE_APPLICATION_CREDENTIALS", "WEBSITE_DEPLOY_KEY"]);
});

test("validatePortalAutomationEnv requires staff email, rules token, and a firebase web key", () => {
  assert.equal(
    validatePortalAutomationEnv({
      PORTAL_STAFF_EMAIL: "staff@example.com",
      FIREBASE_RULES_API_TOKEN: "1//rules-refresh-token",
      FIREBASE_WEB_API_KEY: "AIzaSyExamplePortalKey_1234567890",
    }).ok,
    true
  );

  const invalid = validatePortalAutomationEnv({
    PORTAL_STAFF_EMAIL: "",
    FIREBASE_RULES_API_TOKEN: "",
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.missing, [
    "PORTAL_STAFF_EMAIL",
    "FIREBASE_RULES_API_TOKEN",
    "PORTAL_FIREBASE_API_KEY|FIREBASE_WEB_API_KEY",
  ]);
});

test("parsePortalAgentStaffPayload normalizes refresh token sources", () => {
  const parsed = parsePortalAgentStaffPayload(
    JSON.stringify({
      email: "agent.staff.bot@example.com",
      uid: "staff-uid",
      tokens: { refresh_token: "1//agent-refresh-token" },
    })
  );
  assert.equal(parsed?.email, "agent.staff.bot@example.com");
  assert.equal(parsed?.uid, "staff-uid");
  assert.equal(parsed?.refreshToken, "1//agent-refresh-token");
  assert.equal(validatePortalAgentStaffCredentials(parsed).ok, true);
});

test("extractOnePasswordLoginCredentials reads username and password fields", () => {
  const creds = extractOnePasswordLoginCredentials({
    fields: [
      { purpose: "USERNAME", value: "helixwuff@gmail.com" },
      { purpose: "PASSWORD", value: "nP$6mdKUUjssd8vB" },
    ],
  });

  assert.deepEqual(creds, {
    email: "helixwuff@gmail.com",
    password: "nP$6mdKUUjssd8vB",
  });
});
