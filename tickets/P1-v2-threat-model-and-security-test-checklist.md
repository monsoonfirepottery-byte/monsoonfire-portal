Status: Open
Priority: P1
Labels: security, auth, v2-agentic, firestore-rules, functions, web

## Title
Living threat model + security regression checklist for V2 agentic identity

## Problem statement
Without a living threat model and reproducible tests, auth hardening can regress during rapid shipping.

## Scope
- Capture threats: token theft/replay, delegation abuse, confused deputy, escalation, data exfiltration.
- Define repeatable test matrix for unit/integration/rules/manual drills.

## Acceptance criteria
- Threat model doc versioned under `docs/`.
- Security checklist includes pass/fail criteria per threat.
- Release checklist references this test matrix.

## Implementation notes
- Keep severity + likelihood ratings and owners.

## Test plan
- Unit tests for authz helper decisions.
- Integration tests for privileged endpoints.
- Firestore rules emulator tests for ownership boundaries.

## Security notes
- Every privileged action must have audit evidence.
- Include incident response linkage for failed controls.

