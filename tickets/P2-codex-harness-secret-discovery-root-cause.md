# P2 — Codex Harness Secret Discovery Root Cause

Status: Open
Date: 2026-05-01
Priority: P2
Owner: Platform + Agent Harness
Type: Ticket

## Problem

During Ember support attachment live-config work, Codex treated missing repo-local secret files as a hard blocker even though the operator expected the harness to provide broader secret access through the secrets directory, 1Password, or equivalent configured retrieval paths.

This is non-critical, but concerning: the harness exists to make operational affordances discoverable and dependable. If agents stop after checking only fixed repo-relative paths, deploy/config work can be falsely blocked and operator trust in the harness erodes.

## Objective

Find the root cause and make secret discovery explicit enough that future agents either retrieve the required material through the harness or report the exact missing harness capability, not a vague local-file blocker.

## Scope

- Codex Desktop harness/tool discovery for secret access
- Repo secret-path guidance in `AGENTS.md`
- 1Password or secret-provider affordance discovery
- Deploy/config workflows that require live secrets
- Agent blocker reporting conventions

## Tasks

1. Reproduce the Ember support attachment scenario:
   - request live config/deploy that needs `STUDIO_BRAIN_WEB_SUPPORT_BRIDGE_TOKEN`
   - verify whether Codex can discover repo secrets, configured secret directories, and 1Password access.
2. Identify where the failure happened:
   - harness capability unavailable
   - harness capability available but not discoverable
   - agent workflow stopped too early
   - repo instructions pointed at stale or incomplete secret paths.
3. Add an explicit secret discovery preflight:
   - list configured secret sources without printing values
   - validate required key presence by name only
   - return actionable next steps if a provider is unavailable.
4. Update agent guidance so "missing local file" is not treated as a live-config blocker until broader secret retrieval has been attempted.
5. Add a regression check or harness smoke that exercises secret-provider discovery in a redacted way.

## Acceptance Criteria

1. A fresh Codex Desktop thread can determine whether required live secret keys are available without exposing secret values.
2. Missing repo-local files produce a fallback search through configured secret providers before any blocker is reported.
3. If 1Password or another provider is unavailable, the blocker names that provider/capability explicitly.
4. A redacted harness smoke proves the required key names can be discovered for Monsoon Fire live deploy/config work.
5. The Ember support attachment deploy path has a documented secret preflight that distinguishes missing config from missing harness capability.

## Related Feature Smoke

- `npm run ember:support:attachment:smoke` verifies the live Ember attachment path with a synthetic JPEG and redacted output only. This proves deployed bridge health, but it is not a substitute for the harness secret-discovery regression requested above.

## References

- `functions/.env.local.example`
- `scripts/ember-support-attachment-smoke.mjs`
- `studio-brain/.env.example`
- `tickets/P2-studiobrain-env-secret-and-config-hygiene.md`
- Studio Brain memory: `codex-secret-discovery-friction-ember-support-2026-05-01`

## Notes

- Keep secrets out of the ticket. Record key names, providers, and redacted presence checks only.
- This ticket tracks harness reliability, not the Ember support attachment feature itself.
- Initial evidence from the Ember run: repo/shared secret cache and the `portal-automation-env` 1Password item did not expose the new Ember bridge key names by redacted presence check, while the live Cloud Function and portal bridge were already configured. Root cause should include source-of-truth drift, not just "agent stopped too early."
