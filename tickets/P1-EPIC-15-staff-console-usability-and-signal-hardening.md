# Epic: P1 — Staff Console Usability and Signal Hardening

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Portal Staff Console + Studio Ops
Type: Epic
Parent Epic: docs/epics/EPIC-STAFF-CONSOLE-USABILITY-AND-SIGNAL-HARDENING.md

## Problem

Staff-console operators are seeing unreliable signals and cramped workflows that reduce trust and speed:

1. Studio Brain can appear falsely offline.
2. Cockpit lacks sufficient real estate for dense triage.
3. Roughly 80 suspicious batch artifacts need safe, auditable cleanup.
4. Member tier chiplets can diverge from true member type.

## Objective

Deliver a focused hardening slice that makes operational signals trustworthy, improves triage ergonomics, and restores data/UI parity for member and batch workflows.

## Scope

1. Studio Brain health-state semantics and disabled-mode UX.
2. Cockpit workspace and layout partitioning improvements.
3. Member tier derivation contract and chiplet rendering parity.
4. Batch artifact triage tooling and cleanup safety controls.
5. Policy single-source-of-truth alignment between website and portal/reports.

## Tasks

1. Execute `tickets/P1-staff-console-studiobrain-disabled-mode-and-health-signal-clarity.md`.
2. Execute `tickets/P1-staff-console-cockpit-dedicated-workspace-and-layout-split.md`.
3. Execute `tickets/P1-staff-console-member-tier-derivation-and-chiplet-parity.md`.
4. Execute `tickets/P1-staff-console-batch-artifact-triage-and-safe-cleanup.md`.
5. Execute `tickets/P1-policy-single-source-of-truth-website-portal-reports.md`.
6. Add a final cross-ticket verification pass for operator trust signals and UI parity.

## Acceptance Criteria

1. False Studio Brain offline warnings are eliminated under known healthy conditions.
2. Cockpit has a dedicated workspace path that measurably improves usable triage area.
3. Member tier chiplets always reflect authoritative member type in staff console views.
4. The suspicious batch artifact set is triaged and cleanup is executed with rollback-safe controls.
5. All child tickets are linked, owned, and moved through completion with evidence.

## Child Tickets

- tickets/P1-staff-console-studiobrain-disabled-mode-and-health-signal-clarity.md
- tickets/P1-staff-console-cockpit-dedicated-workspace-and-layout-split.md
- tickets/P1-staff-console-member-tier-derivation-and-chiplet-parity.md
- tickets/P1-staff-console-batch-artifact-triage-and-safe-cleanup.md
- tickets/P2-staff-console-firings-legacy-controls-deprecation.md
- tickets/P1-staff-console-sample-workshop-seeding-for-testing-and-canary.md
- tickets/P1-policy-single-source-of-truth-website-portal-reports.md

## Progress Snapshot (2026-02-28)

1. All child tickets listed above are completed with validation evidence captured in ticket-local logs/runbooks.
2. Dedicated Staff Console workspace routes now include both `/staff/cockpit` and `/staff/workshops` for focused triage contexts.
3. Operator trust-signal hardening passed web build/lint verification after workspace split updates.
