# P1 — Support-free label clip geometry and slicer gates

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Fabrication
Type: Ticket
Parent Epic: tickets/P1-EPIC-label-printability-and-support-free-crate-signs.md

## Problem
The current CadQuery parts are watertight and connected, but the clip roofs, hanger transitions, and underside geometries still generate supports in the inspection slicer.

## Tasks
1. Redesign the `variant_A`, `variant_B_frame`, `variant_C`, and `variant_D` engagement geometry around self-supporting FDM shapes:
   - chamfered or teardrop-style underside roofs
   - tapered cantilevers with larger root transitions
   - orientation-aware transitions instead of flat unsupported shelves
2. Preserve current mechanical intent:
   - `variant_A` and `variant_D` remain clip-on plates
   - `variant_B_frame` remains a replaceable insert frame
   - `variant_C` remains a fast-swap hanging tag
3. Keep `labels/check_printability.py` and `labels/validation_summary.json` green after each geometry change.
4. Rerun `labels/slice_with_prusaslicer.ps1` after each variant change and use the result as the printability acceptance gate.

## Acceptance Criteria
1. `variant_A`, `variant_B_frame`, `variant_C`, and `variant_D` all show `support_detected: false` in the inspection summary.
2. Every printable part remains watertight with one connected component per STL unless the assembly is explicitly multi-part.
3. `labels/README.md` reflects the latest truthful support status and print orientation guidance.

## Dependencies
- `labels/build_label_system_cadquery.py`
- `labels/check_printability.py`
- `labels/slice_with_prusaslicer.ps1`
