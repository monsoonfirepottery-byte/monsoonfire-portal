Status: Completed (2026-02-11)

# P1 - Dependency/security audit triage (root/web/functions)

- Repo: portal
- Area: Security / Dependencies
- Evidence:
  - 2026-02-11 audits:
    - `npm audit` (repo root): `found 0 vulnerabilities`
    - `npm audit --omit=dev` (repo root): `found 0 vulnerabilities`
    - `npm --prefix web audit`: `found 0 vulnerabilities`
    - `npm --prefix web audit --omit=dev`: `found 0 vulnerabilities`
    - `npm --prefix functions audit`: `found 0 vulnerabilities`
    - `npm --prefix functions audit --omit=dev`: `found 0 vulnerabilities`
- Recommendation:
  - Run audits for root, `web/`, and `functions/`.
  - Patch high/critical issues that are low-risk pre-alpha; defer the rest with owner + timeline + mitigation.
- Update:
  - Root `npm audit` previously flagged `fast-xml-parser` (DoS) via transitive deps; resolved (see `tickets/P1-security-fix-root-npm-audit-fast-xml-parser.md`).
- Effort: M
- Risk: Med
- What to test: build and tests remain green after upgrades; no runtime regressions in auth or functions calls.
