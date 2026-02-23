# P2 — Structured Logs and Correlation IDs Across Studiobrain and Portal Paths

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Log output is currently mixed and loosely structured, which slows post-incident debugging and makes end-to-end traces difficult.

## Objective

Standardize log structure and propagate request correlation identifiers across studio-brain, functions, and web-facing services.

## Scope

- `studio-brain/src/config/logger.ts` (or equivalent)
- `functions/src` logging middleware
- `web` API/proxy call paths
- `studio-brain/src/connectivity` request wrappers

## Tasks

1. Add a common structured logger schema (JSON by default, pretty option for local interactive use).
2. Add correlation ID middleware:
   - inbound request capture
   - propagation through auth/api layers
   - response echo header for client visibility
3. Add trace boundary mapping to smoke checks:
   - include correlation IDs in playwright artifacts
   - include correlation IDs in reliability artifacts
4. Add log redaction policy in schema for secrets/tokens.
5. Add parser-friendly docs for tailing and grep patterning used by ops tooling.

## Acceptance Criteria

1. All critical services emit parseable structured logs by default.
2. A request can be traced through multiple service hops with one correlation ID.
3. Sensitive values are redacted at source.
4. Ops tooling can parse and aggregate logs without custom per-service transforms.

## Dependencies

- `studio-brain/src/connectivity/http.ts`
- `functions/package.json`
- `docs/metrics/STUDIO_OS_V3_SCORECARD.md`

## Definition of Done

- Structured logs are enabled by default for local/studiobrain runs.
- Correlation IDs appear in both logs and smoke artifacts.

## Work completed

- Confirmed structured JSON logging is active in Studio Brain runtime path (`studio-brain/src/config/logger.ts`, server request logs).
- Confirmed request ID propagation/echo in Studio Brain HTTP server (`x-request-id`, `x-trace-id` response headers).
- Added explicit correlation capture in status probes:
  - `scripts/studiobrain-status.mjs` now sends `x-request-id` for each endpoint probe and records:
    - `requestId`
    - `responseRequestId`
    - `responseTraceId`
    - `requestIdMatched`
- Added parser-friendly correlation and audit guidance to ops docs:
  - `studio-brain/docs/OPS_TUNING.md`

## Evidence

1. `npm run studio:check:safe -- --json --no-evidence --no-host-scan` (`endpoints[].correlation`)
2. `npm run reliability:once -- --json` (status payload includes correlation data in parsed endpoint results)
3. `npm run functions:cors:smoke` (request-id propagation in function probe headers)
