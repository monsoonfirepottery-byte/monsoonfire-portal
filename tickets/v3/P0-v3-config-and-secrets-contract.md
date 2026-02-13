# P0: Studio Brain Config + Secrets Contract

## Goal
Define and enforce a strict runtime config contract so local orchestration is deterministic, secure, and environment-portable.

## Non-goals
- No new external secret manager integration in this ticket.
- No capability execution logic.

## Acceptance Criteria
- Typed config loader with explicit required/optional fields exists.
- Startup fails fast on invalid config with actionable errors.
- Secret-bearing fields are never printed in logs.
- Anchor mode defaults are enforced unless explicitly overridden.
- Example `.env.example` for `studio-brain` is added with non-secret placeholders.

## Files/Dirs
- `studio-brain/src/config/**`
- `studio-brain/.env.example`
- `docs/STUDIO_OS_V3_ARCHITECTURE.md`

## Tests
- Unit tests for valid/invalid config parse.
- Unit tests that secret fields are redacted from serialized config output.

## Security Notes
- Block runtime if unsafe settings attempt broad write enablement.
- Keep Stripe/Firebase privileged keys out of UI and logs.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Config validation outcome event on startup (pass/fail + reasons, no secrets).
- Runtime mode event includes anchor mode flags and write policy stance.

## Rollback
- Revert to static minimal config loader.
- Keep anchor mode defaults locked to read-only.
