# P1 — Community Copy and Flow Humanization Pass

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Member Experience + Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md

## Problem

Community messaging mixes strong ideas with inconsistent phrasing and uneven readability.

## Objective

Refresh Community copy to feel natural, specific, and member-actionable without changing product intent.

## Tasks

1. Rewrite section headers and body copy in a clearer member voice.
2. Tighten event, video, and report-status helper language.
3. Keep behavioral intent and workflows intact while reducing friction wording.

## Acceptance Criteria

1. Community sections read naturally and stay consistent in tone.
2. Copy supports quick scanning and clear next actions.
3. No product behavior or data contracts are altered by the copy pass.

## Completion Evidence (2026-02-28)

1. Rewrote Community value chips, event cards, social proof blurbs, and helper text to a natural member voice in `web/src/views/CommunityView.tsx`.
2. Tightened reporting and moderation helper copy to make next actions explicit while preserving report flow behavior.
3. Kept all data contracts and backend integration points unchanged; scope was copy/flow language only.
