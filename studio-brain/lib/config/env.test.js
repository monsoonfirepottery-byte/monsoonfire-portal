"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const env_1 = require("./env");
function withPatchedEnv(patch, run) {
    const original = {};
    for (const [key, value] of Object.entries(patch)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        run();
    }
    finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
(0, node_test_1.default)("readEnv validates strict log level enum", () => {
    withPatchedEnv({
        STUDIO_BRAIN_LOG_LEVEL: "trace",
    }, () => {
        strict_1.default.throws(() => (0, env_1.readEnv)(), /STUDIO_BRAIN_LOG_LEVEL/);
    });
});
(0, node_test_1.default)("redactEnvForLogs masks sensitive fields", () => {
    withPatchedEnv({
        STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "minio-access",
        STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "minio-secret",
        PGPASSWORD: "super-secret",
        GOOGLE_APPLICATION_CREDENTIALS: "C:\\\\tmp\\\\service-account.json",
        STUDIO_BRAIN_ADMIN_TOKEN: "token",
        STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: "false",
        STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: "true",
    }, () => {
        const env = (0, env_1.readEnv)();
        const safe = (0, env_1.redactEnvForLogs)(env);
        strict_1.default.equal(safe.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY, "[set]");
        strict_1.default.equal(safe.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY, "[set]");
        strict_1.default.equal(safe.PGPASSWORD, "[redacted]");
        strict_1.default.equal(safe.GOOGLE_APPLICATION_CREDENTIALS, "[set]");
    });
});
(0, node_test_1.default)("swarm infra defaults parse cleanly", () => {
    withPatchedEnv({
        STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: "true",
        STUDIO_BRAIN_SKILL_ALLOWLIST: "vision,planner",
        STUDIO_BRAIN_SKILL_DENYLIST: "bad-skill@1.0.0",
        STUDIO_BRAIN_VECTOR_STORE_ENABLED: "1",
    }, () => {
        const env = (0, env_1.readEnv)();
        strict_1.default.equal(env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED, true);
        strict_1.default.deepEqual(env.STUDIO_BRAIN_SKILL_ALLOWLIST, ["vision", "planner"]);
        strict_1.default.deepEqual(env.STUDIO_BRAIN_SKILL_DENYLIST, ["bad-skill@1.0.0"]);
        strict_1.default.equal(env.STUDIO_BRAIN_VECTOR_STORE_ENABLED, true);
    });
});
(0, node_test_1.default)("boolean env coercion supports 1/0", () => {
    withPatchedEnv({
        STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: "1",
        STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: "0",
    }, () => {
        const env = (0, env_1.readEnv)();
        strict_1.default.equal(env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION, true);
        strict_1.default.equal(env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES, false);
    });
});
(0, node_test_1.default)("connectivity validation blocks blank critical endpoints", () => {
    withPatchedEnv({
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
    }, () => {
        strict_1.default.throws(() => (0, env_1.readEnv)(), /PGHOST|PGDATABASE|PGUSER|PGPASSWORD|REDIS_HOST|STUDIO_BRAIN_REDIS_STREAM_NAME|STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT/);
    });
});
(0, node_test_1.default)("query timeout env accepts bounded numeric values", () => {
    withPatchedEnv({
        STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: "250",
    }, () => {
        strict_1.default.throws(() => (0, env_1.readEnv)(), /STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS/);
    });
    withPatchedEnv({
        STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: "500",
    }, () => {
        const env = (0, env_1.readEnv)();
        strict_1.default.equal(env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS, 500);
    });
});
