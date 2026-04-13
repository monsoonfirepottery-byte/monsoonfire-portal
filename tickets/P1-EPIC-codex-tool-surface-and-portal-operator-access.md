# Epic: P1 — Codex tool surface and portal operator access

Status: Active
Date: 2026-04-12
Priority: P1
Owner: Platform / Portal
Type: Epic

## Problem
The repo already contains real automation for memory continuity, portal deploy, portal auth bootstrap, and portal canary verification, but those workflows are still fragmented across runbooks, scripts, and private operator knowledge. Codex sessions can therefore miss the intended completion bar or fall back to manual token hunting even when the underlying automation already exists.

## Objective
Surface the highest-leverage repo-native operator workflows as first-class Codex-friendly commands, tool checks, and docs so memory write-back, live deploy, auth bootstrap, Firebase ops triage, and headless visual verification are all discoverable and repeatable.

## Historical Context
- `tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md`
- `docs/epics/EPIC-PORTAL-QA-AUTOMATION-COVERAGE.md`
- `docs/SESSION_HANDOFF_2026-02-19_NAMECHEAP_DEPLOY.md`
- `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`

## Tickets
- `tickets/P1-codex-expose-studio-brain-remember-write-path.md`
- `tickets/P2-codex-surface-live-portal-deploy-and-preflight.md`
- `tickets/P2-portal-auth-bootstrap-and-test-identity-helper.md`
- `tickets/P2-portal-firebase-ops-toolbox-and-firestore-query-inspector.md`
- `tickets/P2-portal-headless-visual-diff-baselines-and-artifact-triage.md`

## Scope
1. Prefer surfacing and consolidating existing automation over building parallel one-off scripts.
2. Keep headless, Windows-safe, and SSH-safe execution as the default path.
3. Make secret handling explicit, redacted, and compatible with current `secrets/portal/*` conventions.
4. Tie each workflow to clear verification artifacts or recovery guidance.

## Acceptance Criteria
1. Each child ticket ends with one primary command or workflow entry point that Codex can discover quickly.
2. The live portal completion bar explicitly includes `https://portal.monsoonfire.com` deploy evidence when relevant.
3. Startup continuity no longer depends on undocumented write-path workarounds.
4. Firebase/operator regressions produce focused diagnostics instead of broad repo archaeology.

## Recent Progress
- 2026-04-12: exposed `studio_brain_remember` directly from the MCP server, added remember-write test coverage, and surfaced the write surface in `codex-doctor`.
- 2026-04-12: added `portal:auth:helper` so operators can mint and inspect a redacted staff auth context without hunting through env files or printing raw bearer material.
- 2026-04-12: added `portal:firebase:ops`, which consolidates credential health, Firestore index guard, rules drift, optional deploy preflight, and exact error-text triage into one report.
- 2026-04-12: updated the portal automation matrix so the new auth/helper, Firebase ops, and live portal deploy commands are documented alongside the existing canary/deploy flows.

## Current Blocker
The highest-value remaining gap is visual diff baseline management for headless portal regressions; current canaries save screenshots, but baseline approval and diff triage are still not first-class.
