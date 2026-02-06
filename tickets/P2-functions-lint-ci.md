Status: Completed (2026-02-05)

# P2 - Add Functions lint to CI (or explicitly waive)

- Repo: functions / CI
- Area: Quality gate
- Evidence:
  - `.github/workflows/ci-smoke.yml` runs functions build but not `npm --prefix functions run lint`
- Recommendation:
  - Validate `functions` lint config works on current TS version, then add it as a CI step; otherwise document the explicit waiver pre-alpha and schedule cleanup post-alpha.
- Fix applied:
  - Adjusted `functions/.eslintrc.js` to remove Google style gating, ignore `archive/` and `scripts/`, and disable LF/CRLF enforcement and indent gating.
  - Added `Functions lint` step to `.github/workflows/ci-smoke.yml`.
- Effort: S-M
- Risk: Low
- What to test: CI remains stable; lint catches real issues (no noise-only failures).
