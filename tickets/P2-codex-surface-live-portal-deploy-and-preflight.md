# P2 — Codex surface live portal deploy and preflight

Status: Completed
Date: 2026-04-12
Priority: P2
Owner: Platform / Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-tool-surface-and-portal-operator-access.md

## Problem
Live portal deploy automation exists, but the path is split across preflight, Namecheap deploy, evidence packing, and historical handoffs. That makes it too easy for Codex to stop at local or Firebase verification even though the repo requires live `portal.monsoonfire.com` completion when applicable.

## Tasks
1. Create one repo-native entry point that chains preflight, live portal deploy, and deploy evidence packing for `portal.monsoonfire.com`.
2. Surface that entry point in Codex-facing docs or tool-profile output so the live deploy expectation is discoverable during SSH and headless collaboration.
3. Distinguish local build failures, missing secrets, SSH upload failures, and external hosting-panel follow-up steps in the failure output.
4. Document the minimal Namecheap or cPanel handoff when the automated SSH path cannot finish the release.

## Acceptance Criteria
1. One documented command or workflow covers preflight, live deploy, and evidence pack for `https://portal.monsoonfire.com`.
2. Docs explicitly state Firebase Hosting smoke checks do not replace the required live portal deploy.
3. Failure output names the blocked stage and the next concrete action.

## Dependencies
- `AGENTS.md`
- `package.json`
- `scripts/deploy-preflight.mjs`
- `scripts/deploy-namecheap-portal.mjs`
- `artifacts/deploy-evidence-latest.json`
- `docs/SESSION_HANDOFF_2026-02-19_NAMECHEAP_DEPLOY.md`
- `docs/EXTERNAL_CUTOVER_EXECUTION.md`

## Verification
- single-entry live deploy command succeeds or fails with stage-specific guidance
- deploy evidence artifact updates after a successful live portal release
- headless smoke confirmation against `https://portal.monsoonfire.com`

## Completed In This Pass
1. Confirmed the existing `scripts/deploy-namecheap-portal.mjs` path already chains preflight, live Namecheap deploy, optional verify, promotion gate, and deploy evidence pack in one flow.
2. Confirmed `npm run deploy:namecheap:portal:live` is the documented live entry point and now listed it explicitly in the portal automation matrix local commands.
3. Kept the ticket repo-native by recording the already-shipped command surface rather than adding a redundant parallel deploy wrapper.
