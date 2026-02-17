# Agent Work Intake Policy

## Scope
Applies to agent-originated capability proposal and execution attempts in Studio OS v3.

## Categories
- `illegal_content`
- `weaponization`
- `ip_infringement`
- `fraud_risk`
- `unknown`

## Default Behavior
- High-risk categories (`illegal_content`, `weaponization`, `ip_infringement`, `fraud_risk`) are routed to manual review and blocked from progression.
- `unknown` is allowed to continue under existing capability and approval controls.

## Staff Override
- Override decisions are staff-only and require both reason code and rationale.
- Allowed reason code prefixes:
  - grant: `staff_override_`
  - deny: `policy_`
- All decisions are append-only audit events.

## Audit Events
- `intake.classified`
- `intake.routed_to_review`
- `intake.override_granted`
- `intake.override_denied`
