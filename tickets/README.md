# Tickets

This folder contains short, executable tickets used by the swarm board and sprint plans.

Conventions:
- Filename: `P0-*`, `P1-*`, `P2-*`, `S12-*` etc.
- Each ticket should include: problem, tasks, acceptance, and any dependencies.
- Keep secrets out of tickets (no real tokens, no provider secrets).

Tracker sync commands:
- `node functions/scripts/tracker_counts.js --uid <firebase_uid>`: compare markdown ticket statuses with Firestore tracker ticket statuses.
- `node functions/scripts/syncTrackerTicketsFromMarkdown.js --uid <firebase_uid>`: normalize/backfill `Status:` in ticket markdown and upsert tracker projects/epics/tickets in Firestore.
