# P3: Deprecate Codex Text Status Board Harness

Status: Completed
Priority: P3
Owner: Codex Harness
Type: Ticket

## Context
The app now carries more of the live progress and orchestration surface, so the older in-thread text status board adds scroll and cycle cost without much user value.

## Todo
- Audit `AGENTS.md`, harness docs, and Codex collaboration scripts for required status-board behavior.
- Replace default board usage with lighter milestone/checkpoint updates.
- Keep explicit user commands like `show board` only if they still map to a useful current app surface.
- Remove or soften tests/docs that assume the text board is the primary coordination UI.

## Notes
- Do not remove useful handoff/checkpoint summaries.
- This is a harness/protocol cleanup, not an Ember support feature blocker.

## Completion Notes — 2026-05-01
- Audited `AGENTS.md`, `.codex/INSTRUCTIONS.md`, and harness references on the clean `origin/main` branch for required in-thread text-board behavior.
- Updated collaboration defaults to prefer milestone updates, blocker evidence, and concise handoffs.
- Kept `dashboard` / `show board` as explicit user commands, but mapped them to app/control-tower state when available or a compact checkpoint when not.
- Confirmed Studio Brain runtime/control-tower `board` rows are app-facing coordination state, not the deprecated chat text-board harness, so they were left intact.
