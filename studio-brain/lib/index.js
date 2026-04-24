"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const logger_1 = require("./config/logger");
const healthcheck_1 = require("./connectivity/healthcheck");
const database_1 = require("./connectivity/database");
const artifactStore_1 = require("./connectivity/artifactStore");
const eventBus_1 = require("./swarm/bus/eventBus");
const redis_1 = require("./connectivity/redis");
const vectorStore_1 = require("./connectivity/vectorStore");
const maintenance_1 = require("./db/maintenance");
const postgresEventStore_1 = require("./stores/postgresEventStore");
const postgresStateStore_1 = require("./stores/postgresStateStore");
const runner_1 = require("./jobs/runner");
const studioStateJob_1 = require("./jobs/studioStateJob");
const server_1 = require("./http/server");
const runtime_1 = require("./capabilities/runtime");
const postgresStores_1 = require("./capabilities/postgresStores");
const hubitatConnector_1 = require("./connectors/hubitatConnector");
const roborockConnector_1 = require("./connectors/roborockConnector");
const roborockTransport_1 = require("./connectors/roborockTransport");
const registry_1 = require("./connectors/registry");
const pilotWriteExecutor_1 = require("./capabilities/pilotWriteExecutor");
const orchestrator_1 = require("./swarm/orchestrator");
const registry_2 = require("./skills/registry");
const sandbox_1 = require("./skills/sandbox");
const service_1 = require("./memory/service");
const postgresAdapter_1 = require("./memory/postgresAdapter");
const embedding_1 = require("./memory/embedding");
const processLock_1 = require("./runtime/processLock");
const provider_1 = require("./kiln/adapters/kilnaid/provider");
const postgresStore_1 = require("./kiln/postgresStore");
const artifacts_1 = require("./kiln/services/artifacts");
const gmailAdapter_1 = require("./supportOps/gmailAdapter");
const namecheapPrivateEmailAdapter_1 = require("./supportOps/namecheapPrivateEmailAdapter");
const portalIngestAuth_1 = require("./supportOps/portalIngestAuth");
const store_1 = require("./supportOps/store");
const service_2 = require("./supportOps/service");
function parseArtifactPort(endpoint, fallback) {
    try {
        const parsed = new URL(endpoint);
        const port = Number(parsed.port);
        return Number.isFinite(port) && port > 0 ? port : fallback;
    }
    catch {
        return fallback;
    }
}
async function main() {
    const env = (0, env_1.readEnv)();
    const logger = (0, logger_1.createLogger)(env.STUDIO_BRAIN_LOG_LEVEL);
    const runtimeStartedAt = new Date().toISOString();
    const rawEnforceSingleRuntime = String(process.env.STUDIO_BRAIN_ENFORCE_SINGLE_RUNTIME ?? "true").trim().toLowerCase();
    const enforceSingleRuntime = rawEnforceSingleRuntime === ""
        || rawEnforceSingleRuntime === "1"
        || rawEnforceSingleRuntime === "true"
        || rawEnforceSingleRuntime === "yes"
        || rawEnforceSingleRuntime === "on";
    const processLockPath = String(process.env.STUDIO_BRAIN_PROCESS_LOCK_PATH ?? ".studio-brain.runtime.lock").trim()
        || ".studio-brain.runtime.lock";
    let processLock = null;
    const schedulerState = {
        intervalMs: env.STUDIO_BRAIN_JOB_INTERVAL_MS,
        jitterMs: env.STUDIO_BRAIN_JOB_JITTER_MS,
        initialDelayMs: env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS,
        nextRunAt: null,
        lastRunStartedAt: null,
        lastRunCompletedAt: null,
        lastRunDurationMs: null,
        totalRuns: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        lastFailureMessage: null,
    };
    const supportEmailState = {
        enabled: env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED,
        provider: env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER,
        mailbox: env.STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX,
        intervalMs: env.STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS,
        jitterMs: env.STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS,
        initialDelayMs: env.STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS,
        nextRunAt: null,
        lastRunStartedAt: null,
        lastRunCompletedAt: null,
        lastRunDurationMs: null,
        totalRuns: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        lastFailureMessage: null,
        lastSummary: null,
    };
    const kilnWatchState = {
        enabled: env.STUDIO_BRAIN_KILN_ENABLED && env.STUDIO_BRAIN_KILN_WATCH_ENABLED,
        watchDir: env.STUDIO_BRAIN_KILN_WATCH_DIR || null,
        intervalMs: env.STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS,
        jitterMs: env.STUDIO_BRAIN_KILN_WATCH_JITTER_MS,
        initialDelayMs: env.STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS,
        nextRunAt: null,
        lastRunStartedAt: null,
        lastRunCompletedAt: null,
        lastRunDurationMs: null,
        totalRuns: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        lastFailureMessage: null,
        lastSummary: null,
    };
    logger.info("studio_brain_boot", {
        mode: "anchor",
        cloudAuthoritative: true,
        localWriteExecutionEnabled: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION,
        requireApprovalForExternalWrites: env.STUDIO_BRAIN_REQUIRE_APPROVAL_FOR_EXTERNAL_WRITES,
        env: (0, env_1.redactEnvForLogs)(env),
    });
    if (enforceSingleRuntime) {
        try {
            processLock = (0, processLock_1.acquireProcessLock)({
                lockPath: processLockPath,
                cwd: process.cwd(),
                cmd: process.argv.join(" "),
                startedAt: runtimeStartedAt,
            });
            logger.info("studio_brain_runtime_lock_acquired", {
                lockPath: processLock.lockPath,
                pid: processLock.payload.pid,
            });
        }
        catch (error) {
            logger.error("studio_brain_runtime_lock_failed", {
                lockPath: processLockPath,
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    logger.info("studio_brain_connectivity_boot", {});
    const dbConnection = await (0, database_1.createDatabaseConnection)(logger);
    const skillRegistry = env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL
        ? (0, registry_2.createRemoteRegistryClient)({
            baseUrl: env.STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL,
        })
        : (0, registry_2.createLocalRegistryClient)({
            rootPath: env.STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH,
        });
    const artifactStore = await (0, artifactStore_1.createArtifactStore)({
        endpoint: env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT,
        port: parseArtifactPort(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, 9010),
        useSSL: env.STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL,
        accessKey: env.STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY,
        secretKey: env.STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY,
        bucket: env.STUDIO_BRAIN_ARTIFACT_STORE_BUCKET,
        timeoutMs: env.STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS,
    }, logger);
    const vectorStoreForMemory = await (0, vectorStore_1.createVectorStore)(logger);
    const vectorStore = env.STUDIO_BRAIN_VECTOR_STORE_ENABLED ? vectorStoreForMemory : null;
    const allowedTenantIds = env.STUDIO_BRAIN_ALLOWED_TENANT_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const memoryService = (0, service_1.createMemoryService)({
        store: (0, postgresAdapter_1.createPostgresMemoryStoreAdapter)({
            vectorStore: vectorStoreForMemory,
            tableName: env.STUDIO_BRAIN_VECTOR_STORE_TABLE,
        }),
        embeddingAdapter: (0, embedding_1.createEmbeddingAdapterFromEnv)(env, logger),
        defaultTenantId: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
        defaultAgentId: "studio-brain-memory",
        defaultRunId: "open-memory-v1",
        allowedTenantIds,
        expectedEmbeddingDimensions: env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS,
    });
    let redisConnection = null;
    let eventBus = null;
    let orchestrator = null;
    let swarmRunId = "";
    if (env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED) {
        redisConnection = (0, redis_1.buildRedisClient)({
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            username: env.REDIS_USERNAME,
            password: env.REDIS_PASSWORD,
            connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
            commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        }, logger);
        eventBus = await (0, eventBus_1.createRedisStreamEventBus)(redisConnection, env.STUDIO_BRAIN_REDIS_STREAM_NAME, logger, {
            startId: env.STUDIO_BRAIN_EVENT_BUS_START_ID,
            pollIntervalMs: env.STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS,
            maxBatchSize: env.STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE,
            commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        });
        swarmRunId = env.STUDIO_BRAIN_SWARM_RUN_ID || (0, orchestrator_1.deriveSwarmRunId)(env.STUDIO_BRAIN_SWARM_ID);
        orchestrator = new orchestrator_1.SwarmOrchestrator({
            bus: eventBus,
            logger,
            config: {
                swarmId: env.STUDIO_BRAIN_SWARM_ID,
                runId: swarmRunId,
            },
        });
        await orchestrator.start();
        await eventBus.publish({
            type: "run.started",
            swarmId: env.STUDIO_BRAIN_SWARM_ID,
            runId: swarmRunId,
            actorId: "studio-brain",
            payload: {
                reason: "service_start",
                role: "coordinator",
            },
        });
    }
    const skillSandbox = await (async () => {
        if (!env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED) {
            return null;
        }
        try {
            return await (0, sandbox_1.createSkillSandbox)({
                enabled: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
                egressDeny: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY,
                egressAllowlist: env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST,
                entryTimeoutMs: env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS,
                runtimeAllowlist: env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST,
                logger,
            });
        }
        catch (error) {
            logger.warn("studio_brain_skill_sandbox_init_failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    })();
    const stateStore = new postgresStateStore_1.PostgresStateStore();
    const eventStore = new postgresEventStore_1.PostgresEventStore();
    const kilnStore = env.STUDIO_BRAIN_KILN_ENABLED ? new postgresStore_1.PostgresKilnStore() : null;
    const kilnObservationProvider = (0, provider_1.createKilnAidReadOnlyProvider)(env.STUDIO_BRAIN_KILNAID_SESSION_PATH || null);
    const connectorRegistry = new registry_1.ConnectorRegistry([
        new hubitatConnector_1.HubitatConnector(async (path) => {
            if (path === "/health")
                return { ok: true };
            return { devices: [] };
        }),
        new roborockConnector_1.RoborockConnector((0, roborockTransport_1.createRoborockTransportFromEnv)(logger)),
    ], logger);
    const capabilityRuntime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore, new postgresStores_1.PostgresProposalStore(), new postgresStores_1.PostgresQuotaStore(), new postgresStores_1.PostgresPolicyStore(), connectorRegistry);
    const supportOpsStore = new store_1.PostgresSupportOpsStore();
    const recordSupportLoopSignal = async (input) => {
        const captured = await memoryService.capture({
            content: input.note,
            source: "support-ops",
            tags: ["support", "support-ops", input.loopKey],
            tenantId: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
            metadata: {
                loopKey: input.loopKey,
                supportRequestId: input.supportRequestId ?? null,
                sourceMessageId: input.sourceMessageId ?? null,
                ...input.metadata,
            },
            importance: input.action === "escalate" ? 0.88 : 0.68,
        });
        await memoryService.incidentAction({
            tenantId: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
            loopKey: input.loopKey,
            memoryId: captured.id,
            action: input.action,
            actorId: "studio-brain",
            note: input.note,
            metadata: {
                supportRequestId: input.supportRequestId ?? null,
                sourceMessageId: input.sourceMessageId ?? null,
                ...input.metadata,
            },
        });
    };
    let supportMailboxReader = null;
    let supportReplySender = null;
    if (env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED) {
        if (env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER === "gmail") {
            supportMailboxReader = new gmailAdapter_1.GmailSupportMailboxAdapter({
                oauthSource: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_OAUTH_SOURCE,
                credentialsPath: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CREDENTIALS_PATH || undefined,
                clientId: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_ID || undefined,
                clientSecret: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_CLIENT_SECRET || undefined,
                refreshToken: env.STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_REFRESH_TOKEN || undefined,
                userId: env.STUDIO_BRAIN_SUPPORT_EMAIL_USER_ID,
            });
            supportReplySender =
                env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE === "disabled"
                    ? null
                    : env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE === "shared"
                        ? supportMailboxReader
                        : new gmailAdapter_1.GmailSupportMailboxAdapter({
                            oauthSource: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_OAUTH_SOURCE,
                            credentialsPath: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CREDENTIALS_PATH || undefined,
                            clientId: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_ID || undefined,
                            clientSecret: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_CLIENT_SECRET || undefined,
                            refreshToken: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_GMAIL_REFRESH_TOKEN || undefined,
                            userId: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_USER_ID,
                        });
        }
        else {
            supportMailboxReader = new namecheapPrivateEmailAdapter_1.NamecheapPrivateEmailSupportMailboxAdapter({
                username: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_USERNAME,
                password: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_PASSWORD,
                mailboxFolder: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER,
                imapHost: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST,
                imapPort: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_PORT,
                imapSecure: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_SECURE,
                smtpHost: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST,
                smtpPort: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_PORT,
                smtpSecure: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_SECURE,
                ignoreTlsErrors: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IGNORE_TLS_ERRORS,
                fromName: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FROM_NAME,
            });
            supportReplySender =
                env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE === "disabled"
                    ? null
                    : env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_MODE === "shared"
                        ? supportMailboxReader
                        : new namecheapPrivateEmailAdapter_1.NamecheapPrivateEmailSupportMailboxAdapter({
                            username: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_USERNAME,
                            password: env.STUDIO_BRAIN_SUPPORT_EMAIL_REPLY_NAMECHEAP_PASSWORD,
                            mailboxFolder: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FOLDER,
                            imapHost: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_HOST,
                            imapPort: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_PORT,
                            imapSecure: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IMAP_SECURE,
                            smtpHost: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_HOST,
                            smtpPort: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_PORT,
                            smtpSecure: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_SMTP_SECURE,
                            ignoreTlsErrors: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_IGNORE_TLS_ERRORS,
                            fromName: env.STUDIO_BRAIN_SUPPORT_EMAIL_NAMECHEAP_FROM_NAME,
                        });
        }
    }
    const supportOpsService = env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED
        ? new service_2.SupportOpsService({
            logger,
            store: supportOpsStore,
            mailboxReader: supportMailboxReader,
            replySender: supportReplySender,
            capabilityRuntime,
            eventStore,
            mailbox: env.STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX,
            provider: env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER,
            tenantId: env.STUDIO_BRAIN_DEFAULT_TENANT_ID,
            maxMessages: env.STUDIO_BRAIN_SUPPORT_EMAIL_MAX_MESSAGES,
            query: env.STUDIO_BRAIN_SUPPORT_EMAIL_QUERY || undefined,
            labelIds: env.STUDIO_BRAIN_SUPPORT_EMAIL_LABEL_IDS,
            backoffBaseMs: env.STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_BASE_MS,
            backoffMaxMs: env.STUDIO_BRAIN_SUPPORT_EMAIL_BACKOFF_MAX_MS,
            ingestRoute: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ROUTE,
            functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL,
            ingestBearerToken: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE === "env"
                ? env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_BEARER_TOKEN
                : undefined,
            ingestBearerTokenProvider: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_AUTH_SOURCE === "portal_automation"
                ? () => (0, portalIngestAuth_1.mintSupportIngestBearerFromPortal)({
                    portalEnvPath: env.STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_ENV_PATH || undefined,
                    portalCredentialsPath: env.STUDIO_BRAIN_SUPPORT_EMAIL_PORTAL_CREDENTIALS_PATH || undefined,
                })
                : undefined,
            ingestAdminToken: env.STUDIO_BRAIN_SUPPORT_EMAIL_INGEST_ADMIN_TOKEN || undefined,
            recordLoopSignal: recordSupportLoopSignal,
            emberMemory: {
                getDiscordContext: async ({ conversationKey, question }) => {
                    const context = await memoryService.context({
                        agentId: "ember-support",
                        runId: (0, service_2.buildEmberRunId)("discord", conversationKey),
                        query: question,
                        useMode: "planning",
                        includeTenantFallback: true,
                        layerAllowlist: ["working", "episodic", "canonical"],
                        maxItems: 4,
                        maxChars: 1_200,
                    });
                    return { summary: context.summary || null };
                },
                recordWorking: async (input) => {
                    const runId = (0, service_2.buildEmberRunId)(input.channel, input.conversationKey);
                    const emberMemoryScope = (0, service_2.buildEmberMemoryScope)(input.channel, input.conversationKey);
                    await memoryService.capture({
                        agentId: "ember-support",
                        runId,
                        source: `support:${input.channel}:working`,
                        tags: [
                            "ember-support",
                            input.channel,
                            "working",
                            input.issueType,
                            input.confusionState,
                        ].filter(Boolean),
                        memoryLayer: "working",
                        memoryType: "working",
                        memoryCategory: "observation",
                        sourceConfidence: 0.62,
                        importance: input.humanHandoff ? 0.82 : 0.68,
                        content: [
                            `Support continuity for ${input.senderName || input.senderEmail || input.supportRequestId}.`,
                            `Latest ask: ${input.latestAsk}`,
                            input.supportSummary ? `Current read: ${input.supportSummary}` : "",
                            input.nextRecommendedAction ? `Next safe step: ${input.nextRecommendedAction}` : "",
                        ].filter(Boolean).join(" "),
                        metadata: {
                            scope: emberMemoryScope,
                            subjectKey: (0, service_2.buildEmberMemberSubject)(input.senderEmail || input.senderName || input.supportRequestId),
                            relatedSubjects: [(0, service_2.buildEmberPatternSubject)(input.issueType)],
                            emberMemoryScope,
                            conversationKey: input.conversationKey,
                            supportRequestId: input.supportRequestId,
                            supportSummary: input.supportSummary,
                            emberSummary: input.supportSummary,
                            confusionState: input.confusionState,
                            confusionReason: input.confusionReason,
                            humanHandoff: input.humanHandoff,
                            nextRecommendedAction: input.nextRecommendedAction,
                        },
                    });
                    return {
                        emberMemoryScope,
                        emberSummary: input.supportSummary,
                    };
                },
                recordResolved: async (input) => {
                    const runId = (0, service_2.buildEmberRunId)(input.channel, input.conversationKey);
                    const emberMemoryScope = (0, service_2.buildEmberMemoryScope)(input.channel, input.conversationKey);
                    await memoryService.capture({
                        agentId: "ember-support",
                        runId,
                        source: `support:${input.channel}:resolved`,
                        tags: [
                            "ember-support",
                            input.channel,
                            "resolved",
                            input.issueType,
                            input.confusionState,
                        ].filter(Boolean),
                        memoryLayer: "episodic",
                        memoryType: "episodic",
                        memoryCategory: "derived-insight",
                        sourceConfidence: 0.68,
                        importance: 0.74,
                        content: [
                            `Resolved support case for ${input.senderName || input.senderEmail || input.supportRequestId}.`,
                            input.supportSummary ? `What helped: ${input.supportSummary}` : "",
                            input.nextRecommendedAction ? `Resolution path: ${input.nextRecommendedAction}` : "",
                        ].filter(Boolean).join(" "),
                        metadata: {
                            scope: emberMemoryScope,
                            subjectKey: (0, service_2.buildEmberMemberSubject)(input.senderEmail || input.senderName || input.supportRequestId),
                            relatedSubjects: [(0, service_2.buildEmberPatternSubject)(input.issueType)],
                            emberMemoryScope,
                            supportRequestId: input.supportRequestId,
                            supportSummary: input.supportSummary,
                            confusionState: input.confusionState,
                            confusionReason: input.confusionReason,
                            humanHandoff: input.humanHandoff,
                        },
                    });
                    if (input.confusionState !== "none" && input.successfulReply && !input.humanHandoff) {
                        await memoryService.capture({
                            agentId: "ember-support",
                            runId,
                            source: `support:${input.channel}:guidance-candidate`,
                            tags: [
                                "ember-support",
                                input.channel,
                                "guidance-candidate",
                                input.issueType,
                                input.confusionState,
                            ].filter(Boolean),
                            memoryLayer: "episodic",
                            memoryType: "procedural",
                            memoryCategory: "procedure",
                            sourceConfidence: 0.66,
                            importance: 0.76,
                            content: [
                                `Candidate Ember guidance for ${input.issueType}.`,
                                input.supportSummary ? `Situation: ${input.supportSummary}` : "",
                                `Successful phrasing: ${input.successfulReply}`,
                            ].filter(Boolean).join(" "),
                            metadata: {
                                scope: emberMemoryScope,
                                subjectKey: (0, service_2.buildEmberPatternSubject)(input.issueType),
                                emberMemoryScope,
                                supportRequestId: input.supportRequestId,
                                emberSummary: input.supportSummary,
                                confusionState: input.confusionState,
                                confusionReason: input.confusionReason,
                                humanHandoff: false,
                                memoryReviewCaseType: "promote-guidance",
                                reviewAction: "revalidate",
                                reviewPriority: 0.76,
                                reviewReasons: ["promote-guidance", input.confusionState],
                            },
                        });
                    }
                },
            },
        })
        : null;
    const jobHandlers = {
        computeStudioState: studioStateJob_1.computeStudioStateJob,
    };
    if (supportOpsService) {
        jobHandlers.supportEmailSync = async () => {
            const report = await supportOpsService.syncMailbox();
            return { summary: report.summary };
        };
    }
    const runner = new runner_1.JobRunner({
        stateStore,
        eventStore,
        logger,
    }, jobHandlers);
    const runCompute = async (trigger) => {
        const startedAtMs = Date.now();
        schedulerState.lastRunStartedAt = new Date(startedAtMs).toISOString();
        schedulerState.totalRuns += 1;
        try {
            await runner.run("computeStudioState");
            schedulerState.consecutiveFailures = 0;
            schedulerState.lastFailureMessage = null;
        }
        catch (error) {
            schedulerState.totalFailures += 1;
            schedulerState.consecutiveFailures += 1;
            schedulerState.lastFailureMessage = error instanceof Error ? error.message : String(error);
            logger.error("compute_studio_state_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            schedulerState.lastRunCompletedAt = new Date().toISOString();
            schedulerState.lastRunDurationMs = Date.now() - startedAtMs;
        }
    };
    const runKilnWatch = async (trigger) => {
        if (!kilnStore || !env.STUDIO_BRAIN_KILN_ENABLED || !env.STUDIO_BRAIN_KILN_WATCH_ENABLED)
            return;
        const watchDir = String(env.STUDIO_BRAIN_KILN_WATCH_DIR || "").trim();
        if (!watchDir)
            return;
        const startedAtMs = Date.now();
        kilnWatchState.lastRunStartedAt = new Date(startedAtMs).toISOString();
        kilnWatchState.totalRuns += 1;
        try {
            const result = await (0, artifacts_1.scanGenesisWatchFolder)({
                watchDir,
                artifactStore,
                kilnStore,
                providerSupport: kilnObservationProvider.describeSupport(),
            });
            kilnWatchState.consecutiveFailures = 0;
            kilnWatchState.lastFailureMessage = null;
            kilnWatchState.lastSummary = `imported=${result.imported} skipped=${result.skipped}`;
            logger.info("kiln_watch_completed", {
                trigger,
                imported: result.imported,
                skipped: result.skipped,
            });
        }
        catch (error) {
            kilnWatchState.totalFailures += 1;
            kilnWatchState.consecutiveFailures += 1;
            kilnWatchState.lastFailureMessage = error instanceof Error ? error.message : String(error);
            logger.error("kiln_watch_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            kilnWatchState.lastRunCompletedAt = new Date().toISOString();
            kilnWatchState.lastRunDurationMs = Date.now() - startedAtMs;
        }
    };
    const runSupportEmailSync = async (trigger) => {
        if (!supportOpsService)
            return;
        const startedAtMs = Date.now();
        supportEmailState.lastRunStartedAt = new Date(startedAtMs).toISOString();
        supportEmailState.totalRuns += 1;
        try {
            await runner.run("supportEmailSync");
            const mailboxState = await supportOpsStore.getMailboxState(env.STUDIO_BRAIN_SUPPORT_EMAIL_PROVIDER, env.STUDIO_BRAIN_SUPPORT_EMAIL_MAILBOX);
            supportEmailState.consecutiveFailures = 0;
            supportEmailState.lastFailureMessage = null;
            supportEmailState.lastSummary =
                typeof mailboxState?.metadata?.processed === "number"
                    ? `processed=${mailboxState.metadata.processed} replies=${mailboxState.metadata.repliesSent ?? 0} drafts=${mailboxState.metadata.replyDrafts ?? 0} proposals=${mailboxState.metadata.proposalsCreated ?? 0}`
                    : "support sync completed";
        }
        catch (error) {
            supportEmailState.totalFailures += 1;
            supportEmailState.consecutiveFailures += 1;
            supportEmailState.lastFailureMessage = error instanceof Error ? error.message : String(error);
            logger.error("support_email_sync_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            supportEmailState.lastRunCompletedAt = new Date().toISOString();
            supportEmailState.lastRunDurationMs = Date.now() - startedAtMs;
        }
    };
    if (env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE) {
        await runCompute("startup");
    }
    if (env.STUDIO_BRAIN_KILN_ENABLED && env.STUDIO_BRAIN_KILN_WATCH_ENABLED) {
        await runKilnWatch("startup");
    }
    if (env.STUDIO_BRAIN_SUPPORT_EMAIL_ENABLED && env.STUDIO_BRAIN_SUPPORT_EMAIL_STARTUP_SYNC) {
        await runSupportEmailSync("startup");
    }
    const runPrune = async (trigger) => {
        if (!env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE)
            return;
        try {
            const result = await (0, maintenance_1.pruneOldRows)(env.STUDIO_BRAIN_RETENTION_DAYS);
            logger.info("studio_brain_retention_prune_completed", {
                trigger,
                ...result,
            });
        }
        catch (error) {
            logger.error("studio_brain_retention_prune_failed", {
                trigger,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };
    let timer = null;
    let kilnWatchTimer = null;
    let supportEmailTimer = null;
    let pruneInterval = null;
    let shuttingDown = false;
    const backendHealth = async () => {
        const checks = [
            {
                label: "postgres",
                enabled: true,
                run: async () => dbConnection.healthcheck(),
            },
            {
                label: "redis",
                enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED,
                run: async () => redisConnection
                    ? redisConnection.healthcheck()
                    : { ok: false, latencyMs: 0, error: "redis disabled" },
            },
            {
                label: "event_bus",
                enabled: env.STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED && Boolean(eventBus),
                run: async () => eventBus ? eventBus.healthcheck() : { ok: false, latencyMs: 0, error: "event bus disabled" },
            },
            {
                label: "artifact_store",
                enabled: true,
                run: async () => artifactStore.healthcheck(),
            },
            {
                label: "vector_store",
                enabled: env.STUDIO_BRAIN_VECTOR_STORE_ENABLED,
                run: async () => {
                    if (!vectorStore)
                        return { ok: false, latencyMs: 0, error: "vector store disabled" };
                    return vectorStore.healthcheck();
                },
            },
            {
                label: "skill_registry",
                enabled: true,
                run: async () => skillRegistry.healthcheck(),
            },
            {
                label: "kilnaid_provider",
                enabled: env.STUDIO_BRAIN_KILN_ENABLED,
                run: async () => kilnObservationProvider.health(),
            },
            {
                label: "skill_sandbox",
                enabled: env.STUDIO_BRAIN_SKILL_SANDBOX_ENABLED,
                run: async () => {
                    if (!skillSandbox)
                        return { ok: false, latencyMs: 0, error: "skill sandbox disabled" };
                    const startedAt = Date.now();
                    const ok = await skillSandbox.healthcheck();
                    return { ok, latencyMs: Date.now() - startedAt };
                },
            },
        ];
        return (0, healthcheck_1.collectBackendHealth)(checks.map((check) => ({
            label: check.label,
            enabled: check.enabled,
            run: check.run,
        })), logger);
    };
    const server = (0, server_1.startHttpServer)({
        host: env.STUDIO_BRAIN_HOST,
        port: env.STUDIO_BRAIN_PORT,
        logger,
        stateStore,
        eventStore,
        requireFreshSnapshotForReady: env.STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY,
        readyMaxSnapshotAgeMinutes: env.STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES,
        getRuntimeStatus: () => ({
            startedAt: runtimeStartedAt,
            scheduler: { ...schedulerState },
            supportEmail: { ...supportEmailState },
            kilnWatch: { ...kilnWatchState },
            retention: {
                enabled: env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE,
                retentionDays: env.STUDIO_BRAIN_RETENTION_DAYS,
            },
            jobs: runner.getStats(),
        }),
        getRuntimeMetrics: () => ({
            scheduler: { ...schedulerState },
            supportEmail: { ...supportEmailState },
            kilnWatch: { ...kilnWatchState },
            retention: {
                enabled: env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE,
                retentionDays: env.STUDIO_BRAIN_RETENTION_DAYS,
            },
            jobs: runner.getStats(),
        }),
        capabilityRuntime,
        allowedOrigins: env.STUDIO_BRAIN_ALLOWED_ORIGINS
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        adminToken: env.STUDIO_BRAIN_ADMIN_TOKEN,
        backendHealth,
        memoryService,
        memoryIngestConfig: {
            enabled: env.STUDIO_BRAIN_MEMORY_INGEST_ENABLED,
            hmacSecret: env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET,
            maxSkewSeconds: env.STUDIO_BRAIN_MEMORY_INGEST_MAX_SKEW_SECONDS,
            requireClientRequestId: env.STUDIO_BRAIN_MEMORY_INGEST_REQUIRE_CLIENT_REQUEST_ID,
            allowedSources: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_SOURCES,
            allowedDiscordGuildIds: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_GUILD_IDS,
            allowedDiscordChannelIds: env.STUDIO_BRAIN_MEMORY_INGEST_ALLOWED_DISCORD_CHANNEL_IDS,
        },
        pilotWriteExecutor: env.STUDIO_BRAIN_ENABLE_WRITE_EXECUTION
            ? (0, pilotWriteExecutor_1.createPilotWriteExecutor)({ functionsBaseUrl: env.STUDIO_BRAIN_FUNCTIONS_BASE_URL })
            : null,
        supportOpsStore,
        artifactStore,
        kilnStore,
        kilnEnabled: env.STUDIO_BRAIN_KILN_ENABLED,
        kilnImportMaxBytes: env.STUDIO_BRAIN_KILN_IMPORT_MAX_BYTES,
        kilnEnableSupportedWrites: env.STUDIO_BRAIN_KILN_ENABLE_SUPPORTED_WRITES,
        kilnObservationProvider,
    });
    const scheduleNext = (delayMs) => {
        if (shuttingDown)
            return;
        const jitterMs = env.STUDIO_BRAIN_JOB_JITTER_MS > 0 ? Math.floor(Math.random() * (env.STUDIO_BRAIN_JOB_JITTER_MS + 1)) : 0;
        const effectiveDelayMs = delayMs + jitterMs;
        schedulerState.nextRunAt = new Date(Date.now() + effectiveDelayMs).toISOString();
        timer = setTimeout(async () => {
            schedulerState.nextRunAt = null;
            await runCompute("scheduled");
            scheduleNext(env.STUDIO_BRAIN_JOB_INTERVAL_MS);
        }, effectiveDelayMs);
        if (typeof timer.unref === "function") {
            timer.unref();
        }
    };
    const scheduleKilnWatchNext = (delayMs) => {
        if (!kilnStore || !env.STUDIO_BRAIN_KILN_ENABLED || !env.STUDIO_BRAIN_KILN_WATCH_ENABLED || shuttingDown)
            return;
        const jitterMs = env.STUDIO_BRAIN_KILN_WATCH_JITTER_MS > 0
            ? Math.floor(Math.random() * (env.STUDIO_BRAIN_KILN_WATCH_JITTER_MS + 1))
            : 0;
        const effectiveDelayMs = delayMs + jitterMs;
        kilnWatchState.nextRunAt = new Date(Date.now() + effectiveDelayMs).toISOString();
        kilnWatchTimer = setTimeout(async () => {
            kilnWatchState.nextRunAt = null;
            await runKilnWatch("scheduled");
            scheduleKilnWatchNext(env.STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS);
        }, effectiveDelayMs);
        if (typeof kilnWatchTimer.unref === "function") {
            kilnWatchTimer.unref();
        }
    };
    const scheduleSupportEmailNext = (delayMs) => {
        if (!supportOpsService || shuttingDown)
            return;
        const jitterMs = env.STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS > 0
            ? Math.floor(Math.random() * (env.STUDIO_BRAIN_SUPPORT_EMAIL_JITTER_MS + 1))
            : 0;
        const effectiveDelayMs = delayMs + jitterMs;
        supportEmailState.nextRunAt = new Date(Date.now() + effectiveDelayMs).toISOString();
        supportEmailTimer = setTimeout(async () => {
            supportEmailState.nextRunAt = null;
            await runSupportEmailSync("scheduled");
            scheduleSupportEmailNext(env.STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS);
        }, effectiveDelayMs);
        if (typeof supportEmailTimer.unref === "function") {
            supportEmailTimer.unref();
        }
    };
    const firstDelayMs = env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS > 0
        ? env.STUDIO_BRAIN_JOB_INITIAL_DELAY_MS
        : env.STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE
            ? env.STUDIO_BRAIN_JOB_INTERVAL_MS
            : 0;
    scheduleNext(firstDelayMs);
    if (kilnStore && env.STUDIO_BRAIN_KILN_ENABLED && env.STUDIO_BRAIN_KILN_WATCH_ENABLED) {
        const firstKilnDelayMs = env.STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS > 0
            ? env.STUDIO_BRAIN_KILN_WATCH_INITIAL_DELAY_MS
            : env.STUDIO_BRAIN_KILN_WATCH_INTERVAL_MS;
        scheduleKilnWatchNext(firstKilnDelayMs);
    }
    if (supportOpsService) {
        const firstSupportDelayMs = env.STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS > 0
            ? env.STUDIO_BRAIN_SUPPORT_EMAIL_INITIAL_DELAY_MS
            : env.STUDIO_BRAIN_SUPPORT_EMAIL_STARTUP_SYNC
                ? env.STUDIO_BRAIN_SUPPORT_EMAIL_SYNC_INTERVAL_MS
                : 0;
        scheduleSupportEmailNext(firstSupportDelayMs);
    }
    if (env.STUDIO_BRAIN_ENABLE_RETENTION_PRUNE) {
        await runPrune("startup");
        pruneInterval = setInterval(() => {
            void runPrune("scheduled");
        }, 24 * 60 * 60 * 1000);
        if (typeof pruneInterval.unref === "function") {
            pruneInterval.unref();
        }
    }
    const shutdown = async (signal, exitCode = 0) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info("studio_brain_shutdown_start", { signal });
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (kilnWatchTimer) {
            clearTimeout(kilnWatchTimer);
            kilnWatchTimer = null;
        }
        if (supportEmailTimer) {
            clearTimeout(supportEmailTimer);
            supportEmailTimer = null;
        }
        if (pruneInterval) {
            clearInterval(pruneInterval);
            pruneInterval = null;
        }
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
        if (orchestrator) {
            await orchestrator.stop();
            orchestrator = null;
        }
        if (eventBus) {
            await eventBus.close();
            eventBus = null;
        }
        if (redisConnection) {
            await redisConnection.close();
            redisConnection = null;
        }
        if (skillSandbox) {
            await skillSandbox.close();
        }
        await dbConnection.close();
        if (processLock) {
            processLock.release();
            processLock = null;
        }
        logger.info("studio_brain_shutdown_complete", {});
        process.exitCode = exitCode;
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("uncaughtException", (error) => {
        logger.error("studio_brain_uncaught_exception", {
            message: error.message,
            stack: error.stack ?? null,
        });
        void shutdown("uncaughtException", 1);
    });
    process.on("unhandledRejection", (reason) => {
        logger.error("studio_brain_unhandled_rejection", {
            message: reason instanceof Error ? reason.message : String(reason),
        });
        void shutdown("unhandledRejection", 1);
    });
}
void main().catch((error) => {
    process.stderr.write(`studio-brain fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
