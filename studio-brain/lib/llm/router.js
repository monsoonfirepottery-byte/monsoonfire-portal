"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudioBrainLlmRouter = createStudioBrainLlmRouter;
exports.createStudioBrainLlmRouterFromEnv = createStudioBrainLlmRouterFromEnv;
exports.hasStudioBrainLlmLocalFallbackConfigured = hasStudioBrainLlmLocalFallbackConfigured;
exports.isStudioBrainLlmConfigured = isStudioBrainLlmConfigured;
const expressionSandbox_1 = require("./expressionSandbox");
const ollamaProvider_1 = require("./ollamaProvider");
const openAiProvider_1 = require("./openAiProvider");
const types_1 = require("./types");
const DEFAULT_FALLBACK_REASONS = [
    "missing_key",
    "quota",
    "rate_limit",
    "timeout",
    "5xx",
];
function csv(value) {
    if (Array.isArray(value))
        return value.map((entry) => (0, types_1.cleanText)(entry)).filter(Boolean);
    return (0, types_1.cleanText)(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function boolValue(value, fallback = false) {
    if (typeof value === "boolean")
        return value;
    const normalized = (0, types_1.cleanText)(value).toLowerCase();
    if (!normalized)
        return fallback;
    return ["1", "true", "yes", "on"].includes(normalized);
}
function numberValue(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function boundedInt(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(min, Math.min(Math.trunc(parsed), max));
}
function fallbackReasonsFromConfig(value) {
    const allowed = new Set([
        "missing_key",
        "quota",
        "rate_limit",
        "timeout",
        "5xx",
        "provider_error",
    ]);
    const parsed = csv(value).filter((entry) => allowed.has(entry));
    return parsed.length > 0 ? parsed : DEFAULT_FALLBACK_REASONS;
}
function localModelForPurpose(config, request) {
    if (request.purpose === "orchestrator")
        return config.ollamaDefaultModel;
    return config.ollamaHeavyModel || config.ollamaDefaultModel;
}
function normalizeConfig(config) {
    return {
        openAiApiKey: (0, types_1.cleanText)(config.openAiApiKey),
        openAiModel: (0, types_1.cleanText)(config.openAiModel) || "gpt-5.4-mini",
        ollamaBaseUrl: (0, types_1.cleanText)(config.ollamaBaseUrl) || "http://127.0.0.1:11434",
        ollamaDefaultModel: (0, types_1.cleanText)(config.ollamaDefaultModel) || "gemma4:e4b",
        ollamaHeavyModel: (0, types_1.cleanText)(config.ollamaHeavyModel) || "qwen3.6:27b",
        ollamaExpressionModel: (0, types_1.cleanText)(config.ollamaExpressionModel)
            || "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M",
        ollamaKeepAlive: (0, types_1.cleanText)(config.ollamaKeepAlive) || "10m",
        ollamaContextWindow: Math.max(1_024, Math.min(config.ollamaContextWindow ?? 8_192, 131_072)),
        ollamaMaxOutputTokens: boundedInt(config.ollamaMaxOutputTokens, 512, 16, 4_096),
        ollamaNumThread: boundedInt(config.ollamaNumThread, 2, 1, 64),
        timeoutMs: Math.max(500, Math.min(config.timeoutMs ?? 120_000, 600_000)),
        fallbackOn: new Set(config.fallbackOn?.length ? config.fallbackOn : DEFAULT_FALLBACK_REASONS),
        localExpressionEnabled: config.localExpressionEnabled === true,
        localExpressionAllowPublish: config.localExpressionAllowPublish === true,
        fetchImpl: config.fetchImpl ?? fetch,
    };
}
async function localFallback(input) {
    const model = localModelForPurpose(input.config, input.request);
    const provider = (0, ollamaProvider_1.createOllamaChatProvider)({
        baseUrl: input.config.ollamaBaseUrl,
        model,
        timeoutMs: input.config.timeoutMs,
        keepAlive: input.config.ollamaKeepAlive,
        contextWindow: input.config.ollamaContextWindow,
        maxOutputTokens: input.config.ollamaMaxOutputTokens,
        numThread: input.config.ollamaNumThread,
        fetchImpl: input.config.fetchImpl,
    });
    const result = await provider.generate({
        ...input.request,
        model,
        allowTools: false,
        allowExternalWrites: false,
        allowPublish: false,
    });
    return {
        ...result,
        fallbackReason: input.reason,
        audit: {
            ...result.audit,
            fallbackReason: input.reason,
        },
    };
}
function createStudioBrainLlmRouter(configInput) {
    const config = normalizeConfig(configInput);
    return {
        async generate(request) {
            if (request.purpose === "private_expression") {
                if (!config.localExpressionEnabled) {
                    throw new types_1.StudioBrainLlmError("Private expression sandbox is disabled.", "provider_error");
                }
                const sandboxed = (0, expressionSandbox_1.buildPrivateExpressionSandboxRequest)(request, config.ollamaExpressionModel);
                const provider = (0, ollamaProvider_1.createOllamaChatProvider)({
                    baseUrl: config.ollamaBaseUrl,
                    model: config.ollamaExpressionModel,
                    timeoutMs: config.timeoutMs,
                    keepAlive: config.ollamaKeepAlive,
                    contextWindow: config.ollamaContextWindow,
                    maxOutputTokens: config.ollamaMaxOutputTokens,
                    numThread: config.ollamaNumThread,
                    fetchImpl: config.fetchImpl,
                });
                const result = await provider.generate(sandboxed);
                return {
                    ...result,
                    provider: "local.expression",
                    model: sandboxed.model ?? config.ollamaExpressionModel,
                    audit: (0, types_1.buildAuditMetadata)({
                        request: sandboxed,
                        provider: "local.expression",
                        model: sandboxed.model ?? config.ollamaExpressionModel,
                        latencyMs: result.latencyMs,
                        text: result.text,
                    }),
                };
            }
            const openAi = (0, openAiProvider_1.createOpenAiResponsesProvider)({
                apiKey: config.openAiApiKey,
                model: (0, types_1.cleanText)(request.model) || config.openAiModel,
                timeoutMs: Math.min(config.timeoutMs, 120_000),
                fetchImpl: config.fetchImpl,
            });
            try {
                return await openAi.generate(request);
            }
            catch (error) {
                const reason = error instanceof types_1.StudioBrainLlmError ? error.reason : "provider_error";
                if (!config.fallbackOn.has(reason)) {
                    throw error;
                }
                return await localFallback({ request, config, reason });
            }
        },
    };
}
function createStudioBrainLlmRouterFromEnv(env = process.env, options = {}) {
    return createStudioBrainLlmRouter({
        openAiApiKey: (0, types_1.cleanText)(options.openAiApiKey)
            || (0, types_1.cleanText)(env.STUDIO_BRAIN_OPENAI_API_KEY)
            || (0, types_1.cleanText)(env.OPENAI_API_KEY),
        openAiModel: (0, types_1.cleanText)(env.STUDIO_BRAIN_OPENAI_DEFAULT_MODEL) || "gpt-5.4-mini",
        ollamaBaseUrl: (0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_BASE_URL) || "http://127.0.0.1:11434",
        ollamaDefaultModel: (0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_DEFAULT_MODEL) || "gemma4:e4b",
        ollamaHeavyModel: (0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_HEAVY_MODEL) || "qwen3.6:27b",
        ollamaExpressionModel: (0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_EXPRESSION_MODEL)
            || "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M",
        ollamaKeepAlive: (0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_KEEP_ALIVE) || "10m",
        ollamaContextWindow: numberValue(env.STUDIO_BRAIN_OLLAMA_CONTEXT_WINDOW, 8_192),
        ollamaMaxOutputTokens: numberValue(env.STUDIO_BRAIN_OLLAMA_MAX_OUTPUT_TOKENS, 512),
        ollamaNumThread: numberValue(env.STUDIO_BRAIN_OLLAMA_NUM_THREAD, 2),
        timeoutMs: numberValue(env.STUDIO_BRAIN_OLLAMA_TIMEOUT_MS, 120_000),
        fallbackOn: fallbackReasonsFromConfig(env.STUDIO_BRAIN_LLM_FALLBACK_ON),
        localExpressionEnabled: boolValue(env.STUDIO_BRAIN_LOCAL_EXPRESSION_ENABLED, false),
        localExpressionAllowPublish: boolValue(env.STUDIO_BRAIN_LOCAL_EXPRESSION_ALLOW_PUBLISH, false),
        fetchImpl: options.fetchImpl,
    });
}
function hasStudioBrainLlmLocalFallbackConfigured(env = process.env) {
    return Boolean((0, types_1.cleanText)(env.STUDIO_BRAIN_OLLAMA_BASE_URL));
}
function isStudioBrainLlmConfigured(env = process.env) {
    return Boolean((0, types_1.cleanText)(env.STUDIO_BRAIN_OPENAI_API_KEY)
        || (0, types_1.cleanText)(env.OPENAI_API_KEY)
        || hasStudioBrainLlmLocalFallbackConfigured(env));
}
