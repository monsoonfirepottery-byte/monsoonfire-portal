import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolvePortalAgentStaffCredentials } from "./firebase-auth-token.mjs";

test("resolvePortalAgentStaffCredentials normalizes inline credential JSON", () => {
  const parsed = resolvePortalAgentStaffCredentials({
    env: {},
    credentialsJson: JSON.stringify({
      email: "agent.staff.bot@example.com",
      uid: "staff-uid",
      tokens: { refresh_token: "1//agent-refresh-token" },
      staffPassword: "fallback-password",
    }),
  });

  assert.equal(parsed?.email, "agent.staff.bot@example.com");
  assert.equal(parsed?.uid, "staff-uid");
  assert.equal(parsed?.refreshToken, "1//agent-refresh-token");
  assert.equal(parsed?.password, "fallback-password");
});

test("resolvePortalAgentStaffCredentials normalizes file-backed credential JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "firebase-auth-token-"));
  const filePath = join(dir, "portal-agent-staff.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      staffEmail: "agent.staff.bot@example.com",
      uid: "staff-uid",
      refreshToken: "1//agent-refresh-token",
    }),
    "utf8"
  );

  try {
    const parsed = resolvePortalAgentStaffCredentials({
      env: {},
      credentialsPath: filePath,
    });

    assert.equal(parsed?.email, "agent.staff.bot@example.com");
    assert.equal(parsed?.uid, "staff-uid");
    assert.equal(parsed?.refreshToken, "1//agent-refresh-token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
