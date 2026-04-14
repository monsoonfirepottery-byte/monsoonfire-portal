# P1 — Website and portal canonical handoff and login parity

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Website + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

Public pages still send users to more than one portal destination. That creates immediate doubt about which system is current and whether login/account state is split across environments.

## Tasks

1. Audit all public-facing website and `ncsitebuilder` portal/login/create-account links.
2. Standardize them to the canonical `https://portal.monsoonfire.com` destination and preserve task intent with `data-portal-target` or equivalent metadata where applicable.
3. Update any content JSON, scripts, or config that still reference `monsoonfire.kilnfire.com` for user-facing handoffs.
4. Add or extend deterministic checks that fail when a legacy portal host leaks back into public surfaces.

## Acceptance Criteria

1. No public website page links users to `monsoonfire.kilnfire.com`.
2. Primary CTAs use consistent, user-intent-driven wording.
3. Automated checks fail if a legacy user-facing portal host is reintroduced.

## Dependencies

- `website/**/*.html`
- `website/ncsitebuilder/**/*.html`
- `website/data/**/*.json`
- `website/assets/js/main.js`
- `website/ncsitebuilder/assets/js/main.js`
- `website/tests/marketing-site.spec.mjs`
