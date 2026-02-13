# Studio OS v3 Architecture

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## 1) Purpose
Studio OS v3 is a local-first control plane that orchestrates Monsoon Fire operations using existing cloud primitives (Firebase Auth, Firestore, Functions, Stripe) without replacing cloud authority.

## 2) Three-Layer Model

### Layer A: Studio Brain (Local)
Responsibilities:
- Read cloud-authoritative data (Firestore, Stripe summaries, Functions read endpoints).
- Compute local StudioState snapshots and diffs.
- Generate proposals/recommendations (draft-only by default).
- Run anomaly detection and internal scheduling jobs.
- Maintain local append-only audit/event log and job state.

Non-responsibilities:
- Primary identity authority.
- Primary payments authority.
- Primary user-facing record authority.

Failure mode:
- If Brain is down, portal + functions continue running normally.

### Layer B: Capability Gateway
Responsibilities:
- Uniform capability registry (`id`, scope, risk, write/read mode, rate limits, approval requirements).
- Proposal -> approval -> execute workflow.
- Enforce least privilege and explicit intent before any external write.
- Policy exemption support for narrow low-risk automations.

Rules:
- No raw Stripe secret keys in Brain or agents.
- No broad cloud write access for agents.
- All external writes require explicit approval unless exemption is configured.

### Layer C: Surfaces
Surfaces include:
- Existing cloud surfaces (Portal UI, Staff UI, Functions APIs, website).
- New local dashboard/cockpit for Studio Brain state, diffs, connector health, and proposal queue.

Principle:
- User-facing operational truth stays in cloud surfaces.
- Local surface is orchestration/monitoring and proposal control.

## 3) StudioState Daily Snapshot Schema
Versioned schema (`v3.0`) stored locally in Postgres and rebuildable from cloud reads.

```ts
StudioStateSnapshot {
  schemaVersion: "v3.0";
  snapshotDate: string;           // YYYY-MM-DD
  generatedAt: string;            // ISO timestamp
  cloudSync: {
    firestoreReadAt: string;
    stripeReadAt: string | null;
  };
  counts: {
    batchesActive: number;
    batchesClosed: number;
    reservationsOpen: number;
    firingsScheduled: number;
    reportsOpen: number;
  };
  ops: {
    blockedTickets: number;
    agentRequestsPending: number;
    highSeverityReports: number;
  };
  finance: {
    pendingOrders: number;
    unsettledPayments: number;
  };
  sourceHashes: {
    firestore: string;            // sha256 canonical hash
    stripe: string | null;
  };
}
```

Diff schema:
- `fromSnapshotDate`, `toSnapshotDate`, key-level changed values.

## 4) Capability + Proposal/Approval Workflow

### Capability model
Each actionable operation must map to a capability:
- `capabilityId`
- target system (`firestore`, `stripe`, `hubitat`, `roborock`, etc.)
- read-only vs write
- risk tier (`low`, `medium`, `high`, `critical`)
- rate limits and cooldown policy
- requires approval (default true for writes)
- optional exemption policy id

### Workflow
1. Draft proposal created (human/staff/agent/system).
2. Proposal stores input payload hash + predicted effects.
3. Approval step required for external writes unless exemption matches.
4. Execution runner performs bounded action.
5. Result output hash + execution metadata logged.
6. Cloud truth updated by scoped adapters only.

### Audit requirements
Append-only immutable-ish log event per stage:
- who (`actorType`, `actorId`)
- what (`action`, `capabilityId`, target)
- why (`rationale`)
- approval state
- `inputHash`, `outputHash`
- timestamps, request IDs/correlation IDs

## 5) Physical World Connector Pattern
Physical connectors (Hubitat, Roborock) must implement:
- health/read probes
- explicit capability mapping per method
- dry-run mode where possible
- circuit breaker and cooldown handling
- strict command allowlist

Connector framework contract:
- Standard interface: `health`, `readStatus`, and `execute`.
- `execute` must reject write intent when connector is configured read-only.
- Connector responses must include request ID plus input/output hashes.
- Shared contract harness validates auth/error taxonomy, timeout/backoff behavior, and read-only enforcement.

Safety constraints:
- Default mode is read-only.
- Any write/control command requires explicit approval by default.
- High-risk classes (doors/locks/power/mobility) are never auto-exempt in P0/P1.
- Commands include idempotency key and timeout budget.
- All command payloads/returns hashed and audited.

## 6) Persistence Model (Local)

Pluggable interfaces:
- `StateStore`: snapshots + diffs + job state
- `EventStore`: append-only audit events
- `CacheStore`: optional transient cache

Default backend:
- Postgres for `StateStore` + `EventStore`
- Optional in-memory cache for P0

Rebuildability:
- Local state can be reconstructed from cloud reads + local event log replay.
- Local DB is optimization, not authority.

## 7) What stays in Functions vs moves local

### Stays in Cloud Functions (authoritative)
- Identity enforcement and role/delegation checks.
- User/staff operational writes (batches, reservations, reports, billing markers).
- Stripe checkout/session/webhook lifecycle.
- Existing trust & safety enforcement path.

### Moves/expands in Local Brain (orchestration)
- StudioState computation and local analytics rollups.
- Recommendation engines (ops anomalies, marketing drafts, finance flags).
- Proposal drafting and approval queue orchestration.
- Connector health monitoring and controlled execution adapters.

## 8) Security Invariants
- Cloud is source of truth for identity/payments/user records.
- No Stripe secrets in local brain or agent payloads.
- Explicit approval gate for all external writes unless narrow policy exemption.
- Least privilege capability scopes; no broad admin tokens for agents.
- Immutable audit trail with hashes.
- Fail-safe operation when local brain is unavailable.

## 9) Implementation Phasing
- P0: Brain scaffold + Postgres + migrations + read-only StudioState + local dashboard.
- P1: Capability registry + proposal/approval + connector framework + read-only Hubitat/Roborock + draft-only swarms.
- P2: Controlled write execution policies, advanced anomaly/risk signals, cockpit consolidation.

## 10) Multi-Studio Readiness Guardrails
- Privileged capability actions must carry explicit `tenantId` context.
- Proposal records are tenant-scoped at creation; execution enforces tenant match.
- Cross-tenant execution attempts are denied (`TENANT_MISMATCH`) and emitted to audit logs.
- Cockpit views include tenant context and tenant filtering for proposal triage.
