---
slug: "storage-abandoned-work"
title: "Storage limits & abandoned work"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Studio Operations"
sourceUrl: "/policies/storage-abandoned-work/"
summary: "Pickup-ready work gets 2.75 weeks of grace by default, optional prepaid storage before billed storage starts, billed storage at $1.50 per half-shelf per day, and studio reclamation after 28 billed days."
tags:
  - "storage"
  - "pickup"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Pickup-ready timelines, prepaid-hold eligibility before billing, billed storage escalation, and studio reclamation."
  defaultActions:
    - "confirm the pickup-ready date and current storage timeline"
    - "confirm whether prepaid storage can still be added before billed storage starts and quote the flat prepaid hold or billed daily storage using half-shelf equivalents"
    - "share the covered-storage end, billing-start, billing-end, and reclamation dates anchored to readyForPickupAt before promising exceptions"
  allowedLowRiskActions:
    - "calculate covered-storage, billed-storage, and reclamation dates"
    - "quote flat prepaid storage and billed daily storage"
    - "confirm whether prepaid storage is still available before billing starts"
    - "send reminder-ready summaries using stored notice history"
  blockedActions:
    - "waive storage fees or reclamation timelines"
    - "restore reclaimed work without human approval"
    - "promise storage exceptions after billed storage has started"
  requiredSignals:
    - "readyForPickupAt"
    - "estimatedHalfShelves or storageBilling.chargeBasisHalfShelves"
    - "pickupReminderCount and storageNoticeHistory"
    - "contact methods on file"
  escalateWhen:
    - "artist disputes reclamation, ownership transfer, or notice history"
    - "legal or operations review is requested for abandoned work handling"
    - "staff wants to grant an exception after billed storage has started or reclamation has occurred"
  replyTemplate: "Share the pickup-ready date, covered-storage end date, current storage fees, and reclamation date before quoting next steps."
---

## Purpose

Define one clear storage timeline for pickup-ready work so artists know when reminders,
fees, and reclamation apply.

## Scope

Pickup-ready reservations and any finished work that remains at the studio after an
artist has been notified it is ready.

## Policy

- `readyForPickupAt` begins the storage timeline when a reservation reaches pickup-ready status.
- Artists receive a grace period of `19.25 days` (`462 hours`) after `readyForPickupAt`.
- During grace, the studio sends pickup reminders at:
  - `14 days`
  - `17.5 days`
  - `19.25 days` (final grace-period reminder)
- Artists may prepay extra pickup time before billed storage starts. Prepaid storage is
  charged at `$15 flat` and covers up to `4 weeks total from pickup-ready`.
- When prepaid storage is purchased, the portal extends the covered-storage cutoff to the
  `4-week` mark and shifts later reminder thresholds to match the longer hold window.
- Once the covered storage window ends, billed storage begins automatically at
  `$1.50 per half-shelf per day`.
  Billing accrues only for each fully elapsed 24-hour day.
- Billed storage is capped at `28 billed days`.
- Missing a confirmed pickup window does not pause, reset, or shorten the grace or billed
  storage timeline. The original `readyForPickupAt` date remains the anchor.
- When a reservation reaches the end of the 28 billed days, the work is considered
  abandoned and reclaimed by the studio.
- After reclamation:
  - ownership transfers to the studio,
  - the reservation may be archived from active storage workflows,
  - the studio may destroy, recycle, donate, sell, repurpose, photograph, copy, display,
    or otherwise use the reclaimed work without further notice or compensation.

## Automated reminder cadence (portal enforcement)

- `readyForPickupAt` starts when a reservation reaches loaded/pickup-ready state.
- Reminder 1: `14 days` after `readyForPickupAt`.
- Reminder 2: `17.5 days` after `readyForPickupAt`.
- Reminder 3 (final grace reminder): `19.25 days` after `readyForPickupAt`.
- `storageStatus` escalation:
  - `active` during early grace.
  - `reminder_pending` once reminders begin.
  - `hold_pending` during the 28-day billed storage window.
  - `stored_by_policy` once the reservation is reclaimed and archived by policy.
- `storageBilling` tracks:
  - `chargeBasis = "estimatedHalfShelves"`
  - `chargeBasisHalfShelves`
  - `prepaidWeeklyRatePerHalfShelf = 2` (legacy compatibility field)
  - `dailyRatePerHalfShelf = 1.5`
  - `graceEndsAt`, `billingStartsAt`, `billingEndsAt`
  - `billedDays`, `accruedCost`
  - `status = grace | billing | reclaimed`
  - `reclaimedAt`, `reclaimedReason`
- `isArchived` and `archivedAt` are set when reclamation occurs.
- Pickup-window miss handling:
  - if a confirmed/open pickup window elapses, the reservation auto-marks `missed`,
  - the missed pickup is recorded in notice history and audit logs,
  - the grace, billing, and reclamation timeline still follows the original pickup-ready date.
- Every notice/escalation writes an immutable-style entry to `storageNoticeHistory`
  plus audit rows in `reservationStorageAudit`.
- Reminder failures are tracked (`pickupReminderFailureCount`, `lastReminderFailureAt`) so
  no failed attempt is silent.
- Media reference retention:
  - piece photo URLs are treated as operational metadata and may expire/rotate at storage layer,
  - continuity exports include `hasPhoto` markers and piece IDs/labels/counts without exposing raw photo URLs,
  - staff incident notes should reference reservation/piece IDs rather than relying on direct media URL longevity.

## Implementation in portal

- Surface the grace-end date, billed storage summary, and reclamation state in reservation
  status views.
- Offer prepaid extra pickup time in the intake/check-in flow before billed storage begins.
- Show reclaimed reservations to staff and artists as `Reclaimed by studio`, even though the
  stored compatibility value remains `stored_by_policy`.
- Keep reminder history, billing accrual, and contact attempts tied to the reservation record.

## Enforcement

When the 28 billed storage days are exhausted, the work is reclaimed automatically and removed
from active storage workflows. Support or staff may review disputes, but exceptions require
operations approval.

## Support language

Support should confirm:

- the exact `readyForPickupAt` date/time
- the covered-storage end date and billed-storage end date
- whether prepaid storage was purchased or can still be added before billed storage begins
- the current accrued billed storage amount, if any
- whether missed pickup windows have already been recorded against the original `readyForPickupAt` timeline
- whether the reservation has already been reclaimed by studio policy

## Implementation notes

- This April 2, 2026 update carries forward the March 17, 2026 reminder cadence refresh and clarifies that prepaid holds must be added before billed storage starts.
- The March 17, 2026 update replaced the old 72h / 120h / 168h reminder cadence and the
  earlier 14-day removal workflow.
- Legal and operations review are still required before publishing future changes to storage
  pricing, abandonment language, or ownership-transfer terms.
