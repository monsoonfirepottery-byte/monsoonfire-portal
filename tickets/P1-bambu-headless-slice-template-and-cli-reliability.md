# P1 — Bambu headless slice template and CLI reliability

Status: Blocked
Date: 2026-04-14
Priority: P1
Owner: Studio Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-label-printability-and-support-free-crate-signs.md

## Problem
Studio Brain can install and smoke-test the pinned Bambu Studio CLI, but raw STL slicing is still not reliable enough to serve as the only automation path for label printability checks.

## Tasks
1. Establish a tracked printer/process/filament settings pack or reusable project template for the label workflow.
2. Make the server-primary command path explicit:
   - install and status via `studio:ops:bambu:*`
   - smoke verification via the pinned wrapper
   - raw-project or raw-STL slice path with known-good arguments
3. Keep `scripts/fix_bambu_3mf.py` available for malformed export repair until the upstream export path stops emitting broken XML metadata.
4. Document the fallback behavior when Bambu-family CLI is unstable:
   - when to fall back to PrusaSlicer inspection
   - what artifacts to keep for debugging
   - how to distinguish settings drift from upstream crashes

## Acceptance Criteria
1. At least one label artifact slices headlessly on Studio Brain with a tracked command and persisted output artifacts.
2. Failures report actionable cause categories instead of only surfacing opaque CLI crashes.
3. The runbook covers install, status, smoke, and the current raw-slice limitations honestly.

## Progress — 2026-05-01

- `npm run studio:ops:bambu:status` verifies the pinned Bambu Studio install on Studio Brain.
- `npm run studio:ops:bambu:smoke -- --keep-output` slices the bundled Bambu 3MF fixture headlessly and persisted the latest verified smoke artifact at `/home/wuff/studiobrain-data/bambu/smoke/20260501-002907/smoke-slice.3mf`.
- Added `studio:ops:bambu:run` as the explicit raw CLI path and added structured Bambu failure classification to `scripts/studiobrain-ops.py`.
- Documented install, status, smoke, raw-run usage, failure categories, artifact retention, and fallback behavior in `docs/runbooks/STUDIO_BRAIN_HOST_STACK.md`.
- Blocker: the support-free label STL `labels/variant_B/variant_B_insert.stl` does not yet slice through Bambu's raw CLI profile path. The latest classified raw run used `/home/wuff/studiobrain-data/bambu/labels/variant_B_insert-20260501-classified`; it failed before producing a label 3MF, with profile/filament warnings and exit 139. The current classified cause is `settings_profile_drift`, with supporting `filament_mapping_mismatch` and `upstream_cli_segfault`. Acceptance criterion 1 remains unmet until a known-good Bambu 3MF template or refreshed profile pack exists.

## Dependencies
- `scripts/studiobrain-ops.py`
- `scripts/install-studiobrain-bambu-cli.sh`
- `scripts/studiobrain-bambu-cli.sh`
- `scripts/fix_bambu_3mf.py`
- `docs/runbooks/STUDIO_BRAIN_HOST_STACK.md`
