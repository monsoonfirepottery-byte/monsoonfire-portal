"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenAiResponsesProvider = createOpenAiResponsesProvider;
const types_1 = require("./types");
function extractOpenAiResponseText(payload) {
    const record = payload;
    if (typeof record?.output_text === "string" && record.output_text.trim()) {
        return record.output_text.trim();
    }
    const chunks = [];
    for (const output of record?.output ?? []) {
        for (const part of output.content ?? []) {
            if (typeof part.text === "string" && part.text.trim()) {
                chunks.push(part.text.trim());
            }
        }
    }
    return chunks.join("\n").trim();
}
function mapOpenAiFailure(status, body) {
    const normalized = body.toLowerCase();
    if (status === 429 && /quota|insufficient|billing/.test(normalized))
        return "quota";
    if (status === 429)
        return "rate_limit";
    if (status === 402 || /quota|insufficient_quota|billing/.test(normalized))
        return "quota";
    if (status >= 500 && status <= 599)
        return "5xx";
    return "provider_error";
}
function responsesInputFromRequest(request) {
    if (request.input !== undefined)
        return request.input;
    return (request.messages ?? []).map((message) => ({
        role: message.role,
        content: [
            {
                type: "input_text",
                text: message.content,
            },
        ],
    }));
}
function createOpenAiResponsesProvider(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const apiKey = (0, types_1.cleanText)(options.apiKey);
    const baseUrl = (0, types_1.cleanText)(options.baseUrl) || "https://api.openai.com/v1";
    const defaultModel = (0, types_1.cleanText)(options.model) || "gpt-5.4-mini";
    const defaultTimeoutMs = Math.max(500, Math.min(options.timeoutMs ?? 60_000, 120_000));
    return {
        id: "openai.responses",
        async generate(request) {
            if (!apiKey) {
                throw new types_1.StudioBrainLlmError("OpenAI API key is missing.", "missing_key");
            }
            const startedAt = Date.now();
            const timeoutMs = Math.max(500, Math.min(request.timeoutMs ?? defaultTimeoutMs, 120_000));
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const model = (0, types_1.cleanText)(request.model) || defaultModel;
            try {
                const body = {
                    model,
                    input: responsesInputFromRequest(request),
                };
                if (request.maxOutputTokens !== undefined) {
                    body.max_output_tokens = request.maxOutputTokens;
                }
                if (request.temperature !== undefined) {
                    body.temperature = request.temperature;
                }
                if (request.responseFormat) {
                    body.text = {
                        format: {
                            type: "json_schema",
                            name: request.responseFormat.name,
                            strict: request.responseFormat.strict ?? true,
                            schema: request.responseFormat.schema,
                        },
                    };
                }
                const response = await fetchImpl(`${baseUrl.replace(/\/+$/g, "")}/responses`, {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                const responseText = await response.text();
                if (!response.ok) {
                    const reason = mapOpenAiFailure(response.status, responseText);
                    throw new types_1.StudioBrainLlmError(`OpenAI Responses request failed (${response.status}).`, reason, response.status);
                }
                const payload = JSON.parse(responseText);
                const text = extractOpenAiResponseText(payload);
                const latencyMs = Date.now() - startedAt;
                return {
                    text,
                    provider: "openai.responses",
                    model,
                    purpose: request.purpose,
                    latencyMs,
                    audit: (0, types_1.buildAuditMetadata)({
                        request,
                        provider: "openai.responses",
                        model,
                        latencyMs,
                        text,
                    }),
                };
            }
            catch (error) {
                if (error instanceof types_1.StudioBrainLlmError)
                    throw error;
                if (error instanceof Error && error.name === "AbortError") {
                    throw new types_1.StudioBrainLlmError(`OpenAI Responses request timed out after ${timeoutMs}ms.`, "timeout");
                }
                throw new types_1.StudioBrainLlmError(error instanceof Error ? error.message : String(error), "provider_error");
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
