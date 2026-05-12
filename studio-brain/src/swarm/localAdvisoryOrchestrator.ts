import type { Logger } from "../config/logger";
import type { StudioBrainLlmRouter } from "../llm/router";
import type { SwarmEventBus } from "./bus/eventBus";
import { getRecentSwarmEvents } from "./store";

export type LocalAdvisoryOrchestratorConfig = {
  swarmId: string;
  runId: string;
  intervalMs: number;
  initialDelayMs: number;
};

export type LocalAdvisoryOrchestratorState = {
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
  nextRunAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastRunDurationMs: number | null;
  totalRuns: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastFailureMessage: string | null;
};

export type LocalAdvisoryOrchestratorContext = {
  bus: SwarmEventBus;
  logger: Logger;
  router: StudioBrainLlmRouter;
  config: LocalAdvisoryOrchestratorConfig;
  getRecentEvents?: typeof getRecentSwarmEvents;
};

function clip(value: unknown, max = 8_000): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const normalized = text.trim();
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(normalized.slice(start, end + 1)) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function proposalArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))).slice(0, 5);
}

export class LocalAdvisoryOrchestrator {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly state: LocalAdvisoryOrchestratorState;

  constructor(private readonly context: LocalAdvisoryOrchestratorContext) {
    this.state = {
      enabled: true,
      intervalMs: context.config.intervalMs,
      initialDelayMs: context.config.initialDelayMs,
      nextRunAt: null,
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastRunDurationMs: null,
      totalRuns: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      lastFailureMessage: null,
    };
  }

  getState(): LocalAdvisoryOrchestratorState {
    return { ...this.state };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.context.logger.info("local_advisory_orchestrator_started", {
      swarmId: this.context.config.swarmId,
      runId: this.context.config.runId,
      intervalMs: this.context.config.intervalMs,
    });
    this.schedule(this.context.config.initialDelayMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.state.nextRunAt = null;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    const effectiveDelayMs = Math.max(0, delayMs);
    this.state.nextRunAt = new Date(Date.now() + effectiveDelayMs).toISOString();
    this.timer = setTimeout(async () => {
      this.state.nextRunAt = null;
      await this.runOnce("scheduled");
      this.schedule(this.context.config.intervalMs);
    }, effectiveDelayMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  async runOnce(trigger = "manual"): Promise<void> {
    const startedAt = Date.now();
    this.state.lastRunStartedAt = new Date(startedAt).toISOString();
    try {
      const recentEvents = await (this.context.getRecentEvents ?? getRecentSwarmEvents)(20);
      const result = await this.context.router.generate({
        purpose: "orchestrator",
        model: undefined,
        maxOutputTokens: 900,
        temperature: 0.2,
        capabilities: [],
        allowTools: false,
        allowExternalWrites: false,
        allowPublish: false,
        responseFormat: {
          name: "studio_brain_local_advisory_proposals",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "proposals"],
            properties: {
              summary: { type: "string", maxLength: 600 },
              proposals: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "rationale", "nextSafeAction", "risk"],
                  properties: {
                    title: { type: "string", maxLength: 120 },
                    rationale: { type: "string", maxLength: 400 },
                    nextSafeAction: { type: "string", maxLength: 240 },
                    risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
                  },
                },
              },
            },
          },
        },
        messages: [
          {
            role: "system",
            content: [
              "You are Studio Brain's local advisory orchestrator.",
              "Read bounded runtime state and propose internal next steps only.",
              "Do not call tools, approve work, publish, mutate state, execute actions, request secrets, or trigger external services.",
              "Every proposal must be advisory and must land as needs_human before action.",
              "Return compact JSON only.",
            ].join("\n"),
          },
          {
            role: "user",
            content: clip(JSON.stringify({
              trigger,
              recentEvents: recentEvents.map((event) => ({
                id: event.id,
                eventType: event.eventType,
                actorId: event.actorId,
                createdAt: event.createdAt,
                payload: event.payload,
              })),
            })),
          },
        ],
      });
      const parsed = extractJsonObject(result.text);
      const proposals = proposalArray(parsed.proposals);
      await this.context.bus.publish({
        type: "agent.message",
        swarmId: this.context.config.swarmId,
        runId: this.context.config.runId,
        actorId: "local-advisory-orchestrator",
        payload: {
          state: "needs_human",
          advisory: true,
          approvalRequired: true,
          noTools: true,
          noExternalWrites: true,
          noPublish: true,
          trigger,
          summary: typeof parsed.summary === "string" ? parsed.summary : clip(result.text, 600),
          proposals,
          llm: {
            provider: result.provider,
            model: result.model,
            latencyMs: result.latencyMs,
            fallbackReason: result.fallbackReason ?? null,
            promptHash: result.audit.promptHash,
            outputHash: result.audit.outputHash,
          },
        },
      });
      this.state.totalRuns += 1;
      this.state.consecutiveFailures = 0;
      this.state.lastFailureMessage = null;
    } catch (error) {
      this.state.totalFailures += 1;
      this.state.consecutiveFailures += 1;
      this.state.lastFailureMessage = error instanceof Error ? error.message : String(error);
      this.context.logger.warn("local_advisory_orchestrator_failed", {
        trigger,
        message: this.state.lastFailureMessage,
      });
    } finally {
      this.state.lastRunCompletedAt = new Date().toISOString();
      this.state.lastRunDurationMs = Date.now() - startedAt;
    }
  }
}
