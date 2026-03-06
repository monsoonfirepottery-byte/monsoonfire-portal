import { applicationDefault, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { BrainEnv } from "../config/env";
import type { Logger } from "../config/logger";

export type EmbeddingAdapter = {
  embed: (text: string) => Promise<number[] | null>;
};

type MinimalEmbeddingEnv = Pick<
  BrainEnv,
  | "STUDIO_BRAIN_EMBEDDING_PROVIDER"
  | "STUDIO_BRAIN_EMBEDDING_DIMENSIONS"
  | "STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS"
  | "STUDIO_BRAIN_OPENAI_API_KEY"
  | "STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL"
  | "STUDIO_BRAIN_VERTEX_PROJECT_ID"
  | "STUDIO_BRAIN_VERTEX_LOCATION"
  | "STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL"
  | "FIREBASE_PROJECT_ID"
>;

type GoogleOAuthAccessToken = {
  access_token: string;
  expires_in: number;
};

function noOpLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function parseEmbeddingVector(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return values.length ? values : null;
}

function clampTimeout(value: number): number {
  return Math.max(500, Math.min(value, 120_000));
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampTimeout(timeoutMs));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason =
        typeof (payload as { error?: { message?: string } })?.error?.message === "string"
          ? (payload as { error: { message: string } }).error.message
          : `HTTP ${response.status}`;
      throw new Error(reason);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export class NullEmbeddingAdapter implements EmbeddingAdapter {
  async embed(_text: string): Promise<number[] | null> {
    return null;
  }
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly timeoutMs: number
  ) {}

  async embed(text: string): Promise<number[] | null> {
    const payload = await fetchJson(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          dimensions: this.dimensions,
        }),
      },
      this.timeoutMs
    );
    const vector = parseEmbeddingVector((payload as { data?: Array<{ embedding?: unknown }> })?.data?.[0]?.embedding);
    if (!vector) {
      throw new Error("OpenAI embedding response missing embedding vector.");
    }
    return vector;
  }
}

export class VertexEmbeddingAdapter implements EmbeddingAdapter {
  private cachedToken: string | null = null;
  private tokenExpiresAtMs = 0;

  constructor(
    private readonly projectId: string,
    private readonly location: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly timeoutMs: number,
    private readonly logger: Logger
  ) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAtMs - now > 60_000) {
      return this.cachedToken;
    }

    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            credential: applicationDefault(),
          });
    const credential = app.options.credential;
    if (!credential || typeof credential.getAccessToken !== "function") {
      throw new Error("Firebase application credentials are unavailable for Vertex embeddings.");
    }

    const token = (await credential.getAccessToken()) as GoogleOAuthAccessToken;
    if (!token.access_token) {
      throw new Error("Unable to acquire access token for Vertex embeddings.");
    }

    this.cachedToken = token.access_token;
    this.tokenExpiresAtMs = now + Math.max(60_000, Number(token.expires_in || 300) * 1000);
    return token.access_token;
  }

  async embed(text: string): Promise<number[] | null> {
    const accessToken = await this.getAccessToken();
    const endpoint =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
      `/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    const payload = await fetchJson(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          instances: [{ content: text }],
          parameters: {
            outputDimensionality: this.dimensions,
          },
        }),
      },
      this.timeoutMs
    );

    const prediction = (payload as { predictions?: Array<Record<string, unknown>> })?.predictions?.[0];
    const vector =
      parseEmbeddingVector(prediction?.embeddings && (prediction.embeddings as { values?: unknown }).values) ??
      parseEmbeddingVector(prediction?.values) ??
      parseEmbeddingVector(prediction?.embedding);
    if (!vector) {
      this.logger.warn("vertex_embedding_unexpected_shape", {
        keys: prediction ? Object.keys(prediction) : [],
      });
      throw new Error("Vertex embedding response missing embedding vector.");
    }
    return vector;
  }
}

export function createEmbeddingAdapterFromEnv(env: MinimalEmbeddingEnv, logger: Logger = noOpLogger()): EmbeddingAdapter {
  const provider = env.STUDIO_BRAIN_EMBEDDING_PROVIDER;
  if (provider === "openai") {
    const apiKey = String(env.STUDIO_BRAIN_OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      logger.warn("embedding_provider_openai_missing_api_key", {
        provider,
        fallback: "none",
      });
      return new NullEmbeddingAdapter();
    }
    return new OpenAIEmbeddingAdapter(
      apiKey,
      env.STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL,
      env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS,
      env.STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS
    );
  }
  if (provider === "vertex") {
    const projectId = String(env.STUDIO_BRAIN_VERTEX_PROJECT_ID || env.FIREBASE_PROJECT_ID || "").trim();
    if (!projectId) {
      logger.warn("embedding_provider_vertex_missing_project_id", {
        provider,
        fallback: "none",
      });
      return new NullEmbeddingAdapter();
    }
    return new VertexEmbeddingAdapter(
      projectId,
      env.STUDIO_BRAIN_VERTEX_LOCATION,
      env.STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL,
      env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS,
      env.STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS,
      logger
    );
  }
  return new NullEmbeddingAdapter();
}
