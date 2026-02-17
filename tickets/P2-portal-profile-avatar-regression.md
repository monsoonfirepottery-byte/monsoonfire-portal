# P2 — Avatar Flow Regression Coverage

Status: Completed

Date: 2026-02-17

Problem
- Avatar defaults, upload replacement, and fallback behavior were recently hardened, but no dedicated regression check exists for the full workflow.

Scope
- Portal auth/profile upload path end-to-end (client + storage rules + profile persistence).
- Suggested test vehicle: Playwright UI checks plus a minimal script for storage rule validation.

Acceptance
- Validate new-user profile sees a default avatar (not blank/empty icon).
- Validate selecting a preset updates profile and syncs auth `photoURL`.
- Validate upload of a new avatar:
  - succeeds with valid image + constraints
  - rejects invalid MIME/oversize
  - replaces previous upload and removes previous object where expected
- Validate corrupted/missing avatar URL shows graceful fallback glyph without layout shift.
- Run checks in both Portal light + Memoria themes where practical.

Notes
- This ticket is meant for a dedicated QA/swarm pass; keep implementation scope separate from the UI/policy tweaks above.

Completion notes (2026-02-17)
- Added focused regression tests in `web/src/lib/profileAvatars.test.ts` covering:
  - stable default avatar data URL
  - UID sanitization for storage paths
  - extension resolution behavior
  - owner-scoped storage path parsing
  - PNG/JPEG/GIF/WEBP signature validation
- Added dedicated script entry for targeted runs:
  - `web/package.json` -> `test:avatar`
