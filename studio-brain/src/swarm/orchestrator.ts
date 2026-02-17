import type { Logger } from "../config/logger";
import type { SwarmEventBus } from "./bus/eventBus";
import type { AgentIdentity, SwarmEvent } from "./models";
import { appendSwarmEvent, getRecentSwarmEvents, getTask, setTaskStatus, upsertAgent, upsertTask } from "./store";

export type OrchestratorConfig = {
  swarmId: string;
  runId: string;
};

export type OrchestratorContext = {
  bus: SwarmEventBus;
  logger: Logger;
  config: OrchestratorConfig;
};

type EventHandler = (event: SwarmEvent) => Promise<void>;

export class SwarmOrchestrator {
  private running = false;
  private stopSubscription: (() => Promise<void>) | null = null;

  constructor(private readonly context: OrchestratorContext) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const route = this.createEventHandler();
    const subscription = await this.context.bus.subscribe(route);
    this.stopSubscription = subscription.stop;
    this.context.logger.info("swarm_orchestrator_started", {
      swarmId: this.context.config.swarmId,
      runId: this.context.config.runId,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.stopSubscription) {
      await this.stopSubscription();
      this.stopSubscription = null;
    }
  }

  private createEventHandler(): EventHandler {
    return async (event: SwarmEvent): Promise<void> => {
      await appendSwarmEvent({
        id: event.id,
        eventType: event.type,
        swarmId: event.swarmId,
        runId: event.runId,
        actorId: event.actorId,
        payload: event.payload,
      });

      if (event.type === "run.started") {
        const identity: AgentIdentity = {
          agentId: String(event.actorId ?? "agent"),
          swarmId: event.swarmId,
          runId: event.runId,
          role: String(event.payload.role ?? "worker"),
        };
        await upsertAgent(identity);
      }

      if (event.type === "task.assigned") {
        const taskId = String(event.payload.taskId ?? "");
        const existing = taskId ? await getTask(taskId) : null;
        const newAssigned =
          typeof event.payload.assignedAgentId === "string" ? String(event.payload.assignedAgentId) : null;
        if (taskId && existing) {
          await upsertTask({
            id: taskId,
            status: "assigned",
            assignedAgentId: newAssigned ?? existing.assignedAgentId,
            inputs: existing.inputs,
            outputs: existing.outputs,
            swarmId: existing.swarmId,
            runId: existing.runId,
          });
          this.context.logger.info("swarm_orchestrator_task_assigned", { taskId, assignedAgentId: newAssigned });
        }
      }

      if (event.type === "task.created") {
        const taskId = String(event.payload.taskId ?? "");
        const assignedAgentId = event.payload.assignedAgentId
          ? String(event.payload.assignedAgentId)
          : `${event.runId}-agent-1`;
        const existing = taskId ? await getTask(taskId) : null;
        if (!existing) {
          await upsertTask({
            id: taskId,
            status: "assigned",
            assignedAgentId,
            inputs: (event.payload.inputs as Record<string, unknown>) ?? {},
            outputs: null,
            swarmId: event.swarmId,
            runId: event.runId,
          });
          this.context.logger.info("swarm_orchestrator_created_task", { taskId, assignedAgentId });
          await this.context.bus.publish({
            type: "task.assigned",
            swarmId: event.swarmId,
            runId: event.runId,
            actorId: event.actorId,
            payload: { taskId, assignedAgentId },
          });
        } else if (existing.status === "created") {
          await setTaskStatus(taskId, "assigned", null);
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
            await setTaskStatus(taskId, "completed", (event.payload.outputs as Record<string, unknown>) ?? {});
          }
          if (taskState === "error" || taskState === "failed") {
            await setTaskStatus(taskId, "failed", { reason: String(event.payload.reason ?? "unknown") });
          }
        }
      }

      if (event.type === "run.finished") {
        const events = await getRecentSwarmEvents(20);
        this.context.logger.info("swarm_orchestrator_run_finished", {
          runId: event.runId,
          eventsSeen: events.length,
        });
      }
    };
  }
}

export function deriveSwarmRunId(name = "default"): string {
  const started = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${name}-${started}`;
}
