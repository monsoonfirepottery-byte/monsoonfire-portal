Status: Completed

# P1 - Release branch hygiene (reduce accidental scope)

- Repo: portal
- Area: Release hygiene
- Evidence: current worktree is broad with many modified/untracked files across web/functions/docs/ios/website.
- Recommendation:
  - Slice work into reviewable commits.
  - Remove stale/temp/debug artifacts from release scope.
  - Produce a release diff summary mapped to Sprint tickets.
- Update (2026-02-06): `firestore-debug.log`, `functions/firestore-debug.log`, `.npm-cache/`, and `.npm-cache-web/` are staged for deletion from git history moving forward (all ignored via `.gitignore`). Still need a commit-slicing/staging pass to ensure required `??` files (workflows, docs, scripts) land on the release branch.
- Update (2026-02-12): release slicing pass completed with mapped commit evidence:
  - `docs/RELEASE_DIFF_SUMMARY_2026-02-12.md`
  - small, reviewable commits mapped to ticket scope
  - ticket index sync after status changes to keep docs, board, and PR evidence aligned
- Effort: M
- Risk: High
- What to test: clean build/lint/test passes from the frozen release branch with only intended files included.
