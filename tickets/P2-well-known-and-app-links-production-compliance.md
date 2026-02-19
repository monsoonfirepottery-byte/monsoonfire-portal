# P2 — Well-Known and App Links Production Compliance

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Mobile + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

`website/.well-known` artifacts and app-link configuration are manually managed and can drift in placeholders, hostnames, or IDs.
Placeholders can pass local checks but break production and store-facing validation.

## Objective

Codify strict production checks for AASA, `assetlinks.json`, and callback-host contract alignment with app identifiers.

## Scope

- `website/.well-known/apple-app-site-association`
- `website/.well-known/assetlinks.json`
- `android/app/src/main/AndroidManifest.xml`
- `website/package.json` / production deploy config that serves `.well-known`
- `scripts/source-of-truth-deployment-gates.mjs` (new)
- `scripts/validate-well-known.mjs` (new)

## Tasks

1. Build a validator that checks:
   - placeholder tokens are absent in production mode
   - bundle identifiers / signing IDs match documented expectations
   - HTTPS hosts and associated domains are non-placeholder and valid
2. Add non-production guardrails so validation is strict in `prod`, `beta`, and `store-readiness`.
3. Add failure messages that include exact file path and key path inside file for fixes.
4. Add evidence output used by release and store-readiness artifacts.

## Acceptance Criteria

1. Validator fails on unresolved placeholder values in `.well-known` files for production-like modes.
2. Associated-domain IDs match the app router expectations (iOS + Android).
3. Validator can run via PR gate and local command and emits JSON evidence.

## Dependencies

- `website/.well-known/apple-app-site-association`
- `website/.well-known/assetlinks.json`
- `android/app/src/main/AndroidManifest.xml`
- `scripts/pr-gate.mjs`
