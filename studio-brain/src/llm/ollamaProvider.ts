import {
  StudioBrainLlmError,
  buildAuditMetadata,
  cleanText,
  messagesFromRequest,
  type StudioBrainLlmMessage,
  type StudioBrainLlmProvider,
  type StudioBrainLlmRequest,
  type StudioBrainLlmResult,
} from "./types";

export type OllamaChatProviderOptions = {
  baseUrl?: string | null;
  model?: string | null;
  timeoutMs?: number;
  keepAlive?: string | null;
  contextWindow?: number;
  maxOutputTokens?: number;
  numThread?: number;
  fetchImpl?: typeof fetch;
};

export type OllamaHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  baseUrl: string;
  version?: string;
  loadedModels: string[];
  selectedModels: {
    default: string;
    heavy: string;
    expression: string;
  };
  fallbackReady: boolean;
};

function normalizeBaseUrl(baseUrl: string | null | undefined): string {
  return (cleanText(baseUrl) || "http://127.0.0.1:11434").replace(/\/+$/g, "");
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function buildOllamaMessages(request: StudioBrainLlmRequest): StudioBrainLlmMessage[] {
  const messages = messagesFromRequest(request).filter((message) => message.content.length > 0);
  if (!request.responseFormat) return messages;
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

function extractOllamaText(payload: unknown): string {
  const record = payload as {
    message?: { content?: unknown };
    response?: unknown;
  };
  if (typeof record?.message?.content === "string") return record.message.content.trim();
  if (typeof record?.response === "string") return record.response.trim();
  return "";
}

async function fetchWithTimeout(input: {
  fetchImpl: typeof fetch;
  url: string;
  init?: RequestInit;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    return await input.fetchImpl(input.url, {
      ...(input.init ?? {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new StudioBrainLlmError(`Ollama request timed out after ${input.timeoutMs}ms.`, "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaChatProvider(options: OllamaChatProviderOptions): StudioBrainLlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const defaultModel = cleanText(options.model) || "gemma4:e4b";
  const defaultTimeoutMs = Math.max(500, Math.min(options.timeoutMs ?? 120_000, 600_000));
  const keepAlive = cleanText(options.keepAlive) || "10m";
  const contextWindow = Math.max(1_024, Math.min(options.contextWindow ?? 8_192, 131_072));
  const defaultMaxOutputTokens = boundedInt(options.maxOutputTokens, 512, 16, 4_096);
  const numThread = boundedInt(options.numThread, 2, 1, 64);

  return {
    id: "ollama.chat",
    async generate(request: StudioBrainLlmRequest): Promise<StudioBrainLlmResult> {
      const startedAt = Date.now();
      const timeoutMs = Math.max(500, Math.min(request.timeoutMs ?? defaultTimeoutMs, 600_000));
      const model = cleanText(request.model) || defaultModel;
      const maxOutputTokens = request.maxOutputTokens === undefined
        ? defaultMaxOutputTokens
        : Math.min(boundedInt(request.maxOutputTokens, defaultMaxOutputTokens, 1, 4_096), defaultMaxOutputTokens);
      try {
        const body: Record<string, unknown> = {
          model,
          stream: false,
          think: false,
          keep_alive: keepAlive,
          messages: buildOllamaMessages(request),
          options: {
            num_ctx: contextWindow,
            num_predict: maxOutputTokens,
            num_thread: numThread,
          },
        };
        if (request.temperature !== undefined) {
          (body.options as Record<string, unknown>).temperature = request.temperature;
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
          throw new StudioBrainLlmError(`Ollama chat failed (${response.status}): ${responseText.slice(0, 300)}`, "provider_error", response.status);
        }
        const payload = JSON.parse(responseText) as unknown;
        const text = extractOllamaText(payload);
        const latencyMs = Date.now() - startedAt;
        return {
          text,
          provider: "ollama.chat",
          model,
          purpose: request.purpose,
          latencyMs,
          audit: buildAuditMetadata({
            request,
            provider: "ollama.chat",
            model,
            latencyMs,
            text,
          }),
        };
      } catch (error) {
        if (error instanceof StudioBrainLlmError) throw error;
        throw new StudioBrainLlmError(error instanceof Error ? error.message : String(error), "provider_error");
      }
    },
  };
}

export async function checkOllamaHealth(input: {
  baseUrl?: string | null;
  defaultModel: string;
  heavyModel: string;
  expressionModel: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<OllamaHealth> {
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
    const versionPayload = JSON.parse(versionText) as { version?: unknown };
    const tagsPayload = JSON.parse(tagsText) as { models?: Array<{ name?: unknown; model?: unknown }> };
    const loadedModels = (tagsPayload.models ?? [])
      .map((entry) => cleanText(entry.name || entry.model))
      .filter(Boolean);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      baseUrl,
      version: cleanText(versionPayload.version) || undefined,
      loadedModels,
      selectedModels,
      fallbackReady: loadedModels.includes(input.defaultModel) || loadedModels.includes(input.heavyModel),
    };
  } catch (error) {
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
