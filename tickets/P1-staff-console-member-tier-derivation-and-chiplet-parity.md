# P1 — Staff Console: Member Tier Derivation and Chiplet Parity

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Staff Console + Data Contracts
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Member tier chiplets in staff surfaces do not always reflect actual member type. This mismatch introduces support risk and can lead to incorrect operational decisions.

## Objective

Align member-tier UI chiplets with authoritative member type derivation so staff sees the correct tier state everywhere.

## Scope

1. Member tier derivation rules and precedence.
2. Staff UI chiplet rendering parity across relevant views.
3. Validation/diagnostic pathways for detecting and resolving mismatches.

## Tasks

1. Document authoritative member type source and tier derivation precedence.
2. Standardize chiplet rendering to consume the same derived tier contract across staff views.
3. Add mismatch detection logging/flagging for audit and triage.
4. Add regression cases for each supported member type/tier transition.
5. Confirm parity in key staff workflows (list views, details, and action panels).

## Acceptance Criteria

1. Chiplet tier matches authoritative member type for all covered staff paths.
2. No known mismatch cases remain for current member records.
3. Regression checks cover tier transitions and edge cases.
4. Any future mismatch is detectable via explicit diagnostics.
5. Staff no longer needs manual cross-checks to trust displayed member tier.

## Completion Evidence (2026-02-27)

- Member-role derivation now checks a broader fallback role contract (`role`, `userRole`, `memberRole`, `staffRole`, `profileRole`, `accountRole`) and claim aliases (`claims`, `customClaims`, `authClaims`) in [`web/src/views/StaffView.tsx`](/home/wuff/monsoonfire-portal/web/src/views/StaffView.tsx).
- Membership-tier derivation now supports nested membership/subscription/profile objects (for example `membership.tier`, `membership.plan.tier`, `subscription.planName`) so non-string top-level fields no longer collapse to a single default tier.
- Members table now includes a visible `Membership` column for parity checks at list level in [`web/src/views/StaffView.tsx`](/home/wuff/monsoonfire-portal/web/src/views/StaffView.tsx).
