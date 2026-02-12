Status: Completed

# P0 - Repo security pass (Ralph loop style) — 2026-02-11

## Scope
- Supply chain:
  - `npm audit` for root, `web/`, `functions/`
  - GitHub Actions action pinning + `GITHUB_TOKEN` permissions
- Secrets:
  - scan for common key formats and accidental `.env` commits
- AuthZ/AuthN:
  - Firebase ID token flows
  - PAT (integration token) flows
  - Firestore rules alignment for any new server-side reads/writes

## Checks Run (evidence)
- Dependency audit:
  - `npm audit` (root/web/functions): `found 0 vulnerabilities`
  - `npm audit --omit=dev` (root/web/functions): `found 0 vulnerabilities`
- Secrets:
  - Confirmed only example env files are tracked:
    - `functions/.env.local.example`
    - `web/.env.example`
  - Searched for common secret patterns in source + workflows; no committed secrets found.
- CI hardening:
  - Third-party actions pinned + explicit permissions blocks (see related tickets).

## Findings
1) API v1 authz mismatch with Firestore rules (editors could read batch doc via v1)
  - Fixed and ticketed:
    - `tickets/P1-security-api-v1-batchdoc-editor-access.md`

2) Rate limit docs stored raw IP in Firestore doc IDs
  - Fixed and ticketed:
    - `tickets/P2-security-hash-ip-in-rate-limits.md`

## Related tickets
- `tickets/P1-security-fix-root-npm-audit-fast-xml-parser.md` (completed)
- `tickets/P2-security-pin-github-actions.md` (completed)
- `tickets/P2-security-tighten-github-actions-permissions.md` (completed)
- `tickets/P1-dependency-audit-triage.md` (now completed)
