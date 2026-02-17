import test from "node:test";
import assert from "node:assert/strict";
import { readEnv, redactEnvForLogs } from "./env";

function withPatchedEnv(patch: Record<string, string | undefined>, run: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("readEnv validates strict log level enum", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_LOG_LEVEL: "trace",
    },
    () => {
      assert.throws(() => readEnv(), /STUDIO_BRAIN_LOG_LEVEL/);
    }
  );
});

test("redactEnvForLogs masks sensitive fields", () => {
  withPatchedEnv(
    {
      PGPASSWORD: "super-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "C:\\\\tmp\\\\service-account.json",
      STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: "false",
      STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: "true",
    },
    () => {
      const env = readEnv();
      const safe = redactEnvForLogs(env);
      assert.equal(safe.PGPASSWORD, "[redacted]");
      assert.equal(safe.GOOGLE_APPLICATION_CREDENTIALS, "[set]");
    }
  );
});

test("boolean env coercion supports 1/0", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: "1",
      STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: "0",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION, true);
      assert.equal(env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES, false);
    }
  );
});
