Status: Completed
Priority: P1
Labels: auth, security, v2-agentic, functions

## Title
Implement server-side actor authorization helper

## Problem statement
Authorization logic is duplicated across handlers and risks inconsistent owner/scope enforcement.

## Scope
- Standardize `assertActorAuthorized` usage in privileged routes.
- Enforce owner binding + scope checks + delegation validation in strict mode.

## Acceptance criteria
- Shared helper is used by API v1 and agent payment path.
- Helper supports staff bypass only when explicitly allowed.
- Denials return consistent code/message pairs.

## Implementation notes
- Keep helper stateless and request-context based for iOS parity.
- Attach requestId in denial logs.

## Test plan
- Unit tests: valid, expired, revoked, wrong owner, missing scope.
- Negative tests for forged ownerUid payloads.

## Security notes
- Client-side checks remain UX-only.
- Server helper remains canonical enforcement.
