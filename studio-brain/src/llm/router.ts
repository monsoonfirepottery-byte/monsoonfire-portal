import { buildPrivateExpressionSandboxRequest } from "./expressionSandbox";
import { createOllamaChatProvider } from "./ollamaProvider";
import { createOpenAiResponsesProvider } from "./openAiProvider";
import {
  StudioBrainLlmError,
  buildAuditMetadata,
  cleanText,
  type StudioBrainLlmFallbackReason,
  type StudioBrainLlmRequest,
  type StudioBrainLlmResult,
} from "./types";

export type StudioBrainLlmRouterConfig = {
  openAiApiKey?: string | null;
  openAiModel?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaDefaultModel?: string | null;
  ollamaHeavyModel?: string | null;
  ollamaExpressionModel?: string | null;
  ollamaKeepAlive?: string | null;
  ollamaContextWindow?: number;
  timeoutMs?: number;
  fallbackOn?: StudioBrainLlmFallbackReason[];
  localExpressionEnabled?: boolean;
  localExpressionAllowPublish?: boolean;
  fetchImpl?: typeof fetch;
};

export type StudioBrainLlmRouter = {
  generate: (request: StudioBrainLlmRequest) => Promise<StudioBrainLlmResult>;
};

const DEFAULT_FALLBACK_REASONS: StudioBrainLlmFallbackReason[] = [
  "missing_key",
  "quota",
  "rate_limit",
  "timeout",
  "5xx",
];

