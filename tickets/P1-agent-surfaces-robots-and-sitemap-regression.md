# P1 — Robots/Sitemap Regression Guard for Agent Surfaces

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Website + Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Adding new public discovery files can unintentionally regress existing `robots.txt` and `sitemap.xml` behaviors if deployment paths or rewrite assumptions drift.

## Objective

Protect existing SEO/discovery behavior while adding agent-readable files across website and portal.

## Scope

- `website/robots.txt`
- `website/sitemap.xml`
- `website/ncsitebuilder/robots.txt`
- `website/ncsitebuilder/sitemap.xml`
- portal hosting behavior in `firebase.json`

## Tasks

1. Capture pre-change behavior for website and portal robot/sitemap responses.
2. Add regression checklist for:
   - HTTP status
   - content-type
   - key directives/entries
3. Ensure `/llms.txt` and `/ai.txt` do not break sitemap generation/deploy assumptions.
4. Add deterministic verification hooks to smoke or CI scripts.
5. Document expected behavior in the agent surfaces runbook.

## Acceptance Criteria

1. Website `robots.txt` and `sitemap.xml` still return expected responses after agent-surface rollout.
2. Portal SEO/discovery behavior remains explicit and non-regressed.
3. Regression checks are deterministic and scriptable.

## Dependencies

- `website/robots.txt`
- `website/sitemap.xml`
- `firebase.json`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`

