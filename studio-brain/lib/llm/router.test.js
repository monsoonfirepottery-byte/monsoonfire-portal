"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const router_1 = require("./router");
(0, node_test_1.default)("OpenAI success does not call Ollama", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ output_text: "openai ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const router = (0, router_1.createStudioBrainLlmRouter)({
        openAiApiKey: "sk-test",
        ollamaBaseUrl: "http://127.0.0.1:11434",
        fetchImpl,
    });
    const result = await router.generate({
        purpose: "quota_fallback",
        input: "hello",
        model: "gpt-5.4-mini",
    });
    strict_1.default.equal(result.provider, "openai.responses");
    strict_1.default.equal(result.text, "openai ok");
    strict_1.default.equal(calls.length, 1);
    strict_1.default.equal(calls[0].includes("/api/chat"), false);
});
(0, node_test_1.default)("missing OpenAI key routes to Ollama fallback", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        strict_1.default.equal(String(url).endsWith("/api/chat"), true);
        return new Response(JSON.stringify({ message: { content: "local ok" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const router = (0, router_1.createStudioBrainLlmRouter)({
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
    strict_1.default.equal(result.provider, "ollama.chat");
    strict_1.default.equal(result.model, "qwen3.6:27b");
    strict_1.default.equal(result.fallbackReason, "missing_key");
    strict_1.default.equal(result.text, "local ok");
    strict_1.default.equal(calls.length, 1);
});
(0, node_test_1.default)("429 quota routes to Ollama fallback", async () => {
    let call = 0;
    const fetchImpl = async (url) => {
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
    const router = (0, router_1.createStudioBrainLlmRouter)({
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
    strict_1.default.equal(call, 2);
    strict_1.default.equal(result.provider, "ollama.chat");
    strict_1.default.equal(result.fallbackReason, "quota");
});
(0, node_test_1.default)("private expression strips tools, writes, publish power, and raw persistence", async () => {
    let body = null;
    const fetchImpl = async (_url, init) => {
        body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ message: { content: "private draft" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    const router = (0, router_1.createStudioBrainLlmRouter)({
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
    strict_1.default.equal(result.provider, "local.expression");
    strict_1.default.equal(result.model, "hf.co/example/private:IQ2_M");
    strict_1.default.equal(result.audit.allowTools, false);
    strict_1.default.equal(result.audit.allowExternalWrites, false);
    strict_1.default.equal(result.audit.allowPublish, false);
    strict_1.default.deepEqual(result.audit.capabilities, []);
    strict_1.default.equal(result.audit.redactionStatus, "raw-not-persisted");
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.audit, "rawPrompt"), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.audit, "rawOutput"), false);
    strict_1.default.match(JSON.stringify(body), /private local expression sandbox/i);
    strict_1.default.ok(body);
    strict_1.default.equal(body.think, false);
});
