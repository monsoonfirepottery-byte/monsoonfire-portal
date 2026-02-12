# P2 — Agent/Human Request Intake: “Do This For Me” Queue (Staff Triage)

Status: In Progress

## Problem
- If we want to support agents (and humans) delegating work to the studio, we need a safe, auditable intake funnel.
- Today, “supportRequests” exists, but it’s generic and not structured for operational flows like:
  - deliver/pickup logistics
  - firing intent + constraints
  - shipping vs pickup
  - status transitions and staff assignment

## Goals
- Add a structured intake request type that:
  - can be created by a signed-in user OR an integration token (PAT)
  - is readable/operable by staff
  - has explicit status transitions + audit trail
- Keep the workflow “batch-first”: requests should ultimately produce/attach to a `batchId` where appropriate.

## Non-goals
- Fully automated fulfillment (physical processes require human confirmation).
- Public anonymous intake (must be authenticated).

## Data model (Firestore)
Collection: `agentRequests/{requestId}`
- `createdAt: timestamp`
- `updatedAt: timestamp`
- `createdByUid: string` (owner uid)
- `createdByMode: "firebase" | "pat"`
- `createdByTokenId?: string | null` (PAT tokenId if PAT)
- `status: "new" | "triaged" | "accepted" | "in_progress" | "ready" | "fulfilled" | "rejected" | "cancelled"`
- `kind: "firing" | "pickup" | "delivery" | "shipping" | "commission" | "other"`
- `title: string`
- `summary: string | null`
- `notes: string | null`
- `constraints: map` (small; ex max temp, clay body, deadlines)
- `logistics: map`
  - `mode: "dropoff"|"pickup"|"ship_in"|"ship_out"|"local_delivery"`
  - `windowEarliest?: timestamp | null`
  - `windowLatest?: timestamp | null`
  - `address?: map | null` (PII; see “PII handling”)
- `contact: map`
  - `name?: string | null`
  - `email?: string | null`
  - `phone?: string | null`
- `linkedBatchId?: string | null`
- `staff: map`
  - `assignedToUid?: string | null`
  - `triagedAt?: timestamp | null`
  - `internalNotes?: string | null`

Subcollection: `agentRequests/{requestId}/audit/{eventId}`
- `at: timestamp`
- `type: string` (status changed, notes added, linked batch, etc.)
- `actorUid: string | null`
- `actorName: string | null`
- `details: map` (safe)

### PII handling (addresses)
Addresses are sensitive. Options (pick one for v1):
1. Store address inside `agentRequests.logistics.address`, but restrict reads:
  - only `createdByUid` and staff can read
  - never expose in public endpoints
2. Store address in a separate doc readable only by staff (safer) and keep `agentRequests` body non-PII.

Recommended: option (2) if we expect real shipping usage.

## Backend (Functions)
### Endpoints (under v1 if available)
1) `POST /v1/agentRequests.create`
- Auth: Firebase OR PAT scope `requests:write`
- Body: structured request (Zod-validated)
- Server:
  - sets `createdByUid` from auth context
  - normalizes windows
  - writes request + initial audit event
  - rate limit by uid/ip

2) `POST /v1/agentRequests.listMine`
- Auth: Firebase OR PAT scope `requests:read`
- Returns only requests where `createdByUid == uid`.

3) `POST /v1/agentRequests.listStaff`
- Staff-only
- Filters by status, kind, updatedAt.

4) `POST /v1/agentRequests.updateStatus`
- Staff-only OR owner for cancel
- Enforce allowed transitions.

5) `POST /v1/agentRequests.linkBatch`
- Staff-only
- Body: `{ requestId, batchId }`
- Also writes audit event.

### Notifications (optional but high value)
- On create:
  - notify staff via existing notification/email infrastructure (do not include PII in logs).

## Frontend (Portal)
1. User-facing view: “Requests”
  - create request (guided form)
  - list my requests
  - show status + timeline
2. StaffView section: “Agent Requests”
  - list open requests
  - accept/reject/assign
  - link to batch

## Firestore rules
- Prefer: no direct client writes to `agentRequests` (write via functions).
- If direct writes are required, add strict rules:
  - owner can create/read own, but cannot read staff fields or other users
  - staff can read/write all
  - hasOnlyKeys + field validation

## Tasks
1. Implement data model + server endpoints (Zod validation).
2. Implement staff triage UI in `web/src/views/StaffView.tsx`.
3. Implement user “Requests” UI (new view).
4. Add audit log rendering.
5. Add docs to `docs/API_CONTRACTS.md`.

## Acceptance
- User can create a request and track status.
- Staff can triage, assign, and link to a batch.
- Requests are authenticated, rate-limited, and audited.
- No PII is logged; PII access is restricted to owner+staff.

## Progress notes
- Added v1 request-intake backend routes in `functions/src/apiV1.ts`:
  - `POST /v1/agent.requests.create`
  - `POST /v1/agent.requests.listMine`
  - `POST /v1/agent.requests.listStaff`
  - `POST /v1/agent.requests.updateStatus`
  - `POST /v1/agent.requests.linkBatch`
- Added authenticated scope enforcement:
  - `requests:read` / `requests:write`
  - staff-only gates for triage/listStaff/linkBatch
  - owner-only cancel fallback in updateStatus.
- Added audit trail writes:
  - `agentRequests/{id}/audit/*`
  - top-level `agentAuditLogs` action events.
- Added API contract documentation for new endpoints:
  - `docs/API_CONTRACTS.md`
- Remaining:
  - Dedicated user-facing Requests view in portal nav.
  - Optional: richer audit timeline rendering from `agentRequests/{id}/audit`.
- Completed staff triage UX in `web/src/views/staff/AgentOpsModule.tsx`:
  - Agent request queue table with status/kind/search filters and KPI pills.
  - Request detail pane with requester context, payload details, and linked batch visibility.
  - Staff actions wired to v1 endpoints:
    - `apiV1/v1/agent.requests.updateStatus`
    - `apiV1/v1/agent.requests.linkBatch`
    - `apiV1/v1/agent.requests.listStaff` (refresh)
  - In-flight guardrails + explicit status/error banners retained.
