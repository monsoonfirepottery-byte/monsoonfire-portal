# P3: Deprecate Codex Text Status Board Harness

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
