# P1 — Bambu headless slice template and CLI reliability

Status: Active
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

## Dependencies
- `scripts/studiobrain-ops.py`
- `scripts/install-studiobrain-bambu-cli.sh`
- `scripts/studiobrain-bambu-cli.sh`
- `scripts/fix_bambu_3mf.py`
- `docs/runbooks/STUDIO_BRAIN_HOST_STACK.md`
