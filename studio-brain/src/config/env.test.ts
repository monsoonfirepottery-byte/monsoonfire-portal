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
      STUDIO_BRAIN_OPENAI_API_KEY: "sk-local",
      STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: "ingest-secret",
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
      assert.equal(safe.STUDIO_BRAIN_OPENAI_API_KEY, "[set]");
      assert.equal(safe.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET, "[set]");
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

test("openai embedding provider allows missing API key for null-adapter fallback", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_EMBEDDING_PROVIDER: "openai",
      STUDIO_BRAIN_OPENAI_API_KEY: "",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_EMBEDDING_PROVIDER, "openai");
      assert.equal(env.STUDIO_BRAIN_OPENAI_API_KEY, "");
    }
  );

  withPatchedEnv(
    {
      STUDIO_BRAIN_EMBEDDING_PROVIDER: "openai",
      STUDIO_BRAIN_OPENAI_API_KEY: "sk-test",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_EMBEDDING_PROVIDER, "openai");
      assert.equal(env.STUDIO_BRAIN_OPENAI_API_KEY, "sk-test");
    }
  );
});

test("vertex embedding provider requires project id", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_EMBEDDING_PROVIDER: "vertex",
      STUDIO_BRAIN_VERTEX_PROJECT_ID: "",
      FIREBASE_PROJECT_ID: "",
    },
    () => {
      assert.throws(() => readEnv(), /STUDIO_BRAIN_VERTEX_PROJECT_ID|FIREBASE_PROJECT_ID/);
    }
  );

  withPatchedEnv(
    {
      STUDIO_BRAIN_EMBEDDING_PROVIDER: "vertex",
      STUDIO_BRAIN_VERTEX_PROJECT_ID: "monsoonfire-portal",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_EMBEDDING_PROVIDER, "vertex");
      assert.equal(env.STUDIO_BRAIN_VERTEX_PROJECT_ID, "monsoonfire-portal");
    }
  );
});

test("memory ingest requires hmac secret when enabled", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_MEMORY_INGEST_ENABLED: "true",
      STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: "",
    },
    () => {
      assert.throws(() => readEnv(), /STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET/);
    }
  );

  withPatchedEnv(
    {
      STUDIO_BRAIN_MEMORY_INGEST_ENABLED: "true",
      STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: "memory-ingest-secret",
      STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES: "discord,bot",
      STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS: "guild-1,guild-2",
      STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS: "chan-1,chan-2",
    },
    () => {
      const env = readEnv();
      assert.equal(env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED, true);
      assert.equal(env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET, "memory-ingest-secret");
      assert.deepEqual(env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES, ["discord", "bot"]);
      assert.deepEqual(env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS, ["guild-1", "guild-2"]);
      assert.deepEqual(env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS, ["chan-1", "chan-2"]);
    }
  );
});
