# P2 — Mobile Store Readiness Evidence Gate

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Mobile + Product
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Store submission checks (AASA, app links, deep-link contracts, callbacks, identity) are not tied to one gate artifact.
Current checks are fragmented and hard to replay in one deterministic review step.

## Objective

Create a reproducible store-readiness evidence gate that packages all mobile compatibility checks behind a single command.

## Scope

- `ios/PortalContracts.swift`
- `ios/DeepLinkRouter.swift`
- `android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt`
- `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`
- `android/app/src/main/AndroidManifest.xml`
- `website/.well-known/*`
- `docs/IOS_RUNBOOK.md`
- `docs/MOBILE_PARITY_TODOS.md`
- `scripts/source-of-truth-deployment-gates.mjs`
- `scripts/mobile-store-readiness-gate.mjs` (new)

## Tasks

1. Build store readiness command that validates:
   - iOS router + contract parity
   - Android manifest + intent-filter contracts
   - deep-link callback host expectations
   - `.well-known` non-placeholder content
2. Generate signed evidence artifact:
   - `output/mobile-store-readiness/latest.json`
   - include route parity map and deep-link proof list
3. Wire evidence artifact into PR/release gate and release handoff documentation.
4. Add manual override guardrails for legacy app builds until migration completes.

## Acceptance Criteria

1. Gate produces deterministic output and never passes with placeholders in production targets.
2. Deep-link route coverage is complete across web contract + iOS + Android mirrors.
3. Artifact is consumed by release docs and linked from deployment evidence summary.
