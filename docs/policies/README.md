# Policy documentation source

This folder is the canonical policy source for website policy pages and support
references.

## Policy source of truth

- Each policy is documented in its own Markdown file under this folder.
- The canonical slug should match the website route under `/policies/`.
- If a policy behavior changes, edit these files first and then run:
  - `node website/scripts/sync-policies.mjs`
  - this generates `docs/policies/policies-index.json` and `/website/data/policies.json`

## Policy files

| Slug | Document | Web page |
| --- | --- | --- |
| `studio-access` | `studio-access.md` | `/policies/studio-access/` |
| `safety-kiln-rules` | `safety-kiln-rules.md` | `/policies/safety-kiln-rules/` |
| `clay-materials` | `clay-materials.md` | `/policies/clay-materials/` |
| `firing-scheduling` | `firing-scheduling.md` | `/policies/firing-scheduling/` |
| `storage-abandoned-work` | `storage-abandoned-work.md` | `/policies/storage-abandoned-work/` |
| `damage-responsibility` | `damage-responsibility.md` | `/policies/damage-responsibility/` |
| `payments-refunds` | `payments-refunds.md` | `/policies/payments-refunds/` |
| `community-conduct` | `community-conduct.md` | `/policies/community-conduct/` |
| `accessibility` | `accessibility.md` | `/policies/accessibility/` |
| `media-accessibility` | `media-accessibility.md` | `/policies/media-accessibility/` |

## Maintenance contract

Each policy document includes metadata fields at the top and agent action metadata in
frontmatter:

- `slug`
- `title`
- `status`
- `version`
- `effectiveDate`
- `reviewDate`
- `owner`
- `sourceUrl`
- `agent` object with canActForSelf/canActForOthers defaults, required signals,
  escalation rules, and response templates.

Before publishing policy edits:

1. Update status/version/effectiveDate/reviewDate.
2. Record rationale and any workflow impact in the `Implementation` section.
3. Confirm portal behavior aligns with the text on:
   - `/support` policy summaries
   - `/policies/*` route content
4. Maintain the agent action layer in each policy file frontmatter (`agent` block).
5. Regenerate policy outputs with `node website/scripts/sync-policies.mjs`.
6. Run `npm run lint:policies` before merging policy-authored changes.
7. Run single-source parity checks from:
   - `docs/runbooks/POLICY_SINGLE_SOURCE_OF_TRUTH_WEBSITE_PORTAL_REPORTS.md`

## Frontmatter template

```yaml
slug: "studio-access"
title: "Studio access & supervision"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/studio-access/"
summary: "Reservations are required for all visits..."
tags:
  - "studio"
  - "access"
  - "supervision"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Reservations, check-in, and supervision."
  defaultActions:
    - "check reservation status and share upcoming access steps"
    - "verify whether a request requires supervision flagging"
  requiredSignals:
    - "user category and account"
    - "reservation id or preferred window"
  escalateWhen:
    - "safety or occupancy risk"
    - "repeated no-shows or access policy breaches"
  replyTemplate: "Share reservation requirements and access steps."
```

## Agent workflow

- Agent action guidance lives in `docs/policies/AGENT_POLICY_ACTIONS.md`.
- Core machine-readable fields are in each policy file `agent` frontmatter block, then compiled
  into `docs/policies/policies-index.json` by sync.
- If a case requires acting on someone else’s behalf, verify delegated context and
  route through `escalateWhen` criteria before completing state changes.

## Suggested workflow cadence

- Review every 90 days at minimum.
- Legal/operations review before any refund, damage, or storage policy change.
- Keep urgent change notes in ticket history if support responses are affected.
