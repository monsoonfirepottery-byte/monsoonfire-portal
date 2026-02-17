# P2 — Avatar Storage Rules Cleanup

Status: Completed

Date: 2026-02-17

Problem
- Client-side avatar upload flow now stores user photos under `profileAvatars/{uid}/{fileName}` and updates `photoURL`.
- Users cannot safely delete/rewrite their previous uploaded avatar, which can leave orphaned storage objects.

Scope
- `storage.rules`

Acceptance
- Add explicit owner-scoped delete permission for `profileAvatars/{uid}/{fileName}`:
  - `allow delete: if isSignedIn() && request.auth.uid == uid;`
- Confirm upload still requires image MIME and size limits for all write attempts.
- Validate with a quick emulator check that:
  - Owner can delete their own previous avatar object.
  - Non-owner cannot delete another user’s avatar object.

Notes
- Coordinate with Functions/storage-owner hardening if a separate asset lifecycle path exists.

Completion notes (2026-02-17)
- Updated `storage.rules` for `profileAvatars/{uid}/{fileName}`:
  - owner-or-staff read scope
  - owner write limit aligned to 3MB
  - explicit owner delete retained
