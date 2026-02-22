# Tickets

This folder contains short, executable tickets used by the swarm board and sprint plans.

Conventions:
- Filename: `P0-*`, `P1-*`, `P2-*`, `S12-*` etc.
- Each ticket should include: problem, tasks, acceptance, and any dependencies.
- Active tickets should include explicit metadata: `Status`, `Priority`, `Owner`, and `Type`.
- If a ticket is part of an epic, include `Parent Epic: tickets/<epic-file>.md`.
- If a ticket is intentionally standalone, document dependency context in the body.
- Keep secrets out of tickets (no real tokens, no provider secrets).
