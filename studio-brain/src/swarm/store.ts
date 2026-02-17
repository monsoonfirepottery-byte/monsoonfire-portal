import { getPgPool } from "../db/postgres";
import type { AgentIdentity, SwarmEvent, WorkItem, WorkItemStatus } from "./models";

export type SwarmRecord = {
  id: string;
  eventType: SwarmEvent["type"];
  swarmId: string;
  runId: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseWorkItem(row: Record<string, unknown>): WorkItem {
  return {
    id: String(row.id ?? ""),
    status: String(row.status) as WorkItemStatus,
    assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    outputs: row.outputs ? (row.outputs as Record<string, unknown>) : null,
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
    swarmId: String(row.swarm_id ?? ""),
    runId: String(row.run_id ?? ""),
  };
}

export async function upsertAgent(identity: AgentIdentity): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `
    INSERT INTO swarm_agents (agent_id, swarm_id, run_id, role, created_at, last_seen_at)
    VALUES ($1, $2, $3, $4, now(), now())
    ON CONFLICT (agent_id) DO UPDATE SET
      swarm_id = EXCLUDED.swarm_id,
      run_id = EXCLUDED.run_id,
      role = EXCLUDED.role,
      last_seen_at = now()
    `,
    [identity.agentId, identity.swarmId, identity.runId, identity.role]
  );
}

export async function upsertTask(task: Omit<WorkItem, "updatedAt">): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `
    INSERT INTO swarm_tasks (
      task_id, status, assigned_agent_id, inputs, outputs, created_at, updated_at, swarm_id, run_id
    ) VALUES (
      $1, $2, $3, $4::jsonb, $5::jsonb, now(), now(), $6, $7
    )
    ON CONFLICT (task_id) DO UPDATE SET
      status = COALESCE(EXCLUDED.status, swarm_tasks.status),
      assigned_agent_id = COALESCE(EXCLUDED.assigned_agent_id, swarm_tasks.assigned_agent_id),
      outputs = COALESCE(EXCLUDED.outputs, swarm_tasks.outputs),
      updated_at = now(),
      run_id = EXCLUDED.run_id,
      swarm_id = EXCLUDED.swarm_id
    `,
    [
      task.id,
      task.status,
      task.assignedAgentId,
      JSON.stringify(task.inputs),
      task.outputs ? JSON.stringify(task.outputs) : null,
      task.swarmId,
      task.runId,
    ]
  );
}

export async function setTaskStatus(taskId: string, status: WorkItemStatus, outputs: Record<string, unknown> | null): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    "UPDATE swarm_tasks SET status=$2, outputs=$3::jsonb, updated_at=now() WHERE task_id=$1",
    [taskId, status, outputs ? JSON.stringify(outputs) : null]
  );
}

export async function getTask(taskId: string): Promise<WorkItem | null> {
  const pool = getPgPool();
  const result = await pool.query("SELECT * FROM swarm_tasks WHERE task_id = $1", [taskId]);
  if (!result.rowCount) return null;
  return parseWorkItem(result.rows[0] as Record<string, unknown>);
}

export async function appendSwarmEvent(event: Omit<SwarmRecord, "createdAt">): Promise<SwarmRecord> {
  const pool = getPgPool();
  const createdAt = nowIso();
  await pool.query(
    `
    INSERT INTO swarm_events (
      event_id, event_type, swarm_id, run_id, actor_id, payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
    `,
    [event.id, event.eventType, event.swarmId, event.runId, event.actorId, JSON.stringify(event.payload), createdAt]
  );
  return {
    id: event.id,
    eventType: event.eventType,
    swarmId: event.swarmId,
    runId: event.runId,
    actorId: event.actorId,
    payload: event.payload,
    createdAt,
  };
}

export async function getRecentSwarmEvents(limit = 40): Promise<SwarmRecord[]> {
  const pool = getPgPool();
  const bounded = Math.max(1, Math.min(limit, 250));
  const result = await pool.query(
    "SELECT event_id, event_type, swarm_id, run_id, actor_id, payload, created_at FROM swarm_events ORDER BY created_at DESC LIMIT $1",
    [bounded]
  );
  return result.rows.map((row) => ({
    id: String(row.event_id ?? ""),
    eventType: String(row.event_type ?? "") as SwarmEvent["type"],
    swarmId: String(row.swarm_id ?? ""),
    runId: String(row.run_id ?? ""),
    actorId: String(row.actor_id ?? "system"),
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowIso()),
  }));
}

