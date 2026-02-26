# EPIC: CODEX-PR-GREEN-DAILY

Status: Active  
Owner: Platform / DevEx  
Created: 2026-02-26

## Mission

Run a daily automation that keeps open PRs moving toward green by detecting blocked checks, requesting safe reruns for flaky failures, and posting a rolling unblock summary.

## Scope

- Analyze open, non-draft, non-automation PRs.
- Inspect check-runs on each PR head commit.
- Classify PRs as:
  - Green (no failing/pending checks)
  - Pending (no failing checks, but pending/queued checks)
  - Blocked (one or more failing checks)
- Auto-rerun only flaky failure classes (timed out/cancelled/startup/action required) when in apply mode.
- Maintain run summary in `.codex/pr-green-log.md` and namespace in `.codex/improvement-state.json`.
- Update rolling issue: `Codex PR Green Daily (Rolling)`.

## Safety Guardrails

- No direct push to `main`.
- No code mutation on PR branches.
- Rerun attempts capped per run.
- Do not repeatedly rerun the same workflow run id.
- Dry-run is non-persistent by default; persistence requires explicit apply mode or `--persist-dry-run`.

## Cadence

- Daily at 07:10 America/Phoenix (MST year-round).

## Success Criteria

- Produces daily PR health snapshot and health score.
- Identifies blocked PRs with failing check names and links.
- Requests safe reruns for flaky classes in apply mode.
- Keeps rolling visibility in a single issue thread for fast triage.
