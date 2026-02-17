"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmOrchestrator = void 0;
exports.deriveSwarmRunId = deriveSwarmRunId;
const store_1 = require("./store");
class SwarmOrchestrator {
    context;
    running = false;
    stopSubscription = null;
    constructor(context) {
        this.context = context;
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        const route = this.createEventHandler();
        const subscription = await this.context.bus.subscribe(route);
        this.stopSubscription = subscription.stop;
        this.context.logger.info("swarm_orchestrator_started", {
            swarmId: this.context.config.swarmId,
            runId: this.context.config.runId,
        });
    }
    async stop() {
        this.running = false;
        if (this.stopSubscription) {
            await this.stopSubscription();
            this.stopSubscription = null;
        }
    }
    createEventHandler() {
        return async (event) => {
            await (0, store_1.appendSwarmEvent)({
                id: event.id,
                eventType: event.type,
                swarmId: event.swarmId,
                runId: event.runId,
                actorId: event.actorId,
                payload: event.payload,
            });
            if (event.type === "run.started") {
                const identity = {
                    agentId: String(event.actorId ?? "agent"),
                    swarmId: event.swarmId,
                    runId: event.runId,
                    role: String(event.payload.role ?? "worker"),
                };
                await (0, store_1.upsertAgent)(identity);
            }
            if (event.type === "task.assigned") {
                const taskId = String(event.payload.taskId ?? "");
                const existing = taskId ? await (0, store_1.getTask)(taskId) : null;
                const newAssigned = typeof event.payload.assignedAgentId === "string" ? String(event.payload.assignedAgentId) : null;
                if (taskId && existing) {
                    await (0, store_1.upsertTask)({
                        id: taskId,
                        status: "assigned",
                        assignedAgentId: newAssigned ?? existing.assignedAgentId,
                        inputs: existing.inputs,
                        outputs: existing.outputs,
                        swarmId: existing.swarmId,
                        runId: existing.runId,
                        createdAt: existing.createdAt,
                    });
                    this.context.logger.info("swarm_orchestrator_task_assigned", { taskId, assignedAgentId: newAssigned });
                }
            }
            if (event.type === "task.created") {
                const taskId = String(event.payload.taskId ?? "");
                const assignedAgentId = event.payload.assignedAgentId
                    ? String(event.payload.assignedAgentId)
                    : `${event.runId}-agent-1`;
                const existing = taskId ? await (0, store_1.getTask)(taskId) : null;
                if (!existing) {
                    await (0, store_1.upsertTask)({
                        id: taskId,
                        status: "assigned",
                        assignedAgentId,
                        inputs: event.payload.inputs ?? {},
                        outputs: null,
                        swarmId: event.swarmId,
                        runId: event.runId,
                        createdAt: new Date().toISOString(),
                    });
                    this.context.logger.info("swarm_orchestrator_created_task", { taskId, assignedAgentId });
                    await this.context.bus.publish({
                        type: "task.assigned",
                        swarmId: event.swarmId,
                        runId: event.runId,
                        actorId: event.actorId,
                        payload: { taskId, assignedAgentId },
                    });
                }
                else if (existing.status === "created") {
                    await (0, store_1.setTaskStatus)(taskId, "assigned", null);
                    await this.context.bus.publish({
                        type: "task.assigned",
                        swarmId: event.swarmId,
                        runId: event.runId,
                        actorId: event.actorId,
                        payload: { taskId, assignedAgentId },
                    });
                }
            }
            if (event.type === "agent.message") {
                const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : "";
                if (taskId) {
                    const taskState = String(event.payload.state ?? "running");
                    if (taskState === "done" || taskState === "completed") {
                        await (0, store_1.setTaskStatus)(taskId, "completed", event.payload.outputs ?? {});
                    }
                    if (taskState === "error" || taskState === "failed") {
                        await (0, store_1.setTaskStatus)(taskId, "failed", { reason: String(event.payload.reason ?? "unknown") });
                    }
                }
            }
            if (event.type === "run.finished") {
                const events = await (0, store_1.getRecentSwarmEvents)(20);
                this.context.logger.info("swarm_orchestrator_run_finished", {
                    runId: event.runId,
                    eventsSeen: events.length,
                });
            }
        };
    }
}
exports.SwarmOrchestrator = SwarmOrchestrator;
function deriveSwarmRunId(name = "default") {
    const started = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return `${name}-${started}`;
}
