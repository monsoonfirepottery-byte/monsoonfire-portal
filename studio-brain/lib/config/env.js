"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEnv = readEnv;
exports.redactEnvForLogs = redactEnvForLogs;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const PLACEHOLDER_MATCHERS = [
    /change-?me/i,
    /todo/i,
    /placeholder/i,
    /replace[_-]?with/i,
    /^\s*<.*>\s*$/,
    /\$\{[^}]+\}/,
];
const RUNTIME_ENFORCED_SENSITIVE_VARS = new Set([
    "STUDIO_BRAIN_ADMIN_TOKEN",
    "STUDIO_BRAIN_OPENAI_API_KEY",
    "STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET",
    "STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY",
    "STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY",
    "STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS",
    "PGPASSWORD",
    "REDIS_PASSWORD",
]);
const BoolFromString = zod_1.z
    .union([zod_1.z.enum(["true", "false", "1", "0"]), zod_1.z.boolean()])
    .transform((value) => value === true || value === "true" || value === "1");
const requiredString = (field) => zod_1.z
    .string()
    .trim()
    .min(1, { message: `${field} must not be empty` });
const CsvFromString = zod_1.z
    .string()
    .transform((value) => value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean))
    .pipe(zod_1.z.array(zod_1.z.string()));
