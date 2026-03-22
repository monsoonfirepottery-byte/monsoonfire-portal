# P2 — Codex planning council handoff shortcut

Status: Active
Date: 2026-03-21
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
The current `council this plan` workflow works by convention, but it does not yet have a deterministic “latest in-thread plan -> council submit” handoff contract.

## Tasks
1. Formalize the latest-plan capture rule for Codex-generated planning drafts.
2. Make the planning-council skill and repo convention use the same deterministic draft-plan handoff path.
3. Add a smoke test or fixture demonstrating the automatic second-pass council review.

## Acceptance Criteria
1. A Codex-generated draft plan can be handed to the planning council without manual markdown copying.
2. The repo convention and skill path no longer depend on prompt wording alone.
