import test from "node:test";
import assert from "node:assert/strict";
import { createStudioBrainLlmRouter } from "./router";

test("OpenAI success does not call Ollama", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ output_text: "openai ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const router = createStudioBrainLlmRouter({
    openAiApiKey: "sk-test",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    fetchImpl,
  });

  const result = await router.generate({
    purpose: "quota_fallback",
    input: "hello",
    model: "gpt-5.4-mini",
  });

  assert.equal(result.provider, "openai.responses");
  assert.equal(result.text, "openai ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("/api/chat"), false);
});
test("missing OpenAI key routes to Ollama fallback", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    assert.equal(String(url).endsWith("/api/chat"), true);
    return new Response(JSON.stringify({ message: { content: "local ok" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const router = createStudioBrainLlmRouter({
    openAiApiKey: "",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaHeavyModel: "qwen3.6:27b",
    fallbackOn: ["missing_key"],
    fetchImpl,
  });

  const result = await router.generate({
    purpose: "quota_fallback",
    input: "hello",
  });

  assert.equal(result.provider, "ollama.chat");
  assert.equal(result.model, "qwen3.6:27b");
  assert.equal(result.fallbackReason, "missing_key");
  assert.equal(result.text, "local ok");
  assert.equal(calls.length, 1);
});

test("429 quota routes to Ollama fallback", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (url) => {
    call += 1;
    if (String(url).includes("/responses")) {
      return new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: { content: "quota fallback" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const router = createStudioBrainLlmRouter({
    openAiApiKey: "sk-test",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    fallbackOn: ["quota"],
    fetchImpl,
  });

  const result = await router.generate({
    purpose: "quota_fallback",
    input: "hello",
    model: "gpt-5.4-mini",
  });

  assert.equal(call, 2);
  assert.equal(result.provider, "ollama.chat");
  assert.equal(result.fallbackReason, "quota");
});

test("private expression strips tools, writes, publish power, and raw persistence", async () => {
  let body: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: "private draft" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const router = createStudioBrainLlmRouter({
    localExpressionEnabled: true,
    localExpressionAllowPublish: false,
    ollamaExpressionModel: "hf.co/example/private:IQ2_M",
    fetchImpl,
  });

  const result = await router.generate({
    purpose: "private_expression",
    input: "write privately",
    capabilities: ["secrets", "publish"],
    allowTools: true,
    allowExternalWrites: true,
    allowPublish: true,
  });

  assert.equal(result.provider, "local.expression");
  assert.equal(result.model, "hf.co/example/private:IQ2_M");
  assert.equal(result.audit.allowTools, false);
  assert.equal(result.audit.allowExternalWrites, false);
  assert.equal(result.audit.allowPublish, false);
  assert.deepEqual(result.audit.capabilities, []);
  assert.equal(result.audit.redactionStatus, "raw-not-persisted");
  assert.equal(Object.prototype.hasOwnProperty.call(result.audit, "rawPrompt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.audit, "rawOutput"), false);
  assert.match(JSON.stringify(body), /private local expression sandbox/i);
  assert.ok(body);
  assert.equal((body as Record<string, unknown>).think, false);
  const options = (body as { options?: Record<string, unknown> }).options ?? {};
  assert.equal(options.num_predict, 512);
  assert.equal(options.num_thread, 2);
});

test("local fallback clamps Ollama generation and thread options", async () => {
  let body: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ message: { content: "capped local ok" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const router = createStudioBrainLlmRouter({
    openAiApiKey: "",
    fallbackOn: ["missing_key"],
    ollamaMaxOutputTokens: 64,
    ollamaNumThread: 2,
    fetchImpl,
  });

  const result = await router.generate({
    purpose: "quota_fallback",
    input: "hello",
    maxOutputTokens: 999,
  });

  assert.equal(result.provider, "ollama.chat");
  assert.ok(body);
  const options = (body as { options?: Record<string, unknown> }).options ?? {};
  assert.equal(options.num_predict, 64);
  assert.equal(options.num_thread, 2);
});
