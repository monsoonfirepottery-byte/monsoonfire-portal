# Studio Brain Control Tower v2

Studio Brain Control Tower v2 is the primary operator surface for rooms, services, and incidents.

## Primary route

- Canonical route: `/staff/cockpit/control-tower`
- Short alias: `/staff/control-tower`

In production, the intended primary entry is:

- `https://portal.monsoonfire.com/staff/cockpit/control-tower`
- CLI helper: `npm run studio:ops:browser:url`

## What it replaces

Control Tower v2 replaces the tmux-first cockpit as the daily operator bridge.

tmux remains only for:

- long-running room/session hosting
- emergency attach and shell recovery
- host-side inspection when the browser is unavailable

## Product surfaces

- `Home`
  - Needs Attention
  - Active Rooms
  - Good Next Moves
  - Recent Events
- `Chief-of-staff partner`
  - owner-facing brief
  - verified context
  - one decision needed next
  - open-loop controls
- `Room detail`
  - objective
  - status
  - heartbeat
  - attach command
  - send instruction
  - escalation controls
- `Services`
  - allowlisted health and bounded actions for `studio-brain-discord-relay`
- `Events`
  - curated timeline of incidents, acks, stale rooms, service actions, and overseer findings
- `Command palette`
  - search actions, rooms, and services
  - jump to active rooms and degraded services
  - refresh
  - spawn room
  - ack overseer
  - jump to advanced admin

## Backend contracts

The browser UI is backed by Studio Brain HTTP routes:

- `GET /api/control-tower/state`
- `GET /api/control-tower/overview`
- `GET /api/control-tower/partner/latest`
- `POST /api/control-tower/partner/brief`
- `POST /api/control-tower/partner/checkins`
- `POST /api/control-tower/partner/open-loops/:id`
- `GET /api/control-tower/rooms`
- `GET /api/control-tower/rooms/:id`
- `GET /api/control-tower/services`
- `GET /api/control-tower/events`
- `POST /api/control-tower/rooms`
- `POST /api/control-tower/rooms/:id/send`
- `POST /api/control-tower/rooms/:id/pin`
- `POST /api/control-tower/rooms/:id/unpin`
- `GET /api/control-tower/rooms/:id/attach-command`
- `POST /api/control-tower/services/:id/actions`
- `POST /api/control-tower/overseer/ack`

Preserved artifacts and metadata:

- `output/ops-cockpit/operator-state.json`
- `output/ops-cockpit/agents/*.json`
- `output/ops-cockpit/agent-status/*.json`
- `output/studio-brain/partner/latest-brief.json`
- `output/studio-brain/partner/checkins.jsonl`
- `output/studio-brain/partner/open-loops.json`
- `output/stability/heartbeat-summary.json`
- `output/overseer/latest.json`
- `output/overseer/discord/latest.json`
- `output/overseer/discord/acks.jsonl`

## Retained tmux substrate

The tracked tmux session remains `studiobrain` and keeps these windows:

- `control`
  - now a slim browser-first recovery pane
- `brain`
  - `studio-brain/` shell
- `scripts`
  - repo `scripts/` shell
- `logs`
  - repo/log investigation shell

The `control` window no longer hosts the multi-pane humane cockpit renderer.
It now points operators back to the browser UI and keeps tmux honest as a recovery tool.

## What was removed or demoted

Demoted or removed from primary use:

- tmux `home/sidebar/detail` presentation as the main operator UI
- tmux status-line counters as the main source of operator truth
- watch-driven terminal redraw loop for daily operations
- docs that positioned `ops-cockpit` or tmux as the primary bridge
- Tailscale and Teleport as first-class operator services

Retained as compatibility or diagnostics:

- `scripts/ops-cockpit.mjs`
  - legacy artifact helper only
- `studio-brain/src/http/dashboard.ts`
  - fallback diagnostics page only
- tmux attach commands
  - recovery-only entrypoints

## Launch and usage

1. Open the browser route.
   - fastest local helper: `npm run studio:ops:browser:url`
2. Work from Control Tower first.
3. Use room drawers and explicit buttons for normal operator actions.
4. Use tmux attach only when you need shell-level recovery or a direct lane attach.

### Chief-of-Staff Audit

Run the bounded fixture audit when you want to prove the Chief-of-Staff partner loop behaves end to end without touching live host state.

- Command: `npm run studio:ops:cos:audit`
- Report: `output/qa/studiobrain-chief-of-staff-audit.json`
- Verifies:
  - `GET /api/control-tower/state`
  - `GET /api/control-tower/partner/latest`
  - `POST /api/control-tower/partner/brief`
  - `POST /api/control-tower/partner/checkins`
  - `POST /api/control-tower/partner/open-loops/:id`
  - persisted partner artifacts in `output/studio-brain/partner/*`
  - control-tower audit entries for partner checkins and open-loop updates

## Rollback

Because the browser route was introduced additively, rollback is straightforward:

1. Repoint staff entry links back to the older operations/admin surfaces.
2. Keep the `/api/control-tower/*` contracts intact.
3. Keep tmux substrate available for recovery.
4. Restore tmux-first documentation only if the browser route becomes unusable.

Do not remove the tmux substrate unless recovery attach has been validated after each deployment.
