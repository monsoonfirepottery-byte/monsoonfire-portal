Status: Open (2026-02-05)

# P1 - CI gates run + remediation

- Repo: portal
- Area: CI / Quality
- Evidence: evidence pack requires green `Smoke Tests`, `Lighthouse Audit`, and `iOS macOS Smoke` runs.
- Recommendation:
  - Run CI workflows, fix failures, and record evidence links.
  - If any check is waived, capture the rationale + mitigation in the risk register.
- Prep applied:
  - Workflows now run on Node 22 (parity with functions runtime).
  - Smoke workflow now includes `npm --prefix functions run lint`.
- Update (2026-02-06): local equivalents are green (`npm --prefix web run lint/test:run/build/perf:chunks`, `npm --prefix functions run build/lint`). Remaining: run GitHub Actions and attach links in `docs/RELEASE_CANDIDATE_EVIDENCE.md`.
- Effort: M
- Risk: Med
- What to test: required workflows pass consistently without flaky failures.
