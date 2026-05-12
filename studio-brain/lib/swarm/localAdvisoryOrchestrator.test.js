"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const localAdvisoryOrchestrator_1 = require("./localAdvisoryOrchestrator");
(0, node_test_1.default)("local advisory orchestrator emits needs_human advisory events only", async () => {
    const published = [];
    const bus = {
        publish: async (event) => {
            published.push(event);
            return "event-1";
        },
        subscribe: async () => ({ stop: async () => { } }),
        healthcheck: async () => ({ ok: true, latencyMs: 1 }),
        close: async () => { },
    };
    const orchestrator = new localAdvisoryOrchestrator_1.LocalAdvisoryOrchestrator({
        bus,
        logger: {
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
        },
        router: {
            generate: async (request) => ({
                text: JSON.stringify({
                    summary: "One bounded advisory proposal.",
                    proposals: [
                        {
                            title: "Review stalled support draft",
                            rationale: "Recent events show a pending handoff.",
                            nextSafeAction: "Ask a human to approve or redirect the draft.",
                            risk: "medium",
                        },
                    ],
                }),
                provider: "ollama.chat",
                model: "gemma4:e4b",
                purpose: request.purpose,
                latencyMs: 1,
                audit: {
                    provider: "ollama.chat",
                    model: "gemma4:e4b",
                    purpose: request.purpose,
                    latencyMs: 1,
                    fallbackReason: null,
                    promptHash: "prompt",
                    outputHash: "output",
                    redactionStatus: "raw-not-persisted",
                    capabilities: request.capabilities ?? [],
                    allowTools: request.allowTools === true,
                    allowExternalWrites: request.allowExternalWrites === true,
                    allowPublish: request.allowPublish === true,
                },
            }),
        },
        config: {
            swarmId: "default-swarm",
            runId: "run-1",
            intervalMs: 60_000,
            initialDelayMs: 0,
        },
        getRecentEvents: async () => [],
    });
    await orchestrator.runOnce("test");
    strict_1.default.equal(published.length, 1);
    strict_1.default.equal(published[0].type, "agent.message");
    const payload = published[0].payload;
    strict_1.default.equal(payload.state, "needs_human");
    strict_1.default.equal(payload.advisory, true);
    strict_1.default.equal(payload.noTools, true);
    strict_1.default.equal(payload.noExternalWrites, true);
    strict_1.default.equal(payload.noPublish, true);
    strict_1.default.equal(payload.approvalRequired, true);
});
