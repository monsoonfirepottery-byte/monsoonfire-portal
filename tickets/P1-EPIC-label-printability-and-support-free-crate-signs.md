# Epic: P1 — Label Printability and Support-Free Crate Signs

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Fabrication / Studio Ops
Type: Epic

## Problem
The crate-label prototypes are now valid solids, but four of the five printable parts still rely on slicer-generated support, and the Bambu-family headless slice path is not yet dependable enough to be the only automation gate.

## Objective
Make the crate-label system support-free under an agreed FDM profile, while keeping the CAD path truthful and moving slicing automation onto the Studio Brain host in a repeatable way.

## Historical Context
- `labels/README.md`
- `labels/research.md`
- `labels/slices/prusaslicer_x1c_inspect/slice_summary.json`
- `docs/epics/EPIC-LABEL-PRINTABILITY-AND-SUPPORT-FREE-CRATE-SIGNS.md`

## Tickets
- `tickets/P1-support-free-label-clip-geometry-and-slicer-gates.md`
- `tickets/P1-bambu-headless-slice-template-and-cli-reliability.md`
- `tickets/P2-label-fit-calibration-and-operator-inspection-pack.md`

## Scope
1. Redesign the clip and hanger geometries around self-supporting FDM rules instead of purely geometric fit.
2. Preserve the CadQuery validation pipeline and add slicer inspection as the acceptance gate for support-free claims.
3. Stabilize the Studio Brain host slicing path so the server can evaluate label artifacts without a manual desktop-only loop.
4. Document fit, material, and orientation assumptions so future redesign passes stop repeating the same uncertainty.

## Acceptance Criteria
1. `variant_A`, `variant_B_frame`, `variant_C`, and `variant_D` pass the agreed slicer gate with zero support sections.
2. The repo contains one clear rerunnable inspection path for the label system and one clear server-primary slice path for Bambu-family tooling.
3. The label docs report the current support status accurately and link the remaining work to this epic.
4. Operators can tell which variant/profile/material combination is ready for print without reopening chat history.

## Recent Progress
- 2026-04-14: moved STL construction off raw Blender scene assembly and onto a CadQuery solid-modeling path.
- 2026-04-14: validated the current variants as watertight connected solids and exported inspection previews.
- 2026-04-14: added a PrusaSlicer-based inspection gate that shows only `variant_B_insert` is support-free today.
- 2026-04-14: added tracked Studio Brain host commands for installing, checking, and smoke-running the pinned Bambu Studio CLI wrapper.

## Current Blocker
- The geometry is only halfway done: the parts are coherent solids now, but the clip and hanger forms still trigger supports. At the same time, raw STL slicing on Bambu Studio and Orca remains unstable enough that the PrusaSlicer inspection gate is still the trustworthy baseline.
