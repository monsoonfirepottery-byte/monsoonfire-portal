Status: Completed
Priority: P2
Labels: auth, security, functions, v2-agentic

## Title
Auth blocking functions and sign-in risk hooks roadmap

## Problem statement
Sign-in risk hooks are not yet used to enforce additional controls on suspicious auth events.

## Scope
- Evaluate Firebase Auth blocking functions for sign-up/sign-in policy hooks.
- Define low-friction fraud/abuse checks and deny reasons.

## Acceptance criteria
- Design doc for blocking events included.
- Clear go/no-go criteria for production enablement.
- Minimal implementation spike ticket linked.

## Implementation notes
- Start in log-only mode before deny mode.

## Test plan
- Simulated suspicious sign-in scenarios.
- Verify denial reason observability.

## Security notes
- Avoid false-positive lockouts.
- Include safe manual override process.
