"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const embedding_1 = require("./embedding");
(0, node_test_1.default)("createEmbeddingAdapterFromEnv returns null adapter for provider none", async () => {
    const adapter = (0, embedding_1.createEmbeddingAdapterFromEnv)({
        STUDIO_BRAIN_EMBEDDING_PROVIDER: "none",
        STUDIO_BRAIN_EMBEDDING_DIMENSIONS: 1536,
        STUDIO_BRAIN_EMBEDDING_TIMEOUT_MS: 1000,
        STUDIO_BRAIN_OPENAI_API_KEY: undefined,
        STUDIO_BRAIN_OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
        STUDIO_BRAIN_VERTEX_PROJECT_ID: undefined,
        STUDIO_BRAIN_VERTEX_LOCATION: "us-central1",
        STUDIO_BRAIN_VERTEX_EMBEDDING_MODEL: "text-embedding-005",
        FIREBASE_PROJECT_ID: undefined,
    });
    strict_1.default.ok(adapter instanceof embedding_1.NullEmbeddingAdapter);
    strict_1.default.equal(await adapter.embed("hello"), null);
});
(0, node_test_1.default)("OpenAIEmbeddingAdapter calls embeddings endpoint", async () => {
    const originalFetch = globalThis.fetch;
    try {
        let called = false;
        globalThis.fetch = (async (input, init) => {
            called = true;
            strict_1.default.equal(String(input), "https://api.openai.com/v1/embeddings");
            strict_1.default.equal(init?.headers?.authorization, "Bearer sk-test");
            const body = JSON.parse(String(init?.body ?? "{}"));
            strict_1.default.equal(body.model, "text-embedding-3-small");
            strict_1.default.equal(body.input, "hello world");
            strict_1.default.equal(body.dimensions, 1536);
            return new Response(JSON.stringify({
                data: [{ embedding: [0.1, 0.2, 0.3] }],
            }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        });
        const adapter = new embedding_1.OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small", 1536, 1000);
        const vector = await adapter.embed("hello world");
        strict_1.default.equal(called, true);
        strict_1.default.deepEqual(vector, [0.1, 0.2, 0.3]);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, node_test_1.default)("VertexEmbeddingAdapter parses embedding values", async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async (_input, init) => {
            strict_1.default.equal(init?.headers?.authorization, "Bearer vertex-token");
            return new Response(JSON.stringify({
                predictions: [
                    {
                        embeddings: {
                            values: [0.9, 0.8, 0.7],
                        },
                    },
                ],
            }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        });
        const adapter = new embedding_1.VertexEmbeddingAdapter("monsoonfire-portal", "us-central1", "text-embedding-005", 1536, 1000, { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } });
        // Test-only token bypass to avoid external credential dependency.
        adapter.getAccessToken = async () => "vertex-token";
        const vector = await adapter.embed("test");
        strict_1.default.deepEqual(vector, [0.9, 0.8, 0.7]);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
