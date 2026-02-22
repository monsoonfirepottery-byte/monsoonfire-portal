# P1 — Continue Journey / Batch Workflow Agent Quickstart

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Portal + Docs
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

The Continue Journey flow is important but scattered across app behavior and contract docs, making it expensive for agents to infer the canonical sequence.

## Objective

Publish a short, agent-optimized workflow doc for Continue Journey and related batch lifecycle actions.

## Scope

- New short-form workflow doc (docs or portal docs section)
- Links from website/portal `llms.txt` + `ai.txt`
- Alignment with existing contract docs

## Tasks

1. Document the minimum reliable flow:
   - Active -> History -> Continue Journey -> Timeline linkage
2. Include concrete request shape references (`uid`, `fromBatchId`) and safe failure modes.
3. Keep the page token-efficient and implementation-neutral.
4. Cross-link to deeper contract docs for details.
5. Add update notes so future flow changes trigger doc refresh.

## Acceptance Criteria

1. New short workflow doc exists and is linked from both discovery surfaces.
2. Workflow includes the required request payload keys and transition semantics.
3. Content is concise enough for low-token agent context loading.

## Dependencies

- `docs/API_CONTRACTS.md`
- `web/src/api/portalContracts.ts`
- related batch/journey function docs

