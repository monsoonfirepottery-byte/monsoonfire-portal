# P1 — Community Card Reporting UI + Modal

Status: Completed

## Context / user story
- As a user, I can open an overflow menu on each community card and choose `Report`.
- I can submit category/severity/note quickly and receive confirmation.

## Acceptance criteria
1. Community cards support overflow menu actions:
   - `Report`
   - Optional `Not interested / Hide this card` (local client preference only)
2. Report modal includes:
   - `category`: `broken_link | incorrect_info | spam | safety | harassment_hate | copyright | other`
   - `severity`: `low | medium | high` with `low` default and auto `high` default for `safety`
   - optional note (max length enforced in UI)
3. Modal validates required fields and displays success/error state.
4. No blank-screen failures; submission is single-flight (double-submit disabled).
5. UI supports current target types:
   - youtube_video
   - blog_post
   - studio_update
   - event

## Implementation notes
- Add reusable report action component so future UGC cards can adopt without refactor.
- Capture `targetRef` and lightweight `targetSnapshot` input in submission payload.
- `Not interested` is local preference storage only in this phase.

## Security considerations
- Never trust client-provided staff-only fields.
- Render note as plain text only (no HTML).

## Telemetry / audit logs
- Client event: `community_report_modal_opened`, `community_report_submitted`.
- Include `targetType`, `targetId`, `category`, `severity`, submit result.

## Dependencies
- `tickets/P1-community-reporting-foundation.md`
- Backend `createReport` endpoint contract.

## Estimate
- M

## Progress notes
- Implemented card overflow actions in `web/src/views/CommunityView.tsx`:
  - `Report`
  - `Not interested / Hide this card` (local preference)
- Implemented report modal with category/severity/note, single-flight submit, and success/error feedback.
- Added support for current target types (`youtube_video`, `blog_post`, `studio_update`, `event`) and wired submission to `createReport`.
- Added semantic improvements (menu roles, Escape close, labeled controls, live-region status messaging).
