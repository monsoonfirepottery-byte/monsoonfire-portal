import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
  "STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY",
  "STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY",
  "STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS",
  "PGPASSWORD",
  "REDIS_PASSWORD",
]);

const BoolFromString = z
  .union([z.enum(["true", "false", "1", "0"]), z.boolean()])
  .transform((value) => value === true || value === "true" || value === "1");

const requiredString = (field: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${field} must not be empty` });

const CsvFromString = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string()));

const EnvSchema = z.object({
  STUDIO_BRAIN_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  STUDIO_BRAIN_HOST: requiredString("STUDIO_BRAIN_HOST").default("127.0.0.1"),
  STUDIO_BRAIN_NETWORK_PROFILE: z.enum(["local", "lan-static", "lan-dhcp", "ci"]).default("local"),
  STUDIO_BRAIN_LOCAL_HOST: requiredString("STUDIO_BRAIN_LOCAL_HOST").default("127.0.0.1"),
  STUDIO_BRAIN_LAN_HOST: requiredString("STUDIO_BRAIN_LAN_HOST").default("studiobrain.local"),
  STUDIO_BRAIN_STATIC_IP: z.string().default(""),
  STUDIO_BRAIN_ALLOWED_HOSTS: z.string().default(""),
  STUDIO_BRAIN_HOST_STATE_FILE: requiredString("STUDIO_BRAIN_HOST_STATE_FILE").default(".studiobrain-host-state.json"),
  STUDIO_BRAIN_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STUDIO_BRAIN_ALLOWED_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
  STUDIO_BRAIN_ADMIN_TOKEN: z.string().optional(),
  STUDIO_BRAIN_JOB_INTERVAL_MS: z.coerce.number().int().min(10_000).max(86_400_000).default(15 * 60 * 1000),
  STUDIO_BRAIN_JOB_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(300_000).default(0),
  STUDIO_BRAIN_JOB_JITTER_MS: z.coerce.number().int().min(0).max(120_000).default(0),
  STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE: BoolFromString.default(true),
  STUDIO_BRAIN_SCAN_LIMIT: z.coerce.number().int().min(50).max(20_000).default(2_000),
  STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(20_000),
  STUDIO_BRAIN_DRIFT_ABSOLUTE_THRESHOLD: z.coerce.number().int().min(1).max(10_000).default(25),
  STUDIO_BRAIN_DRIFT_RATIO_THRESHOLD: z.coerce.number().min(0.01).max(10).default(0.5),
  STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY: BoolFromString.default(false),
  STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES: z.coerce.number().int().min(5).max(10_080).default(240),
  STUDIO_BRAIN_ENABLE_RETENTION_PRUNE: BoolFromString.default(false),
  STUDIO_BRAIN_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(180),

  PGHOST: requiredString("PGHOST").default("127.0.0.1"),
  PGPORT: z.coerce.number().int().min(1).max(65535).default(5433),
  PGDATABASE: requiredString("PGDATABASE").default("monsoonfire_studio_os"),
  PGUSER: requiredString("PGUSER").default("postgres"),
  PGPASSWORD: requiredString("PGPASSWORD").default("postgres"),
  PGSSLMODE: z.enum(["disable", "prefer", "require"]).default("disable"),
  STUDIO_BRAIN_PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),

  REDIS_HOST: requiredString("REDIS_HOST").default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  STUDIO_BRAIN_REDIS_STREAM_NAME: requiredString("STUDIO_BRAIN_REDIS_STREAM_NAME").default("studiobrain.events"),
  STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(750),
  STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(32),
  STUDIO_BRAIN_EVENT_BUS_START_ID: z.string().default("$"),

  STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT").default("http://127.0.0.1:9000"),
  STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_BUCKET").default("studiobrain-artifacts"),
  STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY").default("minioadmin"),
  STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY").default("minioadmin"),
  STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL: BoolFromString.default(false),
  STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),

  STUDIO_BRAIN_VECTOR_STORE_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_VECTOR_STORE_TABLE: z.string().default("swarm_memory"),

  STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_SWARM_ID: z.string().default("default-swarm"),
  STUDIO_BRAIN_SWARM_RUN_ID: z.string().default(""),
  STUDIO_BRAIN_SWARM_EVENT_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),

  STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH: z.string().default("./skills-registry"),
  STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL: z.string().optional(),
  STUDIO_BRAIN_SKILL_INSTALL_ROOT: requiredString("STUDIO_BRAIN_SKILL_INSTALL_ROOT").default("/var/lib/studiobrain/skills"),
  STUDIO_BRAIN_SKILL_REQUIRE_PINNING: BoolFromString.default(true),
  STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM: BoolFromString.default(true),
  STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE: BoolFromString.default(false),
  STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS: z.string().default(""),
  STUDIO_BRAIN_SKILL_ALLOWLIST: CsvFromString.default(() => []),
  STUDIO_BRAIN_SKILL_DENYLIST: CsvFromString.default(() => []),
  STUDIO_BRAIN_SKILL_SANDBOX_ENABLED: BoolFromString.default(true),
  STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY: BoolFromString.default(true),
  STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST: CsvFromString.default(() => []),
  STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(15_000),
  STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST: CsvFromString.default(() => []),

  STUDIO_BRAIN_ENABLE_WRITE_EXECUTION: BoolFromString.default(false),
  STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES: BoolFromString.default(true),
  STUDIO_BRAIN_FUNCTIONS_BASE_URL: z.string().default("https://us-central1-monsoonfire-portal.cloudfunctions.net"),
  STUDIO_BRAIN_DEFAULT_TENANT_ID: z.string().default("monsoonfire-main"),
  STUDIO_BRAIN_ALLOWED_TENANT_IDS: z.string().default("monsoonfire-main"),

  STUDIO_BRAIN_OTEL_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_OTEL_ENDPOINT: z.string().optional(),
  STUDIO_BRAIN_OTEL_SERVICE_NAME: z.string().default("studiobrain"),

  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STUDIO_BRAIN_STRIPE_READ_ONLY: BoolFromString.default(true),
});

export type BrainEnv = z.infer<typeof EnvSchema>;

function hasPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_MATCHERS.some((pattern) => pattern.test(value));
}

function validateConnectivityConfig(env: BrainEnv): string[] {
  const errors: string[] = [];

  const assertUrl = (value: string | undefined, variableName: string): void => {
    if (!value) return;
    try {
      new URL(value);
    } catch {
      errors.push(`${variableName} must be a valid URL`);
    }
  };

  if (env.STUDIO_BRAIN_VECTOR_STORE_ENABLED && !env.STUDIO_BRAIN_VECTOR_STORE_TABLE.trim()) {
    errors.push("STUDIO_BRAIN_VECTOR_STORE_TABLE is required when vector store is enabled");
  }

  if (env.STUDIO_BRAIN_SKILL_INSTALL_ROOT.trim().length === 0) {
    errors.push("STUDIO_BRAIN_SKILL_INSTALL_ROOT must not be empty");
  }
  if (
    env.STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE &&
    env.STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS.trim().length === 0
  ) {
    errors.push(
      "STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS is required when STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE=true"
    );
  }

  assertUrl(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT");

  if (env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL) {
    assertUrl(env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL, "STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL");
  }

  if (env.STUDIO_BRAIN_OTEL_ENABLED) {
    if (!env.STUDIO_BRAIN_OTEL_ENDPOINT) {
      errors.push("STUDIO_BRAIN_OTEL_ENDPOINT is required when STUDIO_BRAIN_OTEL_ENABLED=true");
    } else {
      assertUrl(env.STUDIO_BRAIN_OTEL_ENDPOINT, "STUDIO_BRAIN_OTEL_ENDPOINT");
    }
  }

  return errors;
}

function validateRuntimeSecretValues(env: BrainEnv): string[] {
  const issues: string[] = [];

  for (const [rawName, rawValue] of Object.entries(env)) {
    const name = rawName as keyof BrainEnv;
    if (!RUNTIME_ENFORCED_SENSITIVE_VARS.has(name)) continue;

    if (typeof rawValue !== "string") continue;
    if (!hasPlaceholderValue(rawValue)) continue;

    issues.push(`${name} is configured with a placeholder value; set a concrete secret before runtime startup.`);
  }

  return issues;
}

export function readEnv(): BrainEnv {
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

export function redactEnvForLogs(env: BrainEnv): Record<string, string | number | boolean | null> {
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
    STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS: env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS,
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
