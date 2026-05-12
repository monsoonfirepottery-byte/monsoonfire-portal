import test from "node:test";
import assert from "node:assert/strict";
import { LocalAdvisoryOrchestrator } from "./localAdvisoryOrchestrator";
import type { SwarmEventBus } from "./bus/eventBus";

test("local advisory orchestrator emits needs_human advisory events only", async () => {
  const published: Array<Record<string, unknown>> = [];
  const bus: SwarmEventBus = {
    publish: async (event) => {
      published.push(event as Record<string, unknown>);
      return "event-1";
    },
    subscribe: async () => ({ stop: async () => {} }),
    healthcheck: async () => ({ ok: true, latencyMs: 1 }),
    close: async () => {},
  };
  const orchestrator = new LocalAdvisoryOrchestrator({
    bus,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
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

  assert.equal(published.length, 1);
  assert.equal(published[0].type, "agent.message");
  const payload = published[0].payload as Record<string, unknown>;
  assert.equal(payload.state, "needs_human");
  assert.equal(payload.advisory, true);
  assert.equal(payload.noTools, true);
  assert.equal(payload.noExternalWrites, true);
  assert.equal(payload.noPublish, true);
  assert.equal(payload.approvalRequired, true);
});
