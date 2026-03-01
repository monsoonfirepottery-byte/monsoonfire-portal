# EPIC: STAFF-PORTAL-MODULE-CONSOLIDATION

Status: Active
Owner: Portal Staff Console
Created: 2026-02-27

## Mission

Reduce staff portal operator friction by consolidating duplicated module surfaces into a smaller, task-oriented layout centered on Cockpit.

## Why This Exists

- The current page has duplicated operational surfaces (`Overview`, `Cockpit`, and embedded module cards).
- Several controls are split across modules even when the same actions and data appear in Cockpit.
- Extra module toggles increase navigation overhead and hide the critical path for daily operations.

## Scope

- Consolidate ops entry points into Cockpit.
- Remove low-value duplicated module navigation.
- Preserve existing operational controls by relocating them, not deleting capability.
- Keep backward-compatible behavior for telemetry/data loading paths where practical.

## Decision Log

1. Merge `Overview` into `Cockpit`
- Both surfaces load the same operational datasets and present top-level triage.
- Keeping both increased context switching with little operational value.

2. Collapse standalone `Governance` and `Agent ops` navigation into Cockpit
- Cockpit already embeds both cards.
- Removing standalone nav buttons lowers module sprawl while preserving functionality.

3. Keep `Reports` as a standalone module for deep-focus triage
- Reports has a high-volume table workflow that still benefits from dedicated screen space.
- Cockpit continues to show reports summary and embeds reports for quick triage.

## Execution Plan

### Phase 1 (executed in this change)

- Set `Cockpit` as the default module.
- Remove `Overview`, `Governance`, and `Agent ops` from sidebar module list.
- Route all prior overview-only alert action targets to `Cockpit` when appropriate.
- Fold overview action queue controls directly into Cockpit.
- Remove redundant "Open module" buttons inside Cockpit.

### Phase 2 (executed)

- Split Cockpit into explicit sections: `Triage`, `Automation`, `Policy & Agent Ops`.
- Add anchor links and sticky intra-page nav for faster operator movement.

### Phase 3 (executed)

- Introduce a typed module registry to reduce manual switch/map drift.
- Add module-level ownership metadata and testing IDs for faster QA.

### Phase 4 (partially executed)

- Add telemetry for module engagement and time-to-action.
- Prune remaining low-use controls based on measured operator behavior.

## Progress Log

- 2026-02-27: Phase 1 completed in `StaffView` by consolidating `Overview`, `Governance`, and `Agent ops` into Cockpit.
- 2026-02-27: Phase 2 completed with Cockpit section anchors and sticky intra-page quick nav.
- 2026-02-27: Phase 3 completed with a typed module registry driving nav labels/keys/metadata and test IDs.
- 2026-02-27: Phase 4 started with session-level module telemetry (visits, dwell time, first-action latency) rendered in Cockpit.
- 2026-02-27: Phase 4 telemetry now persists locally across staff sessions and surfaces low-engagement module candidates for pruning.
- 2026-02-27: Adaptive sidebar ordering is now toggleable/persisted and can export machine-readable telemetry JSON for agent follow-up loops.
- 2026-02-27: Low-engagement modules now auto-collapse into a secondary drawer while preserving access and active-module visibility.
- 2026-02-27: Rolling telemetry now applies age decay so recent behavior influences adaptive ordering more than stale history.

## Success Criteria

- Daily staff workflows can run fully from Cockpit without switching through duplicated modules.
- Sidebar module count decreases while preserving capability coverage.
- No regression in data loading or action execution for ops-critical paths.

## Risks

- Operators accustomed to prior navigation may need short-term retraining.
- Cockpit density may increase if sections are not clearly chunked.

## Mitigations

- Keep labels explicit (`Action queue`, `Automation health`, `Policy`, `Agent ops`).
- Keep standalone `Reports` route available during transition.
- Follow with Phase 2 anchor navigation to reduce scan cost.

## Agent Handoff Notes

- Treat this epic as a consolidation sequence, not a visual redesign rewrite.
- Preserve action parity first, then remove duplication.
- Prefer additive migration inside Cockpit before deleting legacy paths.
