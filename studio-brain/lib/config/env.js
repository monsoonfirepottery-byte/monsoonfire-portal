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
const BoolFromString = zod_1.z
    .union([zod_1.z.enum(["true", "false", "1", "0"]), zod_1.z.boolean()])
    .transform((value) => value === true || value === "true" || value === "1");
const EnvSchema = zod_1.z.object({
    STUDIO_BRAIN_PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(8787),
    STUDIO_BRAIN_HOST: zod_1.z.string().default("127.0.0.1"),
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
    PGHOST: zod_1.z.string().default("127.0.0.1"),
    PGPORT: zod_1.z.coerce.number().int().min(1).max(65535).default(5433),
    PGDATABASE: zod_1.z.string().default("monsoonfire_studio_os"),
    PGUSER: zod_1.z.string().default("postgres"),
    PGPASSWORD: zod_1.z.string().default("postgres"),
    PGSSLMODE: zod_1.z.enum(["disable", "prefer", "require"]).default("disable"),
    STUDIO_BRAIN_PG_POOL_MAX: zod_1.z.coerce.number().int().min(1).max(50).default(10),
    STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1_000).max(120_000).default(10_000),
    STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: BoolFromString.default(false),
    STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: BoolFromString.default(true),
    STUDIO_BRAIN_FUNCTIONS_BASE_URL: zod_1.z.string().default("https://us-central1-monsoonfire-portal.cloudfunctions.net"),
    STUDIO_BRAIN_DEFAULT_TENANT_ID: zod_1.z.string().default("monsoonfire-main"),
    STUDIO_BRAIN_ALLOWED_TENANT_IDS: zod_1.z.string().default("monsoonfire-main"),
    FIREBASE_PROJECT_ID: zod_1.z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: zod_1.z.string().optional(),
    STRIPE_MODE: zod_1.z.enum(["test", "live"]).default("test"),
    STUDIO_BRAIN_STRIPE_READ_ONLY: BoolFromString.default(true),
});
function readEnv() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid studio-brain env: ${message}`);
    }
    return parsed.data;
}
function redactEnvForLogs(env) {
    return {
        STUDIO_BRAIN_HOST: env.STUDIO_BRAIN_HOST,
        STUDIO_BRAIN_PORT: env.STUDIO_BRAIN_PORT,
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
        STUDIO_BRAIN_STRIPE_READ_ONLY: env.STUDIO_BRAIN_STRIPE_READ_ONLY,
        STRIPE_MODE: env.STRIPE_MODE,
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
        PGPASSWORD: "[redacted]",
    };
}
