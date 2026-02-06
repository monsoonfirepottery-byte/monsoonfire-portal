Status: Open (2026-02-05)

# P1 - Dependency/security audit triage (root/web/functions)

- Repo: portal
- Area: Security / Dependencies
- Evidence: `npm audit` vulnerability remediation is not captured in evidence; upgrades landed but triage remains.
- Recommendation:
  - Run audits for root, `web/`, and `functions/`.
  - Patch high/critical issues that are low-risk pre-alpha; defer the rest with owner + timeline + mitigation.
- Update (2026-02-06): build/lint/tests are green locally, but `npm audit` triage is still pending and likely requires registry/network access (or running on a machine with full network access).
- Effort: M
- Risk: Med
- What to test: build and tests remain green after upgrades; no runtime regressions in auth or functions calls.
