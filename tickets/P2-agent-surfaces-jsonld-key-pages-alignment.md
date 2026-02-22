# P2 — JSON-LD Alignment for Agent-readable Key Pages

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Website + SEO + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Structured data exists on parts of the website, but coverage and consistency for key discovery pages may drift as content changes.

## Objective

Improve and validate JSON-LD usage on key pages where it materially improves machine readability without introducing markup bloat.

## Scope

- key website landing/docs pages
- any relevant portal informational pages
- schema validation notes/runbook guidance

## Tasks

1. Audit current JSON-LD coverage on high-signal pages.
2. Define minimal schema additions/updates for agent utility.
3. Ensure JSON-LD fields align with page content and do not overstate claims.
4. Validate syntax in deterministic local checks.
5. Document where JSON-LD is authoritative vs supplementary.

## Acceptance Criteria

1. Key pages have validated JSON-LD where appropriate.
2. Structured data remains consistent with visible content.
3. Additions do not regress page performance or accessibility baselines.

## Dependencies

- `website/assets/schema/`
- `website/ncsitebuilder/assets/schema/`
- website page templates

