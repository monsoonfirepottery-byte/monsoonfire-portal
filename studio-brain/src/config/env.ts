import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
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

const STUDIO_BRAIN_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(STUDIO_BRAIN_ROOT, "..");

const RUNTIME_ENFORCED_SENSITIVE_VARS = new Set([
  "STUDIO_BRAIN_ADMIN_TOKEN",
  "STUDIO_BRAIN_OPENAI_API_KEY",
  "STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET",
  "STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY",
  "STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY",
  "STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS",
  "STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET",
  "STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN",
  "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD",
  "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET",
  "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN",
  "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD",
  "STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN",
  "STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ADMIN_TOKEN",
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
  STUDIO_BRAIN_DHCP_HOST: z.string().default(""),
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
  STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(300_000).default(18_000),
  STUDIO_BRAIN_PG_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(4_000),
  STUDIO_BRAIN_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(15_000),
  STUDIO_BRAIN_PG_APPLICATION_NAME: z.string().default("studiobrain"),

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

  STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT").default("http://127.0.0.1:9010"),
  STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_BUCKET").default("studiobrain-artifacts"),
  STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY").default("minioadmin"),
  STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: requiredString("STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY").default("minioadmin"),
  STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL: BoolFromString.default(false),
  STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),

  STUDIO_BRAIN_VECTOR_STORE_ENABLED: BoolFromString.default(true),
  STUDIO_BRAIN_VECTOR_STORE_TABLE: z.string().default("swarm_memory"),
  STUDIO_BRAIN_EMBEDDING_PROVIDER: z.enum(["none", "openai", "vertex"]).default("openai"),
  STUDIO_BRAIN_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(128).max(4096).default(1536),
  STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  STUDIO_BRAIN_OPENAI_API_KEY: z.string().optional(),
  STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  STUDIO_BRAIN_VERTEX_PROJECT_ID: z.string().optional(),
  STUDIO_BRAIN_VERTEX_LOCATION: z.string().default("us-central1"),
  STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL: z.string().default("text-embedding-005"),

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
  STUDIO_BRAIN_ENABLE_OPS_PORTAL: BoolFromString.default(false),
  STUDIO_BRAIN_REQUIRE_STAFF_FOR_OPS_PORTAL: BoolFromString.default(true),
  STUDIO_BRAIN_ENABLE_OPS_PORTAL_CHOICE: BoolFromString.default(true),
  STUDIO_BRAIN_OPS_PORTAL_LEGACY_URL: z.string().default(""),
  STUDIO_BRAIN_OPS_PORTAL_DEFAULT_SURFACE: z
    .enum(["manager", "owner", "hands", "internet", "ceo", "forge"])
    .default("manager"),
  STUDIO_BRAIN_FUNCTIONS_BASE_URL: z.string().default("https://us-central1-monsoonfire-portal.cloudfunctions.net"),
  STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_SUPPORT_EMAIL_STARTUP_SYNC: BoolFromString.default(true),
  STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(5 * 60 * 1000),
  STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX: z.string().default("support@monsoonfire.com"),
  STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER: z.enum(["gmail", "namecheap_private_email"]).default("gmail"),
  STUDIO_BRAIN_SUPPORT_EMAIL_USER_ID: z.string().default("me"),
  STUDIO_BRAIN_SUPPORT_EMAIL_QUERY: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_LABEL_IDS: CsvFromString.default(() => []),
  STUDIO_BRAIN_SUPPORT_EMAIL_MAX_MESSAGES: z.coerce.number().int().min(1).max(100).default(25),
  STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_BASE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(30_000),
  STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_MAX_MS: z.coerce.number().int().min(5_000).max(7_200_000).default(30 * 60 * 1000),
  STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE: z.enum(["env", "application_default"]).default("env"),
  STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CREDENTIALS_PATH: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST: z.string().default("mail.privateemail.com"),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_SECURE: BoolFromString.default(true),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST: z.string().default("mail.privateemail.com"),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_SECURE: BoolFromString.default(true),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER: z.string().default("INBOX"),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IGNORE_TLS_ERRORS: BoolFromString.default(false),
  STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FROM_NAME: z.string().default("Ember at Monsoon Fire"),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE: z.enum(["shared", "separate", "disabled"]).default("shared"),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_USER_ID: z.string().default("me"),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE: z.enum(["env", "application_default"]).default("env"),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CREDENTIALS_PATH: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE: z.string().default("apiV1/v1/support.requests.ingestEmail"),
  STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE: z.enum(["env", "portal_automation"]).default("env"),
  STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ADMIN_TOKEN: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_ENV_PATH: z.string().default(""),
  STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_CREDENTIALS_PATH: z.string().default(""),
  STUDIO_BRAIN_KILN_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_KILN_IMPORT_MAX_BYTES: z.coerce.number().int().min(1_024).max(100_000_000).default(5 * 1024 * 1024),
  STUDIO_BRAIN_KILN_WATCH_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_KILN_WATCH_DIR: z.string().default("./output/studio-brain/kiln-watch"),
  STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS: z.coerce.number().int().min(10_000).max(86_400_000).default(5 * 60 * 1000),
  STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  STUDIO_BRAIN_KILN_WATCH_JITTER_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  STUDIO_BRAIN_KILN_ENABLE_SUPPORTED_WRITES: BoolFromString.default(false),
  STUDIO_BRAIN_KILNAID_SESSION_PATH: z.string().default(""),
  STUDIO_BRAIN_DEFAULT_TENANT_ID: z.string().default("monsoonfire-main"),
  STUDIO_BRAIN_ALLOWED_TENANT_IDS: z.string().default("monsoonfire-main"),
  STUDIO_BRAIN_MEMORY_INGEST_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: z.string().optional(),
  STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID: BoolFromString.default(true),
  STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES: CsvFromString.default(() => []),
  STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS: CsvFromString.default(() => []),
  STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS: CsvFromString.default(() => []),
  STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL: z.coerce.number().int().min(0).max(10_000).default(8),
  STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS: z.coerce.number().int().min(1).max(100).default(1),
  STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS: z.coerce.number().int().min(1).max(3600).default(20),
  STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE: z.coerce.number().int().min(0).max(10_000).default(4),
  STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED: z.coerce.number().int().min(0).max(10_000).default(14),
  STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS: z.coerce.number().int().min(1).max(2_000).default(20),
  STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS: z.coerce.number().int().min(1).max(2_000).default(12),
  STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS: z.coerce.number().int().min(1).max(4_000).default(28),
  STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS: z.coerce.number().int().min(1).max(3600).default(5),
  STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP: z.coerce.number().int().min(1).max(100).default(10),
  STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP: z.coerce.number().int().min(10).max(500).default(120),
  STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP: z.coerce.number().int().min(1).max(100).default(10),
  STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP: z.coerce.number().int().min(512).max(100_000).default(6_000),
  STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(16_000),

  STUDIO_BRAIN_OTEL_ENABLED: BoolFromString.default(false),
  STUDIO_BRAIN_OTEL_ENDPOINT: z.string().optional(),
  STUDIO_BRAIN_OTEL_SERVICE_NAME: z.string().default("studiobrain"),

  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STUDIO_BRAIN_STRIPE_READ_ONLY: BoolFromString.default(true),
  STUDIO_BRAIN_STRIPE_READER_MODE: z.enum(["auto", "stub", "live_read"]).default("auto"),
});

