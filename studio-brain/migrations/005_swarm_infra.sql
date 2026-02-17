CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS swarm_agents (
  agent_id text PRIMARY KEY,
  swarm_id text NOT NULL,
  run_id text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swarm_tasks (
  task_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('created', 'assigned', 'running', 'completed', 'failed')),
  assigned_agent_id text NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NULL,
  swarm_id text NOT NULL,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status_updated_at ON swarm_tasks (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_swarm ON swarm_tasks (swarm_id, run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS swarm_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('task.created', 'task.assigned', 'agent.message', 'run.started', 'run.finished')),
  swarm_id text NOT NULL,
  run_id text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_events_swarm_created_at ON swarm_events (swarm_id, run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS swarm_memory (
  memory_id text PRIMARY KEY,
  agent_id text NOT NULL,
  run_id text NOT NULL,
  tenant_id text NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_run_tenant ON swarm_memory (run_id, tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_memory_agent ON swarm_memory (agent_id, created_at DESC);
