# Live Surface Audit — Website + Portal (2026-04-15)

Status: Completed  
Date: 2026-04-15  
Owner: Product + Portal Ops  
Scope: `https://portal.monsoonfire.com`, `https://monsoonfire.com`

## Evidence captured

- Public portal smoke: `output/playwright/portal/prod/portal-smoke-summary.json`
- Public website smoke: `output/playwright/prod/smoke-summary.json`
- Phase-1 website handoff verification: `output/playwright/prod-phase1-website/smoke-summary.json`
- Authenticated portal canary: `output/qa/portal-authenticated-canary-rc1.json`
- Live Lighthouse sweep: `output/qa/lighthouse-live-2026-04-15T16-38-08Z/`
- Direct live HTML fetches and a Playwright Google-auth handoff trace run on 2026-04-15

## Executive summary

- The public portal entry and the main website routes render successfully in live production.
- The authenticated portal surface is currently healthy. The live staff canary passed route canonicalization, dashboard click-through, notifications, messages, workshops, ware check-in, and diagnostics.
- `RC issue 1`: the live Google login path is not using the documented custom auth handler domain. Clicking Google on `https://portal.monsoonfire.com` currently redirects through `https://monsoonfire-portal.firebaseapp.com/__/auth/handler`, and the live bundle does not contain `auth.monsoonfire.com`.
- The initial live audit captured legacy `https://monsoonfire.kilnfire.com` handoff links across the core website pages. A same-day follow-up redeploy added a phase-aware website handoff switch and intentionally kept the public website on the legacy host while phase 2 remains deferred.

## Lighthouse summary

| URL | Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- |
| `https://portal.monsoonfire.com` | 66 | 100 | 100 | 91 |
| `https://monsoonfire.com/` | 69 | 96 | 100 | 100 |
| `https://monsoonfire.com/services/` | 75 | 94 | 100 | 100 |
| `https://monsoonfire.com/kiln-firing/` | 74 | 96 | 100 | 100 |
| `https://monsoonfire.com/memberships/` | 75 | 96 | 100 | 100 |
| `https://monsoonfire.com/contact/` | 75 | 96 | 100 | 100 |
| `https://monsoonfire.com/support/` | 74 | 98 | 100 | 100 |

## Navigation findings

### 1. RC issue 1 — Google login does not cycle cleanly through the live portal

- Severity: P0
- Status: open
- User report: Google login auth does not cycle the user through to the portal.
- Direct evidence:
  - The live portal bundle contains `monsoonfire-portal.firebaseapp.com` and does not contain `auth.monsoonfire.com`.
  - Clicking the live Google sign-in control redirects first to:
    - `https://monsoonfire-portal.firebaseapp.com/__/auth/handler?...&redirectUrl=https%3A%2F%2Fportal.monsoonfire.com%2F...`
  - The subsequent Google OAuth request uses:
    - `redirect_uri=https://monsoonfire-portal.firebaseapp.com/__/auth/handler`
- Assessment:
  - This does not prove the final round-trip fails for every account, because the trace stopped before credential entry.
  - It does prove that the production build is not using the custom auth-domain setup documented in `docs/AUTH_DOMAIN_SETUP.md`, which is a strong release-candidate config mismatch for redirect-based auth on the live custom domain.
- Exit condition:
  - operator-verified Google sign-in returns to an authenticated session on `https://portal.monsoonfire.com`, or
  - the live build is republished with the intended auth handler domain and the round-trip is reverified.

### 2. Website public-to-portal handoff held on the legacy Kilnfire host for phase 1

- Severity: tracking
- Status: mitigated by phased rollout decision
- Initial direct evidence from live HTML fetches:

| Live page | Legacy links observed |
| --- | --- |
| `/` | `https://monsoonfire.kilnfire.com` |
| `/services/` | `https://monsoonfire.kilnfire.com`, `https://monsoonfire.kilnfire.com/new-user` |
| `/kiln-firing/` | `https://monsoonfire.kilnfire.com`, `https://monsoonfire.kilnfire.com/new-user` |
| `/memberships/` | `https://monsoonfire.kilnfire.com`, `https://monsoonfire.kilnfire.com/new-user` |
| `/contact/` | `https://monsoonfire.kilnfire.com`, `https://monsoonfire.kilnfire.com/new-user` |
| `/support/` | `https://monsoonfire.kilnfire.com` |

- Phase-1 disposition:
  - The live website was redeployed later on 2026-04-15 with an explicit deploy-time handoff host switch.
  - Public website pages now intentionally continue to send users to `https://monsoonfire.kilnfire.com` until operator approval for the phase-2 cutover.
  - Verification evidence is captured in `output/playwright/prod-phase1-website/smoke-summary.json`.

## Verified non-issues in this refresh

- Public portal entry loads in signed-out mode without route errors.
- Public website smoke passed on desktop and mobile for `/`, `/services/`, `/kiln-firing/`, `/memberships/`, `/contact/`, and `/support/`.
- Authenticated portal canary passed:
  - dashboard piece click-through
  - staff route canonicalization and fallback recovery
  - nav dock and flyout behavior
  - legacy request deep-link recovery
  - notifications, messages, workshops, ware check-in, and diagnostics

## Recommended next actions

1. Rebuild and redeploy the live portal with the intended auth handler domain if `auth.monsoonfire.com` is the production plan, then re-run a real Google sign-in round-trip check.
2. Run an operator-owned Google sign-in round-trip on `https://portal.monsoonfire.com` and close `RC issue 1` only after confirming the authenticated return path.
3. When phase 2 is approved, redeploy the website with `portal.monsoonfire.com` as the public handoff host and refresh the live smoke evidence.
