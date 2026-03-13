"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VertexEmbeddingAdapter = exports.OpenAIEmbeddingAdapter = exports.NullEmbeddingAdapter = void 0;
exports.createEmbeddingAdapterFromEnv = createEmbeddingAdapterFromEnv;
const app_1 = require("firebase-admin/app");
function noOpLogger() {
    return {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    };
}
function parseEmbeddingVector(raw) {
    if (!Array.isArray(raw))
        return null;
    const values = raw.filter((entry) => typeof entry === "number" && Number.isFinite(entry));
    return values.length ? values : null;
}
function clampTimeout(value) {
    return Math.max(500, Math.min(value, 120_000));
}
async function fetchJson(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clampTimeout(timeoutMs));
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const reason = typeof payload?.error?.message === "string"
                ? payload.error.message
                : `HTTP ${response.status}`;
            throw new Error(reason);
        }
        return payload;
    }
    finally {
        clearTimeout(timer);
    }
}
class NullEmbeddingAdapter {
    async embed(_text) {
        return null;
    }
}
exports.NullEmbeddingAdapter = NullEmbeddingAdapter;
class OpenAIEmbeddingAdapter {
    apiKey;
    model;
    dimensions;
    timeoutMs;
    constructor(apiKey, model, dimensions, timeoutMs) {
        this.apiKey = apiKey;
        this.model = model;
        this.dimensions = dimensions;
        this.timeoutMs = timeoutMs;
    }
    async embed(text) {
        const payload = await fetchJson("https://api.openai.com/v1/embeddings", {
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
        }, this.timeoutMs);
        const vector = parseEmbeddingVector(payload?.data?.[0]?.embedding);
        if (!vector) {
            throw new Error("OpenAI embedding response missing embedding vector.");
        }
        return vector;
    }
}
exports.OpenAIEmbeddingAdapter = OpenAIEmbeddingAdapter;
class VertexEmbeddingAdapter {
    projectId;
    location;
    model;
    dimensions;
    timeoutMs;
    logger;
    cachedToken = null;
    tokenExpiresAtMs = 0;
    constructor(projectId, location, model, dimensions, timeoutMs, logger) {
        this.projectId = projectId;
        this.location = location;
        this.model = model;
        this.dimensions = dimensions;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
    }
    async getAccessToken() {
        const now = Date.now();
        if (this.cachedToken && this.tokenExpiresAtMs - now > 60_000) {
            return this.cachedToken;
        }
        const app = (0, app_1.getApps)().length > 0
            ? (0, app_1.getApp)()
            : (0, app_1.initializeApp)({
                credential: (0, app_1.applicationDefault)(),
            });
        const credential = app.options.credential;
        if (!credential || typeof credential.getAccessToken !== "function") {
            throw new Error("Firebase application credentials are unavailable for Vertex embeddings.");
        }
        const token = (await credential.getAccessToken());
        if (!token.access_token) {
            throw new Error("Unable to acquire access token for Vertex embeddings.");
        }
        this.cachedToken = token.access_token;
        this.tokenExpiresAtMs = now + Math.max(60_000, Number(token.expires_in || 300) * 1000);
        return token.access_token;
    }
    async embed(text) {
        const accessToken = await this.getAccessToken();
        const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
            `/locations/${this.location}/publishers/google/models/${this.model}:predict`;
        const payload = await fetchJson(endpoint, {
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
        }, this.timeoutMs);
        const prediction = payload?.predictions?.[0];
        const vector = parseEmbeddingVector(prediction?.embeddings && prediction.embeddings.values) ??
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
exports.VertexEmbeddingAdapter = VertexEmbeddingAdapter;
function createEmbeddingAdapterFromEnv(env, logger = noOpLogger()) {
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
        return new OpenAIEmbeddingAdapter(apiKey, env.STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL, env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS, env.STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS);
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
        return new VertexEmbeddingAdapter(projectId, env.STUDIO_BRAIN_VERTEX_LOCATION, env.STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL, env.STUDIO_BRAIN_EMBEDDING_DIMENSIONS, env.STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS, logger);
    }
    return new NullEmbeddingAdapter();
}
