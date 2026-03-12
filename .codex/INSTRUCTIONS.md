# Codex Instructions — Monsoon Fire Portal

- Make changes as clean, complete files (no patch instructions).
- Prefer ONE file per response unless explicitly requested.
- Never write undefined values to Firestore payloads.
- Cloud Functions require Authorization: Bearer <idToken>.
- Dev admin header: x-admin-token is user-provided; never hardcode secrets.
- continueJourney requires body { uid, fromBatchId }.
- Keep UI tolerant of missing/extra Firestore fields.
- If touching App.tsx, preserve ErrorBoundary and in-flight guards.
- When adding queries, call out composite index implications.
- Prefer patterns portable to iOS (stateless request/response, explicit JSON contracts).
- If a Codex workflow command fails twice with the same `runtime_error` signature around git/branch operations, stop blind retries.
- If a Codex workflow run is blocked by `missing-auth-token`, recover startup context with task-specific query terms, explicit `runId`, `expandRelationships=true`, and `maxHops=3` before retrying.
- If context recovery must run, prefer `open-memory` context query first, then fallback to startup tool call:
  - `npm run open-memory -- context --agent-id agent:codex --query "<task query>" --run-id "<run-id>" --expand-relationships=true --max-hops 3`
  - fallback: `mcp__open_memory__startup_memory_context --query "<task query>" --runId "<run-id>" --expandRelationships true --maxHops 3`
- If startup context lookup fails with transport/timeout errors for the same unchanged `(query + runId)` signature, classify it as a startup blocker equivalent to `missing-auth-token` and require one unblock action before rerun.
- Treat `spawnSync ... ETIMEDOUT` (for example `context-cli-fallback-failed`) as a startup transport blocker class and route through the same hard-pause rule:
  - log blocker evidence (`command`, `runId`, `query`, `first signal`),
  - take exactly one unblock action (`--allow-dirty`, `--run-id` shift, or AM/PM defer),
  - then rerun the context check once.
- If startup context lookup succeeds but returns no context rows, treat it as a `startup-no-context` soft signal (not a hard blocker): continue with explicit task scope and do not infer prior workflow state from the empty result.
- If the same `missing-auth-token` blocker repeats for an unchanged `(query + runId)` signature, classify it as blocked-state immediately and execute **one** unblock action before any retry (run-id shift, authentication-path repair, or explicit AM/PM scope change). Log command/signature + exit + first signal line first.
- If the same `missing-auth-token` recovery still fails **after a failed bootstrap retry in the same run**, enforce a hard pause: stop command churn, log blocker evidence, and require one unblock action (run-id shift, AM/PM defer, or auth-path repair) before any further automation signatures.
- If the same dry-run signature is blocked by `structuralDecision.mode=Deferred` with `missing-auth-token`, treat as hard pause and do not rerun the same signature until one strategy delta is applied (new `--run-id`, auth recovery, or explicit AM/PM window defer).
- If a Codex automation command is blocked by a local `dirty` worktree, classify the blocker, log evidence (`command`, `status`, `scope`, `exit` equivalent), and choose one of:
  - resolve workspace state (`git status` -> `git stash`/commit/rebase target), or
  - rerun the command with explicit `--allow-dirty` only when `writeScope: codex-docs-only` and this run is intentionally scoped.
- Do not use `--allow-dirty` for non-doc-only runs without explicit user confirmation.
- If startup continuity fails with unchanged `(query + runId)` on:
  - `missing-auth-token`
  - HTTP `401`
  - transport/status `0`
  - command not run to completion (timeout/context CLI transport class),
  treat this as `startup-blocked` for that signature. Log one blocker record first (`command`, `runId`, `query`, `first signal`), then execute exactly one unblock action (`--run-id` shift, AM/PM defer, or auth-path recovery) before any broader retry.
- For that one unblock, run the bootstrap sequence in order and only once:
  - `npm run open-memory -- context --agent-id agent:codex --query "<task query>" --run-id "<run-id>" --expand-relationships=true --max-hops 3`
  - `mcp__open_memory__startup_memory_context --query "<task query>" --runId "<runId>" --expandRelationships true --maxHops 3`
- If either bootstrap step fails again with the same unchanged `(query + runId)` signature, stop further retries and keep the run in hard pause until a different unblock action is chosen.
- If a `daily-interaction` or similar Codex automation call returns deterministic run-level status (`skip`, `duplicate`, `cooldown`) without state mutation, record:
  - exact blocker evidence (`status`/`reason`),
  - the current command signature that produced it,
  - one minimal unblock action (for example `--run-id` shift or explicit AM/PM window defer),
  then stop until that strategy changes.
- On repeated workspace/branch failures, resolve worktree state first (`git status`, `git stash`/commit, or explicit `--allow-dirty`) and rerun with a changed command strategy.
- In `codex-docs-only` tasks, include strict docs + health harness checks before declaring completion:
  - `npm run codex:docs:drift:strict`
  - `npm run codex:doctor:strict`
  - If either strict check fails first in a command signature, stop that signature, log blocker evidence, and rerun once only after exactly one unblock action.

### Codex docs-only blocked-state protocol
- For `writeScope: codex-docs-only`, treat the first unchanged startup continuity miss (`missing-auth-token`, `401`, timeout, transport error, `structuralDecision.mode=Deferred`, run-lock, or deterministic no-op status) as a hard pause.
- Log one blocker evidence record before any retry: command, signature, query, runId, exit status, and first signal.
- Stop rerunning that same command signature until exactly one unblock action is completed:
  - `--run-id` shift,
  - AM/PM cadence shift,
  - auth/path recovery, or
  - explicit scope/task transition.
- After the unblock action, rerun context/bootstrap checks once; if the identical failure remains, stop and do not continue same signature automation until another strategy is logged.

- Blocker handling evidence format:
  - command/signature
  - exit status
  - first signal line (`status`/`reason`/first failure line)
- For deferred states that cite a running blocker context (`rollingIssue` / PR lock), include that URL or identifier in the evidence record.
- Record blocker evidence and unblock action immediately in `.codex/interaction-log.md` before any broader command retries.

## Collaboration defaults from durable memory

- Default execution mode: high autonomy.
  - Continue implementation until a concrete blocker appears.
  - Minimize routine checkpoint prompts; surface only blocking decisions.
- Use external memory workspace for cross-session continuity:
  - `C:\Users\micah\.codex\memory`
  - Stable records: `accepted/accepted.jsonl`
  - Candidate records: `proposed/proposed.jsonl`
- Keep strategic thread visible:
  - monitor West Valley/Phoenix expansion real-estate opportunities while home studio remains baseline.
