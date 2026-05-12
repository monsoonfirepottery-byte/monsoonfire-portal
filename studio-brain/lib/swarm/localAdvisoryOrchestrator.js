"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAdvisoryOrchestrator = void 0;
const store_1 = require("./store");
function clip(value, max = 8_000) {
    const normalized = String(value ?? "").trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}
function extractJsonObject(text) {
    const normalized = text.trim();
    if (!normalized)
        return {};
    try {
        const parsed = JSON.parse(normalized);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        const start = normalized.indexOf("{");
        const end = normalized.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                const parsed = JSON.parse(normalized.slice(start, end + 1));
                return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            }
            catch {
                return {};
            }
        }
        return {};
    }
}
function proposalArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((entry) => Boolean(entry && typeof entry === "object" && !Array.isArray(entry))).slice(0, 5);
}
class LocalAdvisoryOrchestrator {
    context;
    timer = null;
    running = false;
    state;
    constructor(context) {
        this.context = context;
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
    getState() {
        return { ...this.state };
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.context.logger.info("local_advisory_orchestrator_started", {
            swarmId: this.context.config.swarmId,
            runId: this.context.config.runId,
            intervalMs: this.context.config.intervalMs,
        });
        this.schedule(this.context.config.initialDelayMs);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.state.nextRunAt = null;
    }
    schedule(delayMs) {
        if (!this.running)
            return;
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
    async runOnce(trigger = "manual") {
        const startedAt = Date.now();
        this.state.lastRunStartedAt = new Date(startedAt).toISOString();
        try {
            const recentEvents = await (this.context.getRecentEvents ?? store_1.getRecentSwarmEvents)(20);
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
        }
        catch (error) {
            this.state.totalFailures += 1;
            this.state.consecutiveFailures += 1;
            this.state.lastFailureMessage = error instanceof Error ? error.message : String(error);
            this.context.logger.warn("local_advisory_orchestrator_failed", {
                trigger,
                message: this.state.lastFailureMessage,
            });
        }
        finally {
            this.state.lastRunCompletedAt = new Date().toISOString();
            this.state.lastRunDurationMs = Date.now() - startedAt;
        }
    }
}
exports.LocalAdvisoryOrchestrator = LocalAdvisoryOrchestrator;
