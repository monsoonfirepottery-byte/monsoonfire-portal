import test from "node:test";
import assert from "node:assert/strict";
import {
  NullEmbeddingAdapter,
  OpenAIEmbeddingAdapter,
  VertexEmbeddingAdapter,
  createEmbeddingAdapterFromEnv,
} from "./embedding";

test("createEmbeddingAdapterFromEnv returns null adapter for provider none", async () => {
  const adapter = createEmbeddingAdapterFromEnv({
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
  assert.ok(adapter instanceof NullEmbeddingAdapter);
  assert.equal(await adapter.embed("hello"), null);
});

test("OpenAIEmbeddingAdapter calls embeddings endpoint", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let called = false;
    globalThis.fetch = (async (input, init) => {
      called = true;
      assert.equal(String(input), "https://api.openai.com/v1/embeddings");
      assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer sk-test");
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.model, "text-embedding-3-small");
      assert.equal(body.input, "hello world");
      assert.equal(body.dimensions, 1536);
      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as typeof fetch;

    const adapter = new OpenAIEmbeddingAdapter("sk-test", "text-embedding-3-small", 1536, 1000);
    const vector = await adapter.embed("hello world");
    assert.equal(called, true);
    assert.deepEqual(vector, [0.1, 0.2, 0.3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("VertexEmbeddingAdapter parses embedding values", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer vertex-token");
      return new Response(
        JSON.stringify({
          predictions: [
            {
              embeddings: {
                values: [0.9, 0.8, 0.7],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as typeof fetch;

    const adapter = new VertexEmbeddingAdapter(
      "monsoonfire-portal",
      "us-central1",
      "text-embedding-005",
      1536,
      1000,
      { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    );
    // Test-only token bypass to avoid external credential dependency.
    (adapter as unknown as { getAccessToken: () => Promise<string> }).getAccessToken = async () => "vertex-token";

    const vector = await adapter.embed("test");
    assert.deepEqual(vector, [0.9, 0.8, 0.7]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
