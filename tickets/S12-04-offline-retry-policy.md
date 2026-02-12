# S12-04 - Offline + Retry Policy for Write Actions

Created: 2026-02-10
Sprint: 12
Status: Open
Swarm: D (QA + CI)

## Problem

On native, offline is common. We need a policy that clearly classifies which write actions:
- must be online (blocking)
- can be queued (retryable)

This avoids ad-hoc behavior differences between web/iOS/Android.

## Tasks

- Inventory write actions and classify:
  - Reservations submit (`createReservation`)
  - continue journey (`continueJourney`)
  - kiln unload/load actions
  - event signup/cancel/check-in
  - device token registration/unregistration
- Define idempotency strategy for queueable actions:
  - request IDs, dedupe keys, safe retries
- Define UI behavior:
  - queued state
  - retry status
  - "needs attention" UX for permanent failures
- Implement parity helpers:
  - iOS: `RetryExecutor.swift` + queued action model
  - Android: equivalent executor and persistence rules

## Acceptance

- In airplane mode, the app communicates what will happen and never silently drops writes.
- When coming back online, queued actions retry and converge without duplicates.