export type BrainEnv = z.infer<typeof EnvSchema>;

function hasPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_MATCHERS.some((pattern) => pattern.test(value));
}

function resolveConfiguredPath(pathValue: string, baseDir: string): string {
  const raw = pathValue.trim();
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

function resolveSupportEmailApplicationDefaultPath(env: BrainEnv): string {
  const explicit = resolveConfiguredPath(env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CREDENTIALS_PATH, STUDIO_BRAIN_ROOT);
  if (explicit) return explicit;
  const appData = String(process.env.APPDATA ?? "").trim();
  if (appData) {
    return resolve(appData, "gcloud", "application_default_credentials.json");
  }
  return resolve(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function resolveSupportEmailReplyApplicationDefaultPath(env: BrainEnv): string {
  const explicit = resolveConfiguredPath(env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CREDENTIALS_PATH, STUDIO_BRAIN_ROOT);
  if (explicit) return explicit;
  const appData = String(process.env.APPDATA ?? "").trim();
  if (appData) {
    return resolve(appData, "gcloud", "application_default_credentials.json");
  }
  return resolve(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function resolveSupportEmailPortalEnvPath(env: BrainEnv): string {
  const explicit = resolveConfiguredPath(env.STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_ENV_PATH, REPO_ROOT);
  const candidates = [
    explicit,
    resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env"),
    resolve(homedir(), "secrets", "portal", "portal-automation.env"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? explicit ?? "";
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
  if (env.STUDIO_BRAIN_EMBEDDING_PROVIDER === "vertex") {
    const projectId = env.STUDIO_BRAIN_VERTEX_PROJECT_ID || env.FIREBASE_PROJECT_ID;
    if (!projectId || projectId.trim().length === 0) {
      errors.push("STUDIO_BRAIN_VERTEX_PROJECT_ID or FIREBASE_PROJECT_ID is required when STUDIO_BRAIN_EMBEDDING_PROVIDER=vertex");
    }
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

  if (env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED) {
    if (!env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET || env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET.trim().length === 0) {
      errors.push("STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET is required when STUDIO_BRAIN_MEMORY_INGEST_ENABLED=true");
    }
  }

  if (env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED) {
    if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX.trim()) {
      errors.push("STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX is required when support email sync is enabled");
    }
    if (env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER === "gmail") {
      if (env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE === "application_default") {
        const credentialPath = resolveSupportEmailApplicationDefaultPath(env);
        if (!existsSync(credentialPath)) {
          errors.push(
            `STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE=application_default requires a credential file at ${credentialPath}`
          );
        }
      } else {
        if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID.trim()) {
          errors.push("STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID is required when support email provider is gmail");
        }
        if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET.trim()) {
          errors.push(
            "STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET is required when support email provider is gmail"
          );
        }
        if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN.trim()) {
          errors.push(
            "STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN is required when support email provider is gmail"
          );
        }
      }
    } else {
      if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST.trim()) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST is required when support email provider is namecheap_private_email"
        );
      }
      if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST.trim()) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST is required when support email provider is namecheap_private_email"
        );
      }
      if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME.trim()) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME is required when support email provider is namecheap_private_email"
        );
      }
      if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD.trim()) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD is required when support email provider is namecheap_private_email"
        );
      }
      if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER.trim()) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER is required when support email provider is namecheap_private_email"
        );
      }
    }
    if (env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE === "separate") {
      if (env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER === "gmail") {
        if (env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE === "application_default") {
          const credentialPath = resolveSupportEmailReplyApplicationDefaultPath(env);
          if (!existsSync(credentialPath)) {
            errors.push(
              `STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE=application_default requires a credential file at ${credentialPath}`
            );
          }
        } else {
          if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID.trim()) {
            errors.push("STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID is required when reply mode is separate");
          }
          if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET.trim()) {
            errors.push(
              "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET is required when reply mode is separate"
            );
          }
          if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN.trim()) {
            errors.push(
              "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN is required when reply mode is separate"
            );
          }
        }
      } else {
        if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME.trim()) {
          errors.push(
            "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME is required when provider is namecheap_private_email and reply mode is separate"
          );
        }
        if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD.trim()) {
          errors.push(
            "STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD is required when provider is namecheap_private_email and reply mode is separate"
          );
        }
      }
    }
    if (env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE === "portal_automation") {
      const portalEnvPath = resolveSupportEmailPortalEnvPath(env);
      if (!portalEnvPath || !existsSync(portalEnvPath)) {
        errors.push(
          "STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE=portal_automation requires a readable portal automation env file."
        );
      }
    } else if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN.trim()) {
      errors.push("STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN is required when support email sync is enabled");
    }
    if (!env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE.trim()) {
      errors.push("STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE is required when support email sync is enabled");
    }
    assertUrl(env.STUDIO_BRAIN_FUNCTIONS_BASE_URL, "STUDIO_BRAIN_FUNCTIONS_BASE_URL");
  }

  if (env.STUDIO_BRAIN_KILN_ENABLED && env.STUDIO_BRAIN_KILN_WATCH_ENABLED) {
    if (!env.STUDIO_BRAIN_KILN_WATCH_DIR.trim()) {
      errors.push("STUDIO_BRAIN_KILN_WATCH_DIR is required when kiln watch ingestion is enabled");
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
    STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED: env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED,
    STUDIO_BRAIN_SUPPORT_EMAIL_STARTUP_SYNC: env.STUDIO_BRAIN_SUPPORT_EMAIL_STARTUP_SYNC,
    STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS: env.STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS,
    STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS: env.STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS,
    STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS: env.STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS,
    STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX: env.STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX,
    STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER: env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER,
    STUDIO_BRAIN_SUPPORT_EMAIL_USER_ID: env.STUDIO_BRAIN_SUPPORT_EMAIL_USER_ID,
    STUDIO_BRAIN_SUPPORT_EMAIL_QUERY: env.STUDIO_BRAIN_SUPPORT_EMAIL_QUERY || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_LABEL_IDS: env.STUDIO_BRAIN_SUPPORT_EMAIL_LABEL_IDS.join(","),
    STUDIO_BRAIN_SUPPORT_EMAIL_MAX_MESSAGES: env.STUDIO_BRAIN_SUPPORT_EMAIL_MAX_MESSAGES,
    STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_BASE_MS: env.STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_BASE_MS,
    STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_MAX_MS: env.STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_MAX_MS,
    STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE,
    STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CREDENTIALS_PATH: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CREDENTIALS_PATH || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_PORT: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_PORT,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_SECURE: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_SECURE,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_PORT: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_PORT,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_SECURE: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_SECURE,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IGNORE_TLS_ERRORS:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IGNORE_TLS_ERRORS,
    STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FROM_NAME: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FROM_NAME || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_USER_ID: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_USER_ID,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CREDENTIALS_PATH:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CREDENTIALS_PATH || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD:
      env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE,
    STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE,
    STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ADMIN_TOKEN: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ADMIN_TOKEN ? "[set]" : null,
    STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_ENV_PATH: env.STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_ENV_PATH || null,
    STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_CREDENTIALS_PATH: env.STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_CREDENTIALS_PATH || null,
    STUDIO_BRAIN_KILN_ENABLED: env.STUDIO_BRAIN_KILN_ENABLED,
    STUDIO_BRAIN_KILN_IMPORT_MAX_BYTES: env.STUDIO_BRAIN_KILN_IMPORT_MAX_BYTES,
    STUDIO_BRAIN_KILN_WATCH_ENABLED: env.STUDIO_BRAIN_KILN_WATCH_ENABLED,
    STUDIO_BRAIN_KILN_WATCH_DIR: env.STUDIO_BRAIN_KILN_WATCH_DIR,
    STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS: env.STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS,
    STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS: env.STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS,
    STUDIO_BRAIN_KILN_WATCH_JITTER_MS: env.STUDIO_BRAIN_KILN_WATCH_JITTER_MS,
    STUDIO_BRAIN_KILN_ENABLE_SUPPORTED_WRITES: env.STUDIO_BRAIN_KILN_ENABLE_SUPPORTED_WRITES,
    STUDIO_BRAIN_KILNAID_SESSION_PATH: env.STUDIO_BRAIN_KILNAID_SESSION_PATH || null,
    STUDIO_BRAIN_DEFAULT_TENANT_ID: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
    STUDIO_BRAIN_ALLOWED_TENANT_IDS: env.STUDIO_BRAIN_ALLOWED_TENANT_IDS,
    STUDIO_BRAIN_MEMORY_INGEST_ENABLED: env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED,
    STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET: env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET ? "[set]" : null,
    STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS: env.STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS,
    STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID: env.STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID,
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES.join(","),
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS:
      env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS.join(","),
    STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS:
      env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS.join(","),
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
