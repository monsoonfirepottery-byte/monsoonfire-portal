# P2 — Label fit calibration and operator inspection pack

Status: Active
Date: 2026-04-14
Priority: P2
Owner: Fabrication / Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-label-printability-and-support-free-crate-signs.md

## Problem
The current prototypes assume a `3-5 mm` crate wall range, but the repo does not yet capture a small fit matrix, material guidance, or one operator-facing inspection pack that ties geometry, orientation, and support status together.

## Tasks
1. Document the intended wall-thickness and clip-clearance targets for the crate family this system is meant to fit.
2. Add material guidance for PETG vs PLA where flex, heat, and fatigue matter.
3. Keep the quick-inspection artifacts coherent:
   - rear iso previews
   - validation summary
   - slicer support summary
4. Update the research/design notes so the next pass can distinguish proven geometry constraints from open assumptions.

## Acceptance Criteria
1. The repo contains one clear operator-facing summary of fit assumptions, material recommendations, and support status by variant.
2. At least one repeatable clearance/fit check is documented for `3 mm`, `4 mm`, and `5 mm` wall scenarios.
3. Reviewers can inspect the current state without relying on out-of-band laptop copies or prior chat context.

## Dependencies
- `labels/README.md`
- `labels/research.md`
- `labels/validation_summary.json`
- `labels/slices/prusaslicer_x1c_inspect/slice_summary.json`