function csv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => cleanText(entry)).filter(Boolean);
  return cleanText(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fallbackReasonsFromConfig(value: unknown): StudioBrainLlmFallbackReason[] {
  const allowed = new Set<StudioBrainLlmFallbackReason>([
    "missing_key",
    "quota",
    "rate_limit",
    "timeout",
    "5xx",
    "provider_error",
  ]);
  const parsed = csv(value).filter((entry): entry is StudioBrainLlmFallbackReason => allowed.has(entry as StudioBrainLlmFallbackReason));
  return parsed.length > 0 ? parsed : DEFAULT_FALLBACK_REASONS;
}

function localModelForPurpose(config: RequiredConfig, request: StudioBrainLlmRequest): string {
  if (request.purpose === "orchestrator") return config.ollamaDefaultModel;
  return config.ollamaHeavyModel || config.ollamaDefaultModel;
}

type RequiredConfig = {
  openAiApiKey: string;
  openAiModel: string;
  ollamaBaseUrl: string;
  ollamaDefaultModel: string;
  ollamaHeavyModel: string;
  ollamaExpressionModel: string;
  ollamaKeepAlive: string;
  ollamaContextWindow: number;
  timeoutMs: number;
  fallbackOn: Set<StudioBrainLlmFallbackReason>;
  localExpressionEnabled: boolean;
  localExpressionAllowPublish: boolean;
  fetchImpl: typeof fetch;
};

function normalizeConfig(config: StudioBrainLlmRouterConfig): RequiredConfig {
  return {
    openAiApiKey: cleanText(config.openAiApiKey),
    openAiModel: cleanText(config.openAiModel) || "gpt-5.4-mini",
    ollamaBaseUrl: cleanText(config.ollamaBaseUrl) || "http://127.0.0.1:11434",
    ollamaDefaultModel: cleanText(config.ollamaDefaultModel) || "gemma4:e4b",
    ollamaHeavyModel: cleanText(config.ollamaHeavyModel) || "qwen3.6:27b",
    ollamaExpressionModel:
      cleanText(config.ollamaExpressionModel)
      || "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M",
    ollamaKeepAlive: cleanText(config.ollamaKeepAlive) || "10m",
    ollamaContextWindow: Math.max(1_024, Math.min(config.ollamaContextWindow ?? 8_192, 131_072)),
    timeoutMs: Math.max(500, Math.min(config.timeoutMs ?? 120_000, 600_000)),
    fallbackOn: new Set(config.fallbackOn?.length ? config.fallbackOn : DEFAULT_FALLBACK_REASONS),
    localExpressionEnabled: config.localExpressionEnabled === true,
    localExpressionAllowPublish: config.localExpressionAllowPublish === true,
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

async function localFallback(input: {
  request: StudioBrainLlmRequest;
  config: RequiredConfig;
  reason: StudioBrainLlmFallbackReason;
}): Promise<StudioBrainLlmResult> {
  const model = localModelForPurpose(input.config, input.request);
  const provider = createOllamaChatProvider({
    baseUrl: input.config.ollamaBaseUrl,
    model,
    timeoutMs: input.config.timeoutMs,
    keepAlive: input.config.ollamaKeepAlive,
    contextWindow: input.config.ollamaContextWindow,
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

export function createStudioBrainLlmRouter(configInput: StudioBrainLlmRouterConfig): StudioBrainLlmRouter {
  const config = normalizeConfig(configInput);

  return {
    async generate(request: StudioBrainLlmRequest): Promise<StudioBrainLlmResult> {
      if (request.purpose === "private_expression") {
        if (!config.localExpressionEnabled) {
          throw new StudioBrainLlmError("Private expression sandbox is disabled.", "provider_error");
        }
        const sandboxed = buildPrivateExpressionSandboxRequest(
          request,
          config.ollamaExpressionModel,
        );
        const provider = createOllamaChatProvider({
          baseUrl: config.ollamaBaseUrl,
          model: config.ollamaExpressionModel,
          timeoutMs: config.timeoutMs,
          keepAlive: config.ollamaKeepAlive,
          contextWindow: config.ollamaContextWindow,
          fetchImpl: config.fetchImpl,
        });
        const result = await provider.generate(sandboxed);
        return {
          ...result,
          provider: "local.expression",
          model: sandboxed.model ?? config.ollamaExpressionModel,
          audit: buildAuditMetadata({
            request: sandboxed,
            provider: "local.expression",
            model: sandboxed.model ?? config.ollamaExpressionModel,
            latencyMs: result.latencyMs,
            text: result.text,
          }),
        };
      }

      const openAi = createOpenAiResponsesProvider({
        apiKey: config.openAiApiKey,
        model: cleanText(request.model) || config.openAiModel,
        timeoutMs: Math.min(config.timeoutMs, 120_000),
        fetchImpl: config.fetchImpl,
      });

      try {
        return await openAi.generate(request);
      } catch (error) {
        const reason = error instanceof StudioBrainLlmError ? error.reason : "provider_error";
        if (!config.fallbackOn.has(reason)) {
          throw error;
        }
        return await localFallback({ request, config, reason });
      }
    },
  };
}

export function createStudioBrainLlmRouterFromEnv(
  env: Record<string, unknown> = process.env,
  options: { fetchImpl?: typeof fetch; openAiApiKey?: string | null } = {},
): StudioBrainLlmRouter {
  return createStudioBrainLlmRouter({
    openAiApiKey:
      cleanText(options.openAiApiKey)
      || cleanText(env.STUDIO_BRAIN_OPENAI_API_KEY)
      || cleanText(env.OPENAI_API_KEY),
    openAiModel: cleanText(env.STUDIO_BRAIN_OPENAI_DEFAULT_MODEL) || "gpt-5.4-mini",
    ollamaBaseUrl: cleanText(env.STUDIO_BRAIN_OLLAMA_BASE_URL) || "http://127.0.0.1:11434",
    ollamaDefaultModel: cleanText(env.STUDIO_BRAIN_OLLAMA_DEFAULT_MODEL) || "gemma4:e4b",
    ollamaHeavyModel: cleanText(env.STUDIO_BRAIN_OLLAMA_HEAVY_MODEL) || "qwen3.6:27b",
    ollamaExpressionModel:
      cleanText(env.STUDIO_BRAIN_OLLAMA_EXPRESSION_MODEL)
      || "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M",
    ollamaKeepAlive: cleanText(env.STUDIO_BRAIN_OLLAMA_KEEP_ALIVE) || "10m",
    ollamaContextWindow: numberValue(env.STUDIO_BRAIN_OLLAMA_CONTEXT_WINDOW, 8_192),
    timeoutMs: numberValue(env.STUDIO_BRAIN_OLLAMA_TIMEOUT_MS, 120_000),
    fallbackOn: fallbackReasonsFromConfig(env.STUDIO_BRAIN_LLM_FALLBACK_ON),
    localExpressionEnabled: boolValue(env.STUDIO_BRAIN_LOCAL_EXPRESSION_ENABLED, false),
    localExpressionAllowPublish: boolValue(env.STUDIO_BRAIN_LOCAL_EXPRESSION_ALLOW_PUBLISH, false),
    fetchImpl: options.fetchImpl,
  });
}

export function hasStudioBrainLlmLocalFallbackConfigured(env: Record<string, unknown> = process.env): boolean {
  return Boolean(cleanText(env.STUDIO_BRAIN_OLLAMA_BASE_URL));
}

export function isStudioBrainLlmConfigured(env: Record<string, unknown> = process.env): boolean {
  return Boolean(
    cleanText(env.STUDIO_BRAIN_OPENAI_API_KEY)
    || cleanText(env.OPENAI_API_KEY)
    || hasStudioBrainLlmLocalFallbackConfigured(env),
  );
}
