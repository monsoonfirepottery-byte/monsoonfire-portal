# P1 — Codex expose Studio Brain remember write path

Status: Completed
Date: 2026-04-12
Priority: P1
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-tool-surface-and-portal-operator-access.md

## Problem
Repo-local instructions expect `studio_brain_remember` to be available for durable write-back, but the current Codex-facing tool surface is read-heavy and leaves startup continuity dependent on indirect scripts or missing MCP exposure.

## Tasks
1. Expose a `studio_brain_remember` MCP tool in `studio-brain-mcp/server.mjs` by reusing `scripts/lib/studio-brain-memory-write.mjs` rather than inventing a second write path.
2. Support both single-save and batched `items` writes, including `kind`, `rememberForStartup`, and rejection of speculative or weakly inferred payloads.
3. Surface remember-write availability in doctor/tool-profile output so sessions fail clearly when the write path is unavailable.
4. Add a smoke path proving a handoff or checkpoint write refreshes startup continuity artifacts for the next session.

## Acceptance Criteria
1. Codex can call `studio_brain_remember` directly from the MCP surface.
2. Batched writes preserve stable request IDs across retries and update startup-eligible artifacts when requested.
3. `codex-doctor` or the machine tool profile reports whether remember write-back is healthy before a new session begins.

## Dependencies
- `studio-brain-mcp/server.mjs`
- `scripts/lib/studio-brain-memory-write.mjs`
- `scripts/codex-capture-startup-handoff.mjs`
- `scripts/codex-doctor.mjs`
- `scripts/lib/codex-machine-tool-profile.mjs`
- `docs/runbooks/MCP_OPERATIONS.md`
- `docs/runbooks/CODEX_RECOVERY.md`

## Verification
- `node ./scripts/codex-doctor.mjs --json`
- targeted MCP smoke call for `studio_brain_remember`
- fresh-thread startup check confirming the remembered handoff or checkpoint is selected

## Completed In This Pass
1. Added `studio_brain_remember` to `studio-brain-mcp/server.mjs` using `rememberWithStudioBrain` as the shared write path.
2. Added MCP integration coverage that proves a remember write succeeds, updates local startup continuity artifacts, and advertises the tool through `listTools`.
3. Surfaced remember-write registration in `scripts/codex-doctor.mjs` so the write surface is visible during startup diagnostics.
