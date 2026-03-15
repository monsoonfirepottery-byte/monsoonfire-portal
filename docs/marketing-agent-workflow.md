# Agent-Only Marketing V1 Runbook

## Source of truth

- Announcement source docs live in `marketing/announcements/`.
- Public website output is generated into `website/data/announcements.json`.
- Portal sync payload is generated into `artifacts/marketing/portal-announcements-sync-latest.json`.
- The portal still reads from Firestore `announcements`, but only after a reviewed sync.

## Commands

- `npm run marketing:announce:build`
  Builds and validates the shared announcement feed.
- `npm run marketing:announce:check`
  Runs the end-to-end dry-run check: source validation, website JSON generation, and portal sync dry-run.
- `npm run marketing:announce:sync`
  Dry-run portal sync. Produces payload details without writing to Firestore.
- `npm run marketing:announce:sync:apply`
  Applies the synced portal announcements to Firestore after review.
- `npm run marketing:analyze:weekly`
  Generates the weekly marketing brief from the GA/reporting scripts and the current live announcement set.
- `npm run marketing:analyze:weekly -- --refresh`
  Refreshes the prerequisite GA reports first, then writes a new brief.

## Announcement workflow

1. Pull or copy approved source material into repo-managed assets under `website/`.
2. Draft a new JSON document in `marketing/announcements/` with the right audience flags.
3. Keep `status` as `draft` until a person reviews it.
4. Flip to `approved`.
5. Run `npm run marketing:announce:build`.
6. Run `npm run marketing:announce:sync`.
7. After approval, run `npm run marketing:announce:sync:apply`.
8. Deploy the website through the existing site workflow.

## Guardrails

- Social platforms are out of scope for V1.
- Email and newsletter workflows are deferred.
- Public website content comes from static JSON, not public Firestore reads.
- Managed portal mirror docs are namespaced with `marketing-` document IDs and `sourceSystem = "marketing-feed-v1"`.
- The sync script only cleans up docs created by this marketing feed namespace.
