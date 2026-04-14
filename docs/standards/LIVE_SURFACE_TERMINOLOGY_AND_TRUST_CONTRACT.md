# Live Surface Terminology And Trust Contract

Status: Active  
Date: 2026-04-14  
Owners: Website + Portal + Design

## Purpose

Keep `monsoonfire.com` and `portal.monsoonfire.com` speaking the same language about service state, user intent, and trust signals.

This is a lightweight contract. It exists so future work does not reintroduce mixed terms, stale-state ambiguity, or generic fallback copy.

## Shared Vocabulary

| Concept | Canonical Term | Use It For | Avoid |
| --- | --- | --- | --- |
| Member landing surface | `Start here` | The first member-facing home surface in the portal | `Dashboard` when the goal is onboarding, orientation, or next-action guidance |
| New work intake | `Ware Check-in` | Dropping off or registering work for studio handling | `Reservation` when the task is actually intake |
| Studio time booking | `Reservations` | Booking shared tools, stations, or studio access windows | `Check-in` for advance scheduling |
| Work visibility | `My Pieces` | Member-facing view of current stage, latest update, and next step | `Batches` as a primary member label |
| Queue visibility | `View the queues` | Member-facing queue timing and current load state | `Launch`, `ops queue`, or internal firing jargon |
| Ready state | `Ready for pickup` | Work that has completed firing, cooling, and staging | `Complete` without pickup context |
| Freshness state | `Current`, `Stale`, `Unavailable` | Operational data recency and confidence | Raw `Loading...` or silent timestamp gaps |
| Event certainty | `Confirmed`, `Tentative` | Public program/event confidence | `TBD` as the main status signal |
| Guided fallback | `This area is not ready for live studio work yet.` | Unknown or unfinished areas that need recovery guidance | `Coming soon` as standalone production copy |

## Member-Facing Journey Terms

Use these stage terms consistently whenever explaining what happens to work:

1. `Ware Check-in`
2. `Queued`
3. `Firing`
4. `Cooling`
5. `Ready for pickup`

Supporting phrases:

- `Latest update`
- `Next step`
- `What happens next`

Do not switch between synonyms like `loaded`, `submitted`, `processing`, or `complete` unless the UI also explains how they map to the canonical journey.

## Trust State Patterns

### Status Chips

Use a small, explicit label for current certainty:

- `Current`
- `Stale`
- `Unavailable`
- `Confirmed`
- `Tentative`

### Freshness Rows

Operational cards should show one of:

1. A valid timestamp.
2. An intentional stale state with guidance.
3. An intentional unavailable state with guidance.

Do not leave a production surface in a raw loading-first state once fetch resolution is known.

### Journey Guidance

Member work surfaces should answer:

1. Where is my work now?
2. What changed last?
3. What happens next?

### Guided Fallback Cards

Fallback states should include:

1. Plain-language explanation.
2. A recovery path.
3. A human contact path when recovery is unclear.

## Copy Rules

1. Prefer calm, operational language over marketing flourish on service-state surfaces.
2. Prefer `portal` and `studio` over legacy host or migration language.
3. Never imply a live state without either current data or an explicit stale/unavailable label.
4. Never use internal staff shorthand as the primary member-facing label.

## Current Implementations

This contract now maps to active implementation work in:

- `website/assets/js/kiln-status.js`
- `website/assets/js/updates.js`
- `website/tests/legacy-host-guard.test.mjs`
- `web/src/views/DashboardView.tsx`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/MyPiecesView.tsx`
- `web/src/views/PlaceholderView.tsx`

## Follow-On Rule

Any future website or portal change that introduces a new service-state label, fallback pattern, or freshness term should either:

1. Reuse a term from this contract, or
2. Update this document in the same change.
