Status: Open
Priority: P1
Labels: auth, security, web, v2-agentic

## Title
Web session/token storage hardening pass

## Problem statement
Token handling strategy needs explicit hardening guidance for SPA and future native parity.

## Scope
- Document current token persistence choices.
- Reduce risk of long-lived bearer exposure.
- Add strict-mode option for Firebase revocation check.

## Acceptance criteria
- Security doc updated with storage and revocation strategy.
- `STRICT_TOKEN_REVOCATION_CHECK` behavior documented.
- No new token secrets added to localStorage.

## Implementation notes
- Keep dev tooling (`sessionStorage` for dev admin token) emulator-only.

## Test plan
- Manual checks: sign-in, refresh, sign-out, token refresh.
- Verify no PAT/delegated token persisted by client automatically.

## Security notes
- Follow OWASP session guidance.
- Prefer short-lived delegated tokens + server-side grant checks.
