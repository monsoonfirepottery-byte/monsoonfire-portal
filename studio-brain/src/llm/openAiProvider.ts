import {
  StudioBrainLlmError,
  buildAuditMetadata,
  cleanText,
  type StudioBrainLlmFallbackReason,
  type StudioBrainLlmProvider,
  type StudioBrainLlmRequest,
  type StudioBrainLlmResult,
} from "./types";

export type OpenAiResponsesProviderOptions = {
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function extractOpenAiResponseText(payload: unknown): string {
  const record = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown; type?: unknown }> }>;
  };
  if (typeof record?.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const chunks: string[] = [];
  for (const output of record?.output ?? []) {
    for (const part of output.content ?? []) {
      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }
  return chunks.join("\n").trim();
}
function mapOpenAiFailure(status: number, body: string): StudioBrainLlmFallbackReason {
  const normalized = body.toLowerCase();
  if (status === 429 && /quota|insufficient|billing/.test(normalized)) return "quota";
  if (status === 429) return "rate_limit";
  if (status === 402 || /quota|insufficient_quota|billing/.test(normalized)) return "quota";
  if (status >= 500 && status <= 599) return "5xx";
  return "provider_error";
}

function responsesInputFromRequest(request: StudioBrainLlmRequest): unknown {
  if (request.input !== undefined) return request.input;
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

export function createOpenAiResponsesProvider(options: OpenAiResponsesProviderOptions): StudioBrainLlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = cleanText(options.apiKey);
  const baseUrl = cleanText(options.baseUrl) || "https://api.openai.com/v1";
  const defaultModel = cleanText(options.model) || "gpt-5.4-mini";
  const defaultTimeoutMs = Math.max(500, Math.min(options.timeoutMs ?? 60_000, 120_000));

  return {
    id: "openai.responses",
    async generate(request: StudioBrainLlmRequest): Promise<StudioBrainLlmResult> {
      if (!apiKey) {
        throw new StudioBrainLlmError("OpenAI API key is missing.", "missing_key");
      }
      const startedAt = Date.now();
      const timeoutMs = Math.max(500, Math.min(request.timeoutMs ?? defaultTimeoutMs, 120_000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const model = cleanText(request.model) || defaultModel;
      try {
        const body: Record<string, unknown> = {
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
          throw new StudioBrainLlmError(`OpenAI Responses request failed (${response.status}).`, reason, response.status);
        }
        const payload = JSON.parse(responseText) as unknown;
        const text = extractOpenAiResponseText(payload);
        const latencyMs = Date.now() - startedAt;
        return {
          text,
          provider: "openai.responses",
          model,
          purpose: request.purpose,
          latencyMs,
          audit: buildAuditMetadata({
            request,
            provider: "openai.responses",
            model,
            latencyMs,
            text,
          }),
        };
      } catch (error) {
        if (error instanceof StudioBrainLlmError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new StudioBrainLlmError(`OpenAI Responses request timed out after ${timeoutMs}ms.`, "timeout");
        }
        throw new StudioBrainLlmError(error instanceof Error ? error.message : String(error), "provider_error");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
