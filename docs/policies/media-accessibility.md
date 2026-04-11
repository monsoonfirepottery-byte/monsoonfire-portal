---
slug: "media-accessibility"
title: "Media accessibility standard"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Content Operations"
sourceUrl: "/policies/media-accessibility/"
summary: "Public speech media should include captions, long media should include transcript access, and critical accessibility gaps should delay release or require an accessible alternative."
tags:
  - "accessibility"
  - "media"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Content accessibility audits, remediation triage, and release-blocker routing."
  defaultActions:
    - "collect media URL and title"
    - "label issue type (caption/transcript/alt text)"
    - "assign remediation queue with expected publish impact or release-blocker status"
  allowedLowRiskActions:
    - "log caption, transcript, and alt-text remediation requests"
    - "share expected remediation windows by priority"
    - "route asset updates into the accessibility queue"
  blockedActions:
    - "waive caption or transcript requirements for public media"
    - "publish inaccessible replacements as a final fix"
    - "mark remediation complete without verification"
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
- Critical unresolved accessibility gaps should delay release or be paired with an accessible alternative until resolved.
- Accessibility requests should include page URL and title, with expected update windows
  communicated by the team.

## Implementation in portal

- Maintain a request path from support for media accessibility issues.
- Track open accessibility requests until posted updates are completed.

## Enforcement

Media assets lacking required accessibility accommodations may be delayed in publishing
or paired with an accessible alternative until resolved.

## Support language

Collect:

- affected URL
- media title
- requested assistive format
- urgency and event impact

