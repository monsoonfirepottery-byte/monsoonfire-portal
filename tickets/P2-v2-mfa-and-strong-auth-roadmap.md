Status: Open
Priority: P2
Labels: auth, security, v2-agentic, web

## Title
MFA and stronger auth roadmap for staff and high-risk operations

## Problem statement
High-risk actions (revocations, fulfillment overrides, financial actions) should eventually require stronger identity assurance.

## Scope
- Document staged MFA rollout plan.
- Define which actions require step-up auth.
- Propose feature flags and fallback behavior.

## Acceptance criteria
- Roadmap doc includes phased rollout and fallback.
- High-risk endpoint inventory is listed.
- Staff training notes include account recovery flow.

## Implementation notes
- Use Firebase MFA support where available.
- Keep local emulator workflow practical.

## Test plan
- Tabletop scenarios for lost second factor.
- Manual flow validation in staging before prod.

## Security notes
- Prevent MFA bypass on admin/staff paths.
- Audit every step-up challenge and failure.

