# Monsoon Fire Portal — Profile & Settings plan

Date: January 21, 2026
Owner: (TBD)

## Goal
- Build a dedicated Profile & Settings view (accessed from the portrait + nav) that surfaces everything the studio tracks for a client: timeline, membership, kiln preferences, notification controls, and any contextual notes.
- Keep the experience thin, data-driven, and guarded (double-submit protection, clear status messaging) so it mirrors the other views and can map easily to the future iOS client.

## Data sources & dependencies
- `profiles/{uid}` document (see `docs/SCHEMA_PROFILE.md`) for display name, preferred kilns, membership meta, and notification toggles.
- `useBatches` hook for active + historical batches (piece counts, success log, history timeline).
- Firebase Auth `user` metadata to fall back on creation time / email when the profile doc is sparse.
- Existing `memberships`, `reservations`, or future telemetry feeds can feed supplemental cards (TODO: define if new Firestore reads are required).
- Still need the `createReservation` Cloud Function for the Reservations view; no new Cloud Function is required for the profile editor today, but its status should be documented.

## Page structure
1. **Account summary card** – display name, email, member since (profile or metadata), membership tier, membership expiry/renewal, total pieces, success rate, and preferred kilns badges.
2. **Journey metrics panel** – quick stats for active vs completed batches, breakdown by firing type (bisque/glaze/other), and a sparkline of piece success over time (pulled from the last N `history` entries).
3. **Recent history list** – timeline showing the latest batches (or reservations once available) with statuses, kiln types, and links/backstory; mark successes vs failures visually.
4. **Settings form** – editable display name, preferred kilns, new `personalNotes` text area (to capture client reminders or mental models), and toggles for each notification preference (kiln, classes, pieces) plus a new `notifyReservations` toggle (future) if needed.
5. **Studio notes** – read-only block showing staff context from `profileDoc.studioNotes`.
6. **Kiln preferences & reminders** – highlight `preferredKilns` plus callouts for requested kiln preferences, membership upgrades, or reminder draft (e.g., ICS download for membership renewals / kiln slots) once that feature is fleshed out.
7. **Support & quick actions** – CTA to open Support FAQ or request new service, plus evidence of outstanding reservations.
8. **Reservation history & notification status** – show latest reservation status, queue/ETA band, last transition timestamp, and latest notification delivery state for reservation-related updates.

## Reservation history & notification status (detail)
- Profile should surface the most recent reservation timeline context:
  - `status` + `loadStatus`
  - `queuePositionHint` / `estimatedWindow` when present
  - latest `stageStatus.at` + concise reason copy.
- Notification status panel should include:
  - latest reservation notification type sent (confirm/delay/ready reminder)
  - delivery state summary (sent/pending/failed where available)
  - next recommended user action copy.
- Fallback behavior for legacy rows missing queue/timeline fields:
  - show stable copy (`Status updated recently`, `ETA pending`)
  - never show blank state.

## UX & resiliency
- Keep forms guarded (disable submit while saving, show `Saving...` statuses, and display errors from Firestore clearly).
- Reuse `ErrorBoundary` patterns already in `App.tsx` to avoid blank screens.
- Provide placeholders/loading states for membership info while the profile doc streams in.
- Consider storing user-specific notes (field `personalNotes` or similar) in Firestore; if added, update `docs/SCHEMA_PROFILE.md`.

## Follow-up tasks
- Update `docs/SCHEMA_PROFILE.md` to capture any new fields (e.g., `personalNotes`, `notifyReservations`).
- Ensure AGENTS log captures the plan, marketing scan reminders, and the handoff to the marketing agent for curated assets.
- Track the TODO for staff roles (e.g., ability to confirm kiln reservations, escalate requests) in AGENTS or a dedicated backlog entry.
- Keep the `createReservation` Cloud Function in sync with the new Reservations view (schema, validation, error messaging) and document that trivia in AGENTS.
