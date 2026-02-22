# P1 — Website Agent Discovery Surfaces (`/llms.txt` + `/ai.txt`)

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Website + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

The website has strong human-readable content but no curated agent-discovery files at the root, forcing agent workflows to crawl broadly and infer authority.

## Objective

Publish safe, token-efficient `llms.txt` and `ai.txt` files for website deploy surfaces with clear authority labeling and contract links.

## Scope

- `website/llms.txt` (or source-equivalent in deploy root)
- `website/ai.txt` (or source-equivalent in deploy root)
- `website/ncsitebuilder/llms.txt`
- `website/ncsitebuilder/ai.txt`

## Tasks

1. Define website `llms.txt` structure:
   - short purpose line
   - start-here list (8-15 links)
   - authority labels (authoritative/advisory)
2. Define website `ai.txt` structure:
   - plain-text resource narrative
   - website scope boundaries
   - links to contract/runbook docs safe for public use
3. Ensure both root variants (`website/` and `website/ncsitebuilder/`) stay aligned.
4. Validate MIME behavior and root deployment path resolution in preview and production-style builds.
5. Add brief comments in file headers explaining public-safe constraints.

## Acceptance Criteria

1. Website root serves `/llms.txt` and `/ai.txt` with HTTP `200`.
2. `llms.txt` includes top links and authority labels.
3. `ai.txt` is concise, public-safe, and references canonical docs only.
4. No private hosts, tokens, or internal-only docs appear in either file.

## Dependencies

- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`