const EnvSchema = zod_1.z.object({
    STUDIO_BRAIN_PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(8787),
    STUDIO_BRAIN_HOST: requiredString("STUDIO_BRAIN_HOST").default("127.0.0.1"),
    STUDIO_BRAIN_NETWORK_PROFILE: zod_1.z.enum(["local", "lan-static", "lan-dhcp", "ci"]).default("local"),
    STUDIO_BRAIN_LOCAL_HOST: requiredString("STUDIO_BRAIN_LOCAL_HOST").default("127.0.0.1"),
    STUDIO_BRAIN_LAN_HOST: requiredString("STUDIO_BRAIN_LAN_HOST").default("studiobrain.local"),
    STUDIO_BRAIN_DHCP_HOST: zod_1.z.string().default(""),
    STUDIO_BRAIN_STATIC_IP: zod_1.z.string().default(""),
    STUDIO_BRAIN_ALLOWED_HOSTS: zod_1.z.string().default(""),
    STUDIO_BRAIN_HOST_STATE_FILE: requiredString("STUDIO_BRAIN_HOST_STATE_FILE").default(".studiobrain-host-state.json"),
    STUDIO_BRAIN_LOG_LEVEL: zod_1.z.enum(["debug", "info", "warn", "error"]).default("info"),
    STUDIO_BRAIN_ALLOWED_ORIGINS: zod_1.z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
    STUDIO_BRAIN_ADMIN_TOKEN: zod_1.z.string().optional(),
    STUDIO_BRAIN_JOB_INTERVAL_MS: zod_1.z.coerce.number().int().min(10_000).max(86_400_000).default(15 * 60 * 1000),
    STUDIO_BRAIN_JOB_INITIAL_DELAY_MS: zod_1.z.coerce.number().int().min(0).max(300_000).default(0),
    STUDIO_BRAIN_JOB_JITTER_MS: zod_1.z.coerce.number().int().min(0).max(120_000).default(0),
    STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE: BoolFromString.default(true),
    STUDIO_BRAIN_SCAN_LIMIT: zod_1.z.coerce.number().int().min(50).max(20_000).default(2_000),
    STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(20_000),
    STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD: zod_1.z.coerce.number().int().min(1).max(10_000).default(25),
    STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD: zod_1.z.coerce.number().min(0.01).max(10).default(0.5),
    STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY: BoolFromString.default(false),
    STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES: zod_1.z.coerce.number().int().min(5).max(10_080).default(240),
    STUDIO_BRAIN_ENABLE_RETENTION_PRUNE: BoolFromString.default(false),
    STUDIO_BRAIN_RETENTION_DAYS: zod_1.z.coerce.number().int().min(7).max(3650).default(180),
    PGHOST: requiredString("PGHOST").default("127.0.0.1"),
    PGPORT: zod_1.z.coerce.number().int().min(1).max(65535).default(5433),
    PGDATABASE: requiredString("PGDATABASE").default("monsoonfire_studio_os"),
    PGUSER: requiredString("PGUSER").default("postgres"),
    PGPASSWORD: requiredString("PGPASSWORD").default("postgres"),
    PGSSLMODE: zod_1.z.enum(["disable", "prefer", "require"]).default("disable"),
    STUDIO_BRAIN_PG_POOL_MAX: zod_1.z.coerce.number().int().min(1).max(50).default(10),
    STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(5_000),
    STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(300_000).default(18_000),
    STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS: zod_1.z.coerce.number().int().min(100).max(120_000).default(4_000),
    STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(600_000).default(15_000),
    STUDIO_BRAIN_PG_APPLICATION_NAME: zod_1.z.string().default("studiobrain"),
    REDIS_HOST: requiredString("REDIS_HOST").default("127.0.0.1"),
    REDIS_PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_USERNAME: zod_1.z.string().optional(),
    REDIS_PASSWORD: zod_1.z.string().optional(),
    REDIS_CONNECT_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(5_000),
    REDIS_COMMAND_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(5_000),
    STUDIO_BRAIN_REDIS_STREAM_NAME: requiredString("STUDIO_BRAIN_REDIS_STREAM_NAME").default("studiobrain.events"),
    STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS: zod_1.z.coerce.number().int().min(100).max(10_000).default(750),
    STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE: zod_1.z.coerce.number().int().min(1).max(500).default(32),
    STUDIO_BRAIN_EVENT_BUS_START_ID: zod_1.z.string().default("$"),
    STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT").default("http://127.0.0.1:9010"),
    STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_BUCKET").default("studiobrain-artifacts"),
    STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY").default("minioadmin"),
    STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY").default("minioadmin"),
    STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL: BoolFromString.default(false),
    STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(5_000),
    STUDIO_BRAIN_VECTOR_STORE_ENABLED: BoolFromString.default(true),
    STUDIO_BRAIN_VECTOR_STORE_TABLE: zod_1.z.string().default("swarm_memory"),
    STUDIO_BRAIN_EMBEDDING_PROVIDER: zod_1.z.enum(["none", "openai", "vertex"]).default("openai"),
    STUDIO_BRAIN_EMBEDDING_DIMENSIONS: zod_1.z.coerce.number().int().min(128).max(4096).default(1536),
    STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(120_000).default(15_000),
    STUDIO_BRAIN_OPENAI_API_KEY: zod_1.z.string().optional(),
    STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL: zod_1.z.string().default("text-embedding-3-small"),
    STUDIO_BRAIN_VERTEX_PROJECT_ID: zod_1.z.string().optional(),
    STUDIO_BRAIN_VERTEX_LOCATION: zod_1.z.string().default("us-central1"),
    STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL: zod_1.z.string().default("text-embedding-005"),
    STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: BoolFromString.default(false),
    STUDIO_BRAIN_SWARM_ID: zod_1.z.string().default("default-swarm"),
    STUDIO_BRAIN_SWARM_RUN_ID: zod_1.z.string().default(""),
    STUDIO_BRAIN_SWARM_EVENT_POLL_MS: zod_1.z.coerce.number().int().min(100).max(10_000).default(1_000),
    STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH: zod_1.z.string().default("./skills-registry"),
    STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL: zod_1.z.string().optional(),
    STUDIO_BRAIN_SKILL_INSTALL_ROOT: requiredString("STUDIO_BRAIN_SKILL_INSTALL_ROOT").default("/var/lib/studiobrain/skills"),
    STUDIO_BRAIN_SKILL_REQUIRE_PINNING: BoolFromString.default(true),
    STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM: BoolFromString.default(true),
    STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE: BoolFromString.default(false),
    STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: zod_1.z.string().default(""),
    STUDIO_BRAIN_SKILL_ALLOWLIST: CsvFromString.default(() => []),
    STUDIO_BRAIN_SKILL_DENYLIST: CsvFromString.default(() => []),
    STUDIO_BRAIN_SKILL_SANDBOX_ENABLED: BoolFromString.default(true),
    STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY: BoolFromString.default(true),
    STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST: CsvFromString.default(() => []),
    STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS: zod_1.z.coerce.number().int().min(250).max(120_000).default(15_000),
    STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST: CsvFromString.default(() => []),
    STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: BoolFromString.default(false),
    STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: BoolFromString.default(true),
    STUDIO_BRAIN_FUNCTIONS_BASE_URL: zod_1.z.string().default("https://us-central1-monsoonfire-portal.cloudfunctions.net"),
    STUDIO_BRAIN_DEFAULT_TENANT_ID: zod_1.z.string().default("monsoonfire-main"),
    STUDIO_BRAIN_ALLOWED_TENANT_IDS: zod_1.z.string().default("monsoonfire-main"),
    STUDIO_BRAIN_MEMORY_INGEST_ENABLED: BoolFromString.default(false),
    STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: zod_1.z.string().optional(),
    STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS: zod_1.z.coerce.number().int().min(30).max(3600).default(300),
    STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID: BoolFromString.default(true),
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES: CsvFromString.default(() => []),
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS: CsvFromString.default(() => []),
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS: CsvFromString.default(() => []),
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL: zod_1.z.coerce.number().int().min(0).max(10_000).default(8),
    STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS: zod_1.z.coerce.number().int().min(1).max(100).default(1),
    STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS: zod_1.z.coerce.number().int().min(1).max(3600).default(20),
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: zod_1.z.coerce.number().int().min(0).max(10_000).default(4),
    STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: zod_1.z.coerce.number().int().min(0).max(10_000).default(14),
    STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: zod_1.z.coerce.number().int().min(1).max(2_000).default(20),
    STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: zod_1.z.coerce.number().int().min(1).max(2_000).default(12),
    STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: zod_1.z.coerce.number().int().min(1).max(4_000).default(28),
    STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS: zod_1.z.coerce.number().int().min(1).max(3600).default(5),
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP: zod_1.z.coerce.number().int().min(1).max(100).default(10),
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP: zod_1.z.coerce.number().int().min(10).max(500).default(120),
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP: zod_1.z.coerce.number().int().min(1).max(100).default(10),
    STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP: zod_1.z.coerce.number().int().min(512).max(100_000).default(6_000),
    STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(120_000).default(16_000),
    STUDIO_BRAIN_OTEL_ENABLED: BoolFromString.default(false),
    STUDIO_BRAIN_OTEL_ENDPOINT: zod_1.z.string().optional(),
    STUDIO_BRAIN_OTEL_SERVICE_NAME: zod_1.z.string().default("studiobrain"),
    FIREBASE_PROJECT_ID: zod_1.z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: zod_1.z.string().optional(),
    STRIPE_MODE: zod_1.z.enum(["test", "live"]).default("test"),
    STUDIO_BRAIN_STRIPE_READ_ONLY: BoolFromString.default(true),
    STUDIO_BRAIN_STRIPE_READER_MODE: zod_1.z.enum(["auto", "stub", "live_read"]).default("auto"),
});
function hasPlaceholderValue(value) {
    return PLACEHOLDER_MATCHERS.some((pattern) => pattern.test(value));
}
function validateConnectivityConfig(env) {
    const errors = [];
    const assertUrl = (value, variableName) => {
        if (!value)
            return;
        try {
            new URL(value);
        }
        catch {
            errors.push(`${variableName} must be a valid URL`);
        }
    };
    if (env.STUDIO_BRAIN_VECTOR_STORE_ENABLED && !env.STUDIO_BRAIN_VECTOR_STORE_TABLE.trim()) {
        errors.push("STUDIO_BRAIN_VECTOR_STORE_TABLE is required when vector store is enabled");
    }
    if (env.STUDIO_BRAIN_EMBEDDING_PROVIDER === "vertex") {
        const projectId = env.STUDIO_BRAIN_VERTEX_PROJECT_ID || env.FIREBASE_PROJECT_ID;
        if (!projectId || projectId.trim().length === 0) {
            errors.push("STUDIO_BRAIN_VERTEX_PROJECT_ID or FIREBASE_PROJECT_ID is required when STUDIO_BRAIN_EMBEDDING_PROVIDER=vertex");
        }
    }
    if (env.STUDIO_BRAIN_SKILL_INSTALL_ROOT.trim().length === 0) {
        errors.push("STUDIO_BRAIN_SKILL_INSTALL_ROOT must not be empty");
    }
    if (env.STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE &&
        env.STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS.trim().length === 0) {
        errors.push("STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS is required when STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE=true");
    }
    assertUrl(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT");
    if (env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL) {
        assertUrl(env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL, "STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL");
    }
    if (env.STUDIO_BRAIN_OTEL_ENABLED) {
        if (!env.STUDIO_BRAIN_OTEL_ENDPOINT) {
            errors.push("STUDIO_BRAIN_OTEL_ENDPOINT is required when STUDIO_BRAIN_OTEL_ENABLED=true");
        }
        else {
            assertUrl(env.STUDIO_BRAIN_OTEL_ENDPOINT, "STUDIO_BRAIN_OTEL_ENDPOINT");
        }
    }
    if (env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED) {
        if (!env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET || env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET.trim().length === 0) {
            errors.push("STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET is required when STUDIO_BRAIN_MEMORY_INGEST_ENABLED=true");
        }
    }
    return errors;
}
function validateRuntimeSecretValues(env) {
    const issues = [];
    for (const [rawName, rawValue] of Object.entries(env)) {
        const name = rawName;
        if (!RUNTIME_ENFORCED_SENSITIVE_VARS.has(name))
            continue;
        if (typeof rawValue !== "string")
            continue;
        if (!hasPlaceholderValue(rawValue))
            continue;
        issues.push(`${name} is configured with a placeholder value; set a concrete secret before runtime startup.`);
    }
    return issues;
}
function readEnv() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid studio-brain env: ${message}`);
    }
    const env = parsed.data;
    const connectivityIssues = validateConnectivityConfig(env);
    if (connectivityIssues.length > 0) {
        throw new Error(`Invalid studio-brain env connectivity: ${connectivityIssues.join("; ")}`);
    }
    const runtimeSecretIssues = validateRuntimeSecretValues(env);
    if (runtimeSecretIssues.length > 0) {
        throw new Error(`Invalid studio-brain env values: ${runtimeSecretIssues.join("; ")}`);
    }
    return env;
}
function redactEnvForLogs(env) {
    return {
        STUDIO_BRAIN_HOST: env.STUDIO_BRAIN_HOST,
        STUDIO_BRAIN_PORT: env.STUDIO_BRAIN_PORT,
        STUDIO_BRAIN_NETWORK_PROFILE: env.STUDIO_BRAIN_NETWORK_PROFILE,
        STUDIO_BRAIN_LOCAL_HOST: env.STUDIO_BRAIN_LOCAL_HOST,
        STUDIO_BRAIN_LAN_HOST: env.STUDIO_BRAIN_LAN_HOST,
        STUDIO_BRAIN_DHCP_HOST: env.STUDIO_BRAIN_DHCP_HOST || null,
        STUDIO_BRAIN_STATIC_IP: env.STUDIO_BRAIN_STATIC_IP || null,
        STUDIO_BRAIN_ALLOWED_HOSTS: env.STUDIO_BRAIN_ALLOWED_HOSTS || null,
        STUDIO_BRAIN_HOST_STATE_FILE: env.STUDIO_BRAIN_HOST_STATE_FILE,
        STUDIO_BRAIN_LOG_LEVEL: env.STUDIO_BRAIN_LOG_LEVEL,
        STUDIO_BRAIN_ALLOWED_ORIGINS: env.STUDIO_BRAIN_ALLOWED_ORIGINS,
        STUDIO_BRAIN_ADMIN_TOKEN: env.STUDIO_BRAIN_ADMIN_TOKEN ? "[set]" : null,
        STUDIO_BRAIN_JOB_INTERVAL_MS: env.STUDIO_BRAIN_JOB_INTERVAL_MS,
        STUDIO_BRAIN_JOB_INITIAL_DELAY_MS: env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS,
        STUDIO_BRAIN_JOB_JITTER_MS: env.STUDIO_BRAIN_JOB_JITTER_MS,
        STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE: env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE,
        STUDIO_BRAIN_SCAN_LIMIT: env.STUDIO_BRAIN_SCAN_LIMIT,
        STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS: env.STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS,
        STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD: env.STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD,
        STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD: env.STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD,
        STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY: env.STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY,
        STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES: env.STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES,
        STUDIO_BRAIN_ENABLE_RETENTION_PRUNE: env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE,
        STUDIO_BRAIN_RETENTION_DAYS: env.STUDIO_BRAIN_RETENTION_DAYS,
        STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION,
        STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES,
        STUDIO_BRAIN_FUNCTIONS_BASE_URL: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL,
        STUDIO_BRAIN_DEFAULT_TENANT_ID: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
        STUDIO_BRAIN_ALLOWED_TENANT_IDS: env.STUDIO_BRAIN_ALLOWED_TENANT_IDS,
        STUDIO_BRAIN_MEMORY_INGEST_ENABLED: env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED,
        STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET ? "[set]" : null,
        STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS: env.STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS,
        STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID: env.STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID,
        STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES.join(","),
        STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS.join(","),
        STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS.join(","),
        STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL: env.STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL,
        STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS: env.STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS,
        STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS: env.STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS,
        STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: env.STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE,
        STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: env.STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED,
        STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: env.STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS,
        STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: env.STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS,
        STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: env.STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS,
        STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS: env.STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS,
        STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP: env.STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP,
        STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP: env.STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP,
        STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP: env.STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP,
        STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP: env.STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP,
        STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: env.STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS,
        STUDIO_BRAIN_STRIPE_READ_ONLY: env.STUDIO_BRAIN_STRIPE_READ_ONLY,
        STRIPE_MODE: env.STRIPE_MODE,
        STUDIO_BRAIN_STRIPE_READER_MODE: env.STUDIO_BRAIN_STRIPE_READER_MODE,
        FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID ?? null,
        GOOGLE_APPLICATION_CREDENTIALS: env.GOOGLE_APPLICATION_CREDENTIALS ? "[set]" : null,
        PGHOST: env.PGHOST,
        PGPORT: env.PGPORT,
        PGDATABASE: env.PGDATABASE,
        PGUSER: env.PGUSER,
        PGSSLMODE: env.PGSSLMODE,
        STUDIO_BRAIN_PG_POOL_MAX: env.STUDIO_BRAIN_PG_POOL_MAX,
        STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS: env.STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS,
        STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS: env.STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS,
        STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS,
        STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: env.STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS,
        STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS: env.STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS,
        STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: env.STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS,
        STUDIO_BRAIN_PG_APPLICATION_NAME: env.STUDIO_BRAIN_PG_APPLICATION_NAME,
        PGPASSWORD: "[redacted]",
        REDIS_HOST: env.REDIS_HOST,
        REDIS_PORT: env.REDIS_PORT,
        REDIS_USERNAME: env.REDIS_USERNAME ?? null,
        REDIS_PASSWORD: env.REDIS_PASSWORD ? "[set]" : null,
        REDIS_CONNECT_TIMEOUT_MS: env.REDIS_CONNECT_TIMEOUT_MS,
        REDIS_COMMAND_TIMEOUT_MS: env.REDIS_COMMAND_TIMEOUT_MS,
        STUDIO_BRAIN_REDIS_STREAM_NAME: env.STUDIO_BRAIN_REDIS_STREAM_NAME,
        STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
        STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
        STUDIO_BRAIN_EVENT_BUS_START_ID: env.STUDIO_BRAIN_EVENT_BUS_START_ID,
        STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT,
        STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
        STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY ? "[set]" : "[missing]",
        STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY ? "[set]" : "[missing]",
        STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
        STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS: env.STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS,
        STUDIO_BRAIN_VECTOR_STORE_ENABLED: env.STUDIO_BRAIN_VECTOR_STORE_ENABLED,
        STUDIO_BRAIN_VECTOR_STORE_TABLE: env.STUDIO_BRAIN_VECTOR_STORE_TABLE,
        STUDIO_BRAIN_EMBEDDING_PROVIDER: env.STUDIO_BRAIN_EMBEDDING_PROVIDER,
        STUDIO_BRAIN_EMBEDDING_DIMENSIONS: env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS,
        STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS: env.STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS,
        STUDIO_BRAIN_OPENAI_API_KEY: env.STUDIO_BRAIN_OPENAI_API_KEY ? "[set]" : null,
        STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL: env.STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL,
        STUDIO_BRAIN_VERTEX_PROJECT_ID: env.STUDIO_BRAIN_VERTEX_PROJECT_ID ?? null,
        STUDIO_BRAIN_VERTEX_LOCATION: env.STUDIO_BRAIN_VERTEX_LOCATION,
        STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL: env.STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL,
        STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
        STUDIO_BRAIN_SWARM_ID: env.STUDIO_BRAIN_SWARM_ID,
        STUDIO_BRAIN_SWARM_RUN_ID: env.STUDIO_BRAIN_SWARM_RUN_ID || null,
        STUDIO_BRAIN_SWARM_EVENT_POLL_MS: env.STUDIO_BRAIN_SWARM_EVENT_POLL_MS,
        STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH: env.STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH,
        STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL: env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL ?? null,
        STUDIO_BRAIN_SKILL_INSTALL_ROOT: env.STUDIO_BRAIN_SKILL_INSTALL_ROOT,
        STUDIO_BRAIN_SKILL_REQUIRE_PINNING: env.STUDIO_BRAIN_SKILL_REQUIRE_PINNING,
        STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM: env.STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM,
        STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE: env.STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE,
        STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: env.STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS ? "[set]" : "[missing]",
        STUDIO_BRAIN_SKILL_ALLOWLIST: env.STUDIO_BRAIN_SKILL_ALLOWLIST.join(","),
        STUDIO_BRAIN_SKILL_DENYLIST: env.STUDIO_BRAIN_SKILL_DENYLIST.join(","),
        STUDIO_BRAIN_SKILL_SANDBOX_ENABLED: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
        STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY,
        STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST.join(","),
        STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS: env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS,
        STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST: env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST.join(","),
        STUDIO_BRAIN_OTEL_ENABLED: env.STUDIO_BRAIN_OTEL_ENABLED,
        STUDIO_BRAIN_OTEL_ENDPOINT: env.STUDIO_BRAIN_OTEL_ENDPOINT ?? null,
        STUDIO_BRAIN_OTEL_SERVICE_NAME: env.STUDIO_BRAIN_OTEL_SERVICE_NAME,
    };
}
