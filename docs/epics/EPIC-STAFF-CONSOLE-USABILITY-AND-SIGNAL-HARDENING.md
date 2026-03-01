# EPIC: STAFF-CONSOLE-USABILITY-AND-SIGNAL-HARDENING

Status: Active
Date: 2026-02-27
Priority: P1
Owner: Portal Staff Console + Studio Ops
Type: Epic
Epic Ticket: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Staff operators reported multiple trust and usability breakdowns in the staff console:

1. Studio Brain health shows false "offline" warnings even when service is reachable.
2. Cockpit does not provide enough real estate for high-volume triage workflows.
3. Approximately 80 suspicious batch artifacts need triage and safe cleanup.
4. Member tier chiplets do not always match the member's actual type.
5. Firings legacy controls (`sync/accept/debug`) add clutter to primary operations.
6. Testing/canary coverage needs stable sample workshop seed data.
7. Reports policy checks can drift from website policy publication state.

These issues increase operator cognitive load, reduce confidence in signals, and create avoidable risk during daily operations.

## Objective

Harden staff-console usability and operational signals so staff can trust health state, triage quickly, and act on accurate member and batch data.

## Scope

1. Health signal semantics and disabled-mode behavior for Studio Brain in staff surfaces.
2. Cockpit workspace and layout changes for better triage throughput.
3. Member tier derivation and UI chiplet parity with authoritative member type.
4. Batch artifact inventory, triage workflow, and safe cleanup controls.
5. Firings legacy controls deprecation path.
6. Sample workshop fixture seeding for deterministic testing/canary loops.
7. Policy source-of-truth unification across website and portal/report controls.

## Tasks

1. Define and ship Studio Brain disabled-mode + health signal clarity ticket.
2. Define and ship Cockpit dedicated workspace + layout split ticket.
3. Define and ship member tier derivation + chiplet parity ticket.
4. Define and ship batch artifact triage + safe cleanup ticket.
5. Define and ship firings legacy controls deprecation ticket.
6. Define and ship sample workshop seeding ticket.
7. Define and ship policy source-of-truth unification ticket.
5. Validate cross-ticket consistency for wording, diagnostics, and operator expectations.
6. Close epic only after all child ticket acceptance criteria are met.

## Acceptance Criteria

1. All four findings are represented as explicit, executable P1 tickets with owners.
2. Every child ticket includes a clear parent epic link and acceptance criteria.
3. Studio Brain warning state differentiates true offline from unknown/degraded conditions.
4. Cockpit supports a dedicated workspace mode with materially improved usable space.
5. Member tier chiplets match authoritative member type in all supported staff paths.
6. Suspicious batch artifacts are triaged and cleaned up with audit-safe guardrails.

## Child Tickets

- tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md
- tickets/P1-staff-console-studiobrain-disabled-mode-and-health-signal-clarity.md
- tickets/P1-staff-console-cockpit-dedicated-workspace-and-layout-split.md
- tickets/P1-staff-console-member-tier-derivation-and-chiplet-parity.md
- tickets/P1-staff-console-batch-artifact-triage-and-safe-cleanup.md
- tickets/P2-staff-console-firings-legacy-controls-deprecation.md
- tickets/P1-staff-console-sample-workshop-seeding-for-testing-and-canary.md
- tickets/P1-policy-single-source-of-truth-website-portal-reports.md
