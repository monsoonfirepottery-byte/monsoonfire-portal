"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOllamaChatProvider = createOllamaChatProvider;
exports.checkOllamaHealth = checkOllamaHealth;
const types_1 = require("./types");
function normalizeBaseUrl(baseUrl) {
    return ((0, types_1.cleanText)(baseUrl) || "http://127.0.0.1:11434").replace(/\/+$/g, "");
}
function buildOllamaMessages(request) {
    const messages = (0, types_1.messagesFromRequest)(request).filter((message) => message.content.length > 0);
    if (!request.responseFormat)
        return messages;
    return [
        {
            role: "system",
            content: [
                "Return only valid JSON for the requested schema.",
                `Schema name: ${request.responseFormat.name}`,
                `JSON schema: ${JSON.stringify(request.responseFormat.schema)}`,
            ].join("\n"),
        },
        ...messages,
    ];
}
function extractOllamaText(payload) {
    const record = payload;
    if (typeof record?.message?.content === "string")
        return record.message.content.trim();
    if (typeof record?.response === "string")
        return record.response.trim();
    return "";
}
async function fetchWithTimeout(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
        return await input.fetchImpl(input.url, {
            ...(input.init ?? {}),
            signal: controller.signal,
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new types_1.StudioBrainLlmError(`Ollama request timed out after ${input.timeoutMs}ms.`, "timeout");
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
function createOllamaChatProvider(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const defaultModel = (0, types_1.cleanText)(options.model) || "gemma4:e4b";
    const defaultTimeoutMs = Math.max(500, Math.min(options.timeoutMs ?? 120_000, 600_000));
    const keepAlive = (0, types_1.cleanText)(options.keepAlive) || "10m";
    const contextWindow = Math.max(1_024, Math.min(options.contextWindow ?? 8_192, 131_072));
    return {
        id: "ollama.chat",
        async generate(request) {
            const startedAt = Date.now();
            const timeoutMs = Math.max(500, Math.min(request.timeoutMs ?? defaultTimeoutMs, 600_000));
            const model = (0, types_1.cleanText)(request.model) || defaultModel;
            try {
                const body = {
                    model,
                    stream: false,
                    keep_alive: keepAlive,
                    messages: buildOllamaMessages(request),
                    options: {
                        num_ctx: contextWindow,
                    },
                };
                if (request.temperature !== undefined) {
                    body.options.temperature = request.temperature;
                }
                if (request.responseFormat) {
                    body.format = "json";
                }
                const response = await fetchWithTimeout({
                    fetchImpl,
                    url: `${baseUrl}/api/chat`,
                    timeoutMs,
                    init: {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body),
                    },
                });
                const responseText = await response.text();
                if (!response.ok) {
                    throw new types_1.StudioBrainLlmError(`Ollama chat failed (${response.status}): ${responseText.slice(0, 300)}`, "provider_error", response.status);
                }
                const payload = JSON.parse(responseText);
                const text = extractOllamaText(payload);
                const latencyMs = Date.now() - startedAt;
                return {
                    text,
                    provider: "ollama.chat",
                    model,
                    purpose: request.purpose,
                    latencyMs,
                    audit: (0, types_1.buildAuditMetadata)({
                        request,
                        provider: "ollama.chat",
                        model,
                        latencyMs,
                        text,
                    }),
                };
            }
            catch (error) {
                if (error instanceof types_1.StudioBrainLlmError)
                    throw error;
                throw new types_1.StudioBrainLlmError(error instanceof Error ? error.message : String(error), "provider_error");
            }
        },
    };
}
async function checkOllamaHealth(input) {
    const fetchImpl = input.fetchImpl ?? fetch;
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const startedAt = Date.now();
    const timeoutMs = Math.max(500, Math.min(input.timeoutMs ?? 4_000, 30_000));
    const selectedModels = {
        default: input.defaultModel,
        heavy: input.heavyModel,
        expression: input.expressionModel,
    };
    try {
        const [versionResponse, tagsResponse] = await Promise.all([
            fetchWithTimeout({ fetchImpl, url: `${baseUrl}/api/version`, timeoutMs }),
            fetchWithTimeout({ fetchImpl, url: `${baseUrl}/api/tags`, timeoutMs }),
        ]);
        const versionText = await versionResponse.text();
        const tagsText = await tagsResponse.text();
        if (!versionResponse.ok) {
            throw new Error(`version endpoint returned ${versionResponse.status}`);
        }
        if (!tagsResponse.ok) {
            throw new Error(`tags endpoint returned ${tagsResponse.status}`);
        }
        const versionPayload = JSON.parse(versionText);
        const tagsPayload = JSON.parse(tagsText);
        const loadedModels = (tagsPayload.models ?? [])
            .map((entry) => (0, types_1.cleanText)(entry.name || entry.model))
            .filter(Boolean);
        return {
            ok: true,
            latencyMs: Date.now() - startedAt,
            baseUrl,
            version: (0, types_1.cleanText)(versionPayload.version) || undefined,
            loadedModels,
            selectedModels,
            fallbackReady: loadedModels.includes(input.defaultModel) || loadedModels.includes(input.heavyModel),
        };
    }
    catch (error) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            baseUrl,
            error: error instanceof Error ? error.message : String(error),
            loadedModels: [],
            selectedModels,
            fallbackReady: false,
        };
    }
}
