# P1 — Cloud Request Capture and Operator Diagnostics Panel

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Problem

Cloud Function failures are hard to triage quickly without consistent request context.

## Objective

Capture and surface last request diagnostics for Cloud Function calls in an operator-friendly panel.

## Scope

- functions client wrappers
- request telemetry utilities
- advanced diagnostics panel wiring

## Tasks

1. Capture endpoint, method, redacted payload, status, response snippet, timestamp.
2. Include curl-equivalent redacted command.
3. Store globally for diagnostics panel consumers.
4. Surface in UI behind dev/advanced gating.

## Acceptance Criteria

1. Last request diagnostics are available after Cloud Function calls.
2. Sensitive fields are redacted by default.
3. Panel output includes request/support code for escalation.
