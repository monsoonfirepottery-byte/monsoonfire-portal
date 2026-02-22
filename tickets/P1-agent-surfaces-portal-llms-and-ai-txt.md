# P1 — Portal Agent Discovery Surfaces (`/llms.txt` + `/ai.txt`)

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Portal + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Portal deploy output currently lacks explicit agent-first entry points, making it harder for agents to discover key workflow and contract surfaces quickly.

## Objective

Add public-safe, static `llms.txt` and `ai.txt` files to portal hosting output with links to authoritative portal contracts/workflows.

## Scope

- `web/public/llms.txt`
- `web/public/ai.txt`
- deployed hosting output under `web/dist/`

## Tasks

1. Create portal `llms.txt` with:
   - concise portal purpose statement
   - 8-15 start-here links
   - explicit authoritative/advisory grouping
2. Create portal `ai.txt` with:
   - high-level portal context
   - public-safe endpoint/doc references
   - no elevated-access guidance
3. Include links for reservation/batch workflows and contract docs.
4. Validate that files survive `npm --prefix web run build` and hosting deploy.
5. Confirm file content remains static and cache-friendly.

## Acceptance Criteria

1. Portal root serves `/llms.txt` and `/ai.txt` with HTTP `200`.
2. Discovery files include contract/workflow pointers relevant to portal usage.
3. No internal-only hostnames or secrets are exposed.
4. Build/deploy flow includes these files without special-case manual steps.

## Dependencies

- `web/public/`
- `web/src/api/portalContracts.ts`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`

