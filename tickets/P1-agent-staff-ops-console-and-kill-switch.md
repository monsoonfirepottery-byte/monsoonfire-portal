# P1 — Agent Staff Ops Console and Kill Switch

Status: Open

## Problem
- Staff need operational control of agent traffic without engineering intervention.
- Incident response is too slow without one-click containment.

## Goals
- Add a staff module to manage agent clients, trust policy, limits, and incident controls.
- Include emergency disable path for all agent endpoints.

## Scope
- Staff UI section: Agent clients, scopes, trust tiers, rate limits, allow/deny list.
- Global kill switch for agent endpoint availability.
- Per-client suspend/re-enable controls.

## Security
- Staff-only access at UI and function layer.
- Kill switch state stored in protected config doc.
- Every control change writes audit event with actor and reason.

## Acceptance
- Staff can suspend a single agent and disable all agent traffic globally.
- Changes propagate to enforcement middleware immediately.
- Audit timeline is visible in staff UI.
