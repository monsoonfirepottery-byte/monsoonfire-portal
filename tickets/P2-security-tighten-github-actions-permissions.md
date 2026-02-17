# P2 — Security: Tighten GitHub Actions `GITHUB_TOKEN` Permissions

Status: Completed

**Problem**
- `.github/workflows/firebase-hosting-merge.yml` does not declare `permissions:`, so it uses GitHub defaults for `GITHUB_TOKEN`.
- Using least privilege reduces blast radius if any CI step/action is compromised.

**Tasks**
1. Add explicit `permissions:` blocks to workflows that currently omit them (at minimum `contents: read` unless more is required).
2. Confirm Firebase deploy workflows still have the permissions they need:
   - PR workflow already declares:
     - `checks: write`, `contents: read`, `pull-requests: write`
   - Merge workflow likely needs:
     - `contents: read`
     - any additional scopes required by `FirebaseExtended/action-hosting-deploy` (document if needed)
3. Ensure no workflows use `pull_request_target` unless required (none currently do).

**Acceptance**
- All workflows have explicit `permissions:` blocks.
- No workflow requests broader permissions than necessary.

**Progress**
- Added `permissions: contents: read` to workflows that previously relied on defaults.
- Kept PR hosting workflow's existing `checks/pull-requests` permissions as-is.
