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
      STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "minio-access",
      STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "minio-secret",
      PGPASSWORD: "super-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "C:\\\\tmp\\\\service-account.json",
      STUDIO_BRAIN_ADMIN_TOKEN: "token",
      STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: "root-v1=anchor-secret",
      STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: "false",
      STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: "true",
    },
    () => {
      const env = readEnv();
      const safe = redactEnvForLogs(env);
      assert.equal(safe.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY, "[set]");
      assert.equal(safe.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY, "[set]");
      assert.equal(safe.PGPASSWORD, "[redacted]");
      assert.equal(safe.GOOGLE_APPLICATION_CREDENTIALS, "[set]");
      assert.equal(safe.STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS, "[set]");
    }
  );
});

test("swarm infra defaults parse cleanly", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: "true",
      STUDIO_BRAIN_SKILL_ALLOWLIST: "vision,planner",
      STUDIO_BRAIN_SKILL_DENYLIST: "bad-skill@1.0.0",
      STUDIO_BRAIN_VECTOR_STORE_ENABLED: "1",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED, true);
      assert.deepEqual(env.STUDIO_BRAIN_SKILL_ALLOWLIST, ["vision", "planner"]);
      assert.deepEqual(env.STUDIO_BRAIN_SKILL_DENYLIST, ["bad-skill@1.0.0"]);
      assert.equal(env.STUDIO_BRAIN_VECTOR_STORE_ENABLED, true);
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

test("connectivity validation blocks blank critical endpoints", () => {
  withPatchedEnv(
    {
      PGHOST: "",
      PGDATABASE: "",
      PGUSER: "",
      PGPASSWORD: "",
      REDIS_HOST: "",
      STUDIO_BRAIN_REDIS_STREAM_NAME: "",
      STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: "",
      STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: "",
      STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "",
      STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "",
    },
    () => {
      assert.throws(
        () => readEnv(),
        /PGHOST|PGDATABASE|PGUSER|PGPASSWORD|REDIS_HOST|STUDIO_BRAIN_REDIS_STREAM_NAME|STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT/
      );
    }
  );
});

test("query timeout env accepts bounded numeric values", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: "250",
    },
    () => {
      assert.throws(
        () => readEnv(),
        /STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS/
      );
    }
  );

  withPatchedEnv(
    {
      STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: "500",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS, 500);
    }
  );
});

test("signature policy requires trust anchors", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE: "true",
      STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: "",
    },
    () => {
      assert.throws(() => readEnv(), /STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS/);
    }
  );

  withPatchedEnv(
    {
      STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE: "true",
      STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: "root-v1=anchor-secret",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE, true);
      assert.equal(env.STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS, "root-v1=anchor-secret");
    }
  );
});
