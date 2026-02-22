# P1 — Agent Docs Page + Public Policy Notes

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Docs + Website + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Without a human-readable explanation page, contributors and integrators may treat `llms.txt`/`ai.txt` as undocumented artifacts and drift policy over time.

## Objective

Publish an "Agent Docs" page/section that explains intent, authority hierarchy, and safe usage boundaries for public agent-facing surfaces.

## Scope

- Website content page/section for Agent Docs
- Portal docs reference section (where appropriate)
- Cross-links to `llms.txt`, `ai.txt`, and runbook docs

## Tasks

1. Draft Agent Docs content:
   - purpose and audience
   - authoritative vs advisory content model
   - "no privileged access" policy
2. Add links to website + portal discovery files.
3. Link canonical contract docs and source-of-truth index.
4. Add maintenance ownership callout and last-review expectations.
5. Ensure content style is concise and machine-scan friendly.

## Acceptance Criteria

1. Agent Docs page/section is publicly reachable and linked from discovery surfaces.
2. Policy clearly states discovery guidance does not grant privileged access.
3. Authority model and maintenance ownership are documented.

## Dependencies

- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/runbooks/AGENT_SURFACES.md` (new)

