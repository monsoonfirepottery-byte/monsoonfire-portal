---
slug: "storage-abandoned-work"
title: "Storage limits & abandoned work"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/storage-abandoned-work/"
summary: "Storage limits depend on membership tier and available space. Long-abandoned work may move through notice and follow-up steps."
tags:
  - "storage"
  - "memberships"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Stale-item notification, pickup reminders, and storage hold escalation."
  defaultActions:
    - "check piece age and membership tier"
    - "issue/remind pickup and hold-status notification"
    - "route items near retention boundary for review"
  requiredSignals:
    - "last pickup status update"
    - "membership tier and hold duration"
    - "contact method on file"
  escalateWhen:
    - "extended hold beyond policy boundary"
    - "dispute over prior notice"
    - "storage capacity conflict affecting active batches"
  replyTemplate: "State current hold status, reminder obligations, and next action date before any removal step."
---

## Purpose

To define transparent storage expectations and prevent studio floor crowding.

## Scope

Completed and in-progress work not yet collected, including work waiting beyond normal
pickup windows.

## Policy

- Storage limits vary by membership tier and available shelf capacity.
- Users should confirm pickup windows before a piece is considered abandoned.
- The studio will make good-faith efforts to notify before any removal or disposal actions.
- Extended storage beyond policy windows can move into priority storage tiers or removal
  workflow.

## Automated reminder cadence (portal enforcement)

- `readyForPickupAt` starts when a reservation reaches loaded/pickup-ready state.
- Reminder 1: ~72 hours after `readyForPickupAt`.
- Reminder 2: ~120 hours after `readyForPickupAt`.
- Reminder 3 (final): ~168 hours after `readyForPickupAt`.
- `storageStatus` escalation:
  - `active` -> `reminder_pending` once reminders start.
  - `hold_pending` around ~240 hours.
  - `stored_by_policy` around ~336 hours (14 days), with staff review required before any disposal action.
- Pickup-window miss handling:
  - if a confirmed/open pickup window elapses, status auto-marks `missed`,
  - first miss moves reservation to `hold_pending`,
  - repeated misses escalate to `stored_by_policy` without requiring manual queue edits.
- Every notice/escalation writes an immutable-style entry to `storageNoticeHistory`
  plus audit rows in `reservationStorageAudit`.
- Reminder failures are tracked (`pickupReminderFailureCount`, `lastReminderFailureAt`) so
  no failed attempt is silent.
- Media reference retention:
  - piece photo URLs are treated as operational metadata and may expire/rotate at storage layer,
  - continuity exports include `hasPhoto` markers and piece IDs/labels/counts without exposing raw photo URLs,
  - staff incident notes should reference reservation/piece IDs rather than relying on direct media URL longevity.

## Implementation in portal

- Surface pickup due dates and storage warnings in status views.
- Route long-stale items to a follow-up path before actions are scheduled.
- Keep written notices and contact attempts tied to the account record.

## Enforcement

When notices are exhausted and storage is still needed for operations, removal actions may be
taken according to active workflow and retention thresholds.

## Support language

Support should confirm:

- last known status and hold period
- whether storage notices were delivered
- collection options and potential fees if applicable
