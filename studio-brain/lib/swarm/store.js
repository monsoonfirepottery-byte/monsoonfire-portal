"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertAgent = upsertAgent;
exports.upsertTask = upsertTask;
exports.setTaskStatus = setTaskStatus;
exports.getTask = getTask;
exports.appendSwarmEvent = appendSwarmEvent;
exports.getRecentSwarmEvents = getRecentSwarmEvents;
const postgres_1 = require("../db/postgres");
function nowIso() {
    return new Date().toISOString();
}
function parseWorkItem(row) {
    return {
        id: String(row.id ?? ""),
        status: String(row.status),
        assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
        inputs: row.inputs ?? {},
        outputs: row.outputs ? row.outputs : null,
        createdAt: String(row.created_at ?? nowIso()),
        updatedAt: String(row.updated_at ?? nowIso()),
        swarmId: String(row.swarm_id ?? ""),
        runId: String(row.run_id ?? ""),
    };
}
async function upsertAgent(identity) {
    const pool = (0, postgres_1.getPgPool)();
    await pool.query(`
    INSERT INTO swarm_agents (agent_id, swarm_id, run_id, role, created_at, last_seen_at)
    VALUES ($1, $2, $3, $4, now(), now())
    ON CONFLICT (agent_id) DO UPDATE SET
      swarm_id = EXCLUDED.swarm_id,
      run_id = EXCLUDED.run_id,
      role = EXCLUDED.role,
      last_seen_at = now()
    `, [identity.agentId, identity.swarmId, identity.runId, identity.role]);
}
async function upsertTask(task) {
    const pool = (0, postgres_1.getPgPool)();
    await pool.query(`
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
    `, [
        task.id,
        task.status,
        task.assignedAgentId,
        JSON.stringify(task.inputs),
        task.outputs ? JSON.stringify(task.outputs) : null,
        task.swarmId,
        task.runId,
    ]);
}
async function setTaskStatus(taskId, status, outputs) {
    const pool = (0, postgres_1.getPgPool)();
    await pool.query("UPDATE swarm_tasks SET status=$2, outputs=$3::jsonb, updated_at=now() WHERE task_id=$1", [taskId, status, outputs ? JSON.stringify(outputs) : null]);
}
async function getTask(taskId) {
    const pool = (0, postgres_1.getPgPool)();
    const result = await pool.query("SELECT * FROM swarm_tasks WHERE task_id = $1", [taskId]);
    if (!result.rowCount)
        return null;
    return parseWorkItem(result.rows[0]);
}
async function appendSwarmEvent(event) {
    const pool = (0, postgres_1.getPgPool)();
    const createdAt = nowIso();
    await pool.query(`
    INSERT INTO swarm_events (
      event_id, event_type, swarm_id, run_id, actor_id, payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
    `, [event.id, event.eventType, event.swarmId, event.runId, event.actorId, JSON.stringify(event.payload), createdAt]);
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
async function getRecentSwarmEvents(limit = 40) {
    const pool = (0, postgres_1.getPgPool)();
    const bounded = Math.max(1, Math.min(limit, 250));
    const result = await pool.query("SELECT event_id, event_type, swarm_id, run_id, actor_id, payload, created_at FROM swarm_events ORDER BY created_at DESC LIMIT $1", [bounded]);
    return result.rows.map((row) => ({
        id: String(row.event_id ?? ""),
        eventType: String(row.event_type ?? ""),
        swarmId: String(row.swarm_id ?? ""),
        runId: String(row.run_id ?? ""),
        actorId: String(row.actor_id ?? "system"),
        payload: row.payload ?? {},
        createdAt: String(row.created_at ?? nowIso()),
    }));
}
