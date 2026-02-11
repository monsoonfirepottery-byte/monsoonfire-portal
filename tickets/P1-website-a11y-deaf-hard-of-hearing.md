# P1 — Website A11y: Deaf / Hard-of-Hearing Support

**Status:** In Progress

## Problem
- Video/audio content can block users who are deaf or hard-of-hearing when captions/transcripts are missing.
- Critical updates conveyed only by sound or motion cues reduce accessibility.

## Goals
- Ensure all meaningful media content is available via text equivalents.
- Ensure all important status information is visually and textually communicated.

## Scope
- Website embedded videos, promotional reels, walkthrough clips, audio snippets.
- Inline alerts and announcements.

## Tasks
1. Captions policy:
   - require accurate captions for every published video with speech
   - no autoplay audio
2. Transcripts:
   - provide transcript links or inline transcript blocks for long-form videos
3. Non-audio fallback:
   - any audio-only message must have text equivalent
4. Alerts + updates:
   - ensure no UX state relies on sound-only cues
   - provide visible text for confirmations/errors
5. Content workflow:
   - add publish checklist item: captions/transcript required before going live

## Acceptance
- 100% of speech video assets on key pages include captions.
- Long-form media has transcript access.
- No critical flow depends on audio-only signaling.
- Content publishing checklist enforces media accessibility before release.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`

## Progress
- Added internal publishing checklist for caption/transcript enforcement:
  - `docs/WEBSITE_MEDIA_ACCESSIBILITY_CHECKLIST.md`
- Added public media accessibility policy page:
  - `website/policies/media-accessibility/index.html`
- Linked media standard from accessibility and support surfaces:
  - `website/policies/accessibility/index.html`
  - `website/support/index.html`
  - `website/policies/index.html`
- Added policy data entry and sitemap discoverability:
  - `website/data/policies.json`
  - `website/sitemap.xml`
