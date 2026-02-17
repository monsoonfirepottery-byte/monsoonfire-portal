export type SwarmEventType = "task.created" | "task.assigned" | "agent.message" | "run.started" | "run.finished";

export type AgentIdentity = {
  agentId: string;
  swarmId: string;
  runId: string;
  role: string;
};

export type WorkItemStatus = "created" | "assigned" | "running" | "completed" | "failed";

export type WorkItem = {
  id: string;
  status: WorkItemStatus;
  assignedAgentId: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  swarmId: string;
  runId: string;
};

export type SwarmEvent = {
  id: string;
  type: SwarmEventType;
  swarmId: string;
  runId: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

