---
slug: "media-accessibility"
title: "Media accessibility standard"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Content Operations"
sourceUrl: "/policies/media-accessibility/"
summary: "Public speech media should include captions. Long media should include transcript access."
tags:
  - "accessibility"
  - "media"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Content accessibility audits and remediation triage."
  defaultActions:
    - "collect media URL and title"
    - "label issue type (caption/transcript/alt text)"
    - "assign remediation queue with expected publish impact"
  requiredSignals:
    - "asset URL"
    - "release date or campaign priority"
    - "current accessibility state"
  escalateWhen:
    - "urgent campaign launch dependency"
    - "multi-asset block with repeated failures"
    - "no-caption alternative unavailable"
  replyTemplate: "Acknowledge request and commit to accessibility update window by impact priority."
---

## Purpose

To set requirements for new public media assets and handle remediation requests.

## Scope

Video, audio, and long-form media used in public studio channels.

## Policy

- New long-form video and audio content must include captions and transcripts before
  publication where practical.
- Short media assets should include accessible alternatives where feasible.
- Accessibility requests should include page URL and title, with expected update windows
  communicated by the team.

## Implementation in portal

- Maintain a request path from support for media accessibility issues.
- Track open accessibility requests until posted updates are completed.

## Enforcement

Media assets lacking required accessibility accommodations may be delayed in publishing
until resolved.

## Support language

Collect:

- affected URL
- media title
- requested assistive format
- urgency and event impact

