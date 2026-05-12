import crypto from "node:crypto";

export type StudioBrainLlmPurpose = "orchestrator" | "quota_fallback" | "private_expression";

export type StudioBrainLlmProviderId = "openai.responses" | "ollama.chat" | "local.expression";

export type StudioBrainLlmFallbackReason =
  | "missing_key"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "5xx"
  | "provider_error";

export type StudioBrainLlmRole = "system" | "user" | "assistant";

export type StudioBrainLlmMessage = {
  role: StudioBrainLlmRole;
  content: string;
};

export type StudioBrainLlmJsonResponseFormat = {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
};

export type StudioBrainLlmRequest = {
  purpose: StudioBrainLlmPurpose;
  input?: string | unknown[];
  messages?: StudioBrainLlmMessage[];
  model?: string | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  responseFormat?: StudioBrainLlmJsonResponseFormat;
  capabilities?: string[];
  allowTools?: boolean;
  allowExternalWrites?: boolean;
  allowPublish?: boolean;
  metadata?: Record<string, unknown>;
};

export type StudioBrainLlmAuditMetadata = {
  provider: StudioBrainLlmProviderId;
  model: string;
  purpose: StudioBrainLlmPurpose;
  latencyMs: number;
  fallbackReason: StudioBrainLlmFallbackReason | null;
  promptHash: string;
  outputHash: string;
  redactionStatus: "raw-not-persisted";
  capabilities: string[];
  allowTools: boolean;
  allowExternalWrites: boolean;
  allowPublish: boolean;
};

export type StudioBrainLlmResult = {
  text: string;
  provider: StudioBrainLlmProviderId;
  model: string;
  purpose: StudioBrainLlmPurpose;
  latencyMs: number;
  fallbackReason?: StudioBrainLlmFallbackReason;
  audit: StudioBrainLlmAuditMetadata;
};

export type StudioBrainLlmProvider = {
  id: StudioBrainLlmProviderId;
  generate: (request: StudioBrainLlmRequest) => Promise<StudioBrainLlmResult>;
};

export class StudioBrainLlmError extends Error {
  readonly reason: StudioBrainLlmFallbackReason;
  readonly status: number | null;

  constructor(message: string, reason: StudioBrainLlmFallbackReason, status: number | null = null) {
    super(message);
    this.name = "StudioBrainLlmError";
    this.reason = reason;
    this.status = status;
  }
}
export function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function clipText(value: unknown, max = 2_000): string {
  const normalized = cleanText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}...`;
}

export function hashForLlmAudit(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function messagesFromRequest(request: StudioBrainLlmRequest): StudioBrainLlmMessage[] {
  if (request.messages && request.messages.length > 0) {
    return request.messages.map((message) => ({
      role: message.role,
      content: cleanText(message.content),
    }));
  }
  if (typeof request.input === "string") {
    return [{ role: "user", content: request.input }];
  }
  if (request.input !== undefined) {
    return [{ role: "user", content: JSON.stringify(request.input) }];
  }
  return [{ role: "user", content: "" }];
}

export function promptHashInput(request: StudioBrainLlmRequest): unknown {
  return {
    purpose: request.purpose,
    input: request.input ?? null,
    messages: request.messages ?? null,
    responseFormat: request.responseFormat ? { name: request.responseFormat.name, schema: request.responseFormat.schema } : null,
    capabilities: request.capabilities ?? [],
    allowTools: request.allowTools === true,
    allowExternalWrites: request.allowExternalWrites === true,
    allowPublish: request.allowPublish === true,
  };
}

export function buildAuditMetadata(input: {
  request: StudioBrainLlmRequest;
  provider: StudioBrainLlmProviderId;
  model: string;
  latencyMs: number;
  text: string;
  fallbackReason?: StudioBrainLlmFallbackReason | null;
}): StudioBrainLlmAuditMetadata {
  return {
    provider: input.provider,
    model: input.model,
    purpose: input.request.purpose,
    latencyMs: input.latencyMs,
    fallbackReason: input.fallbackReason ?? null,
    promptHash: hashForLlmAudit(promptHashInput(input.request)),
    outputHash: hashForLlmAudit(input.text),
    redactionStatus: "raw-not-persisted",
    capabilities: [...(input.request.capabilities ?? [])],
    allowTools: input.request.allowTools === true,
    allowExternalWrites: input.request.allowExternalWrites === true,
    allowPublish: input.request.allowPublish === true,
  };
}
