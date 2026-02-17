# P2 — Portal Profile Avatar Hardening

Status: Completed

Date: 2026-02-17

Problem
- `ProfileView` now supports upload + preset/default avatar selection, but upload lifecycle and lifecycle cleanup are not fully hardened.
- Profile image writes happen directly from UI uploads, and old uploaded avatar artifacts are not reclaimed.
- Storage authz and client validation should be tightened with regression coverage before the next major portal polish batch.

Current Scope
- `web/src/views/ProfileView.tsx`
- `storage.rules`
- `web/src/lib/profileAvatars.ts`

Acceptance Criteria
- Enforce stronger upload hardening before writing avatar URLs:
  - Validate MIME + file size on client and server-facing rules
  - Optionally validate image dimensions on upload path (if added through a helper)
  - Reject non-image data that could slip past MIME checks
- Implement replace-to-default cleanup behavior:
  - When a user selects/uploades a new avatar, optionally remove prior custom avatar object tied to user profile
  - Keep `photoURL` consistent with current user auth profile
- Improve resilience on avatar rendering:
  - Ensure invalid/missing avatar URLs never leave blank UI and always show default icon
- Add a lightweight regression test or script to cover:
  - new-user default avatar assignment
  - upload -> replace -> fallback semantics

Swarm Handoff
- Split into:
  - `tickets/P2-portal-profile-avatar-storage-rules.md`
  - `tickets/P2-portal-profile-avatar-ui-polish.md`
  - `tickets/P2-portal-profile-avatar-regression.md`

Notes
- Prioritize this after current "portal profile UX" work lands to reduce regression risk.

Completion notes (2026-02-17)
- Hardened client-side avatar upload path in `web/src/views/ProfileView.tsx`:
  - centralized avatar constants and helpers from `web/src/lib/profileAvatars.ts`
  - strict MIME allowlist + size gate + signature validation
  - dimension checks remain enforced in browser runtime
  - replace/default flows retain best-effort cleanup of previous uploaded blobs
- Hardened storage rules in `storage.rules` for profile avatar objects.
- Added dedicated regression coverage and a targeted test script for avatar helper behavior.
