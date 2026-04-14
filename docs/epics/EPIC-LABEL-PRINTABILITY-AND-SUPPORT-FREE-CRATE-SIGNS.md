# EPIC: LABEL-PRINTABILITY-AND-SUPPORT-FREE-CRATE-SIGNS

Status: Active
Owner: Fabrication / Studio Ops
Created: 2026-04-14

## Mission

Turn the current CadQuery crate-label prototypes into support-aware, support-free-by-default FDM tools with a repeatable slice gate and a server-primary slicing workflow.

## Current Baseline

- The old Blender-export STL path has been retired in favor of `CadQuery`, and the current label variants now export as watertight, connected solids instead of smashed-together scene objects.
- The current inspection gate is `labels/slice_with_prusaslicer.ps1`, using a `0.4 mm nozzle`, `0.16 mm layer`, `PLA`, and `build-plate-only auto-support` profile.
- Under that gate, `variant_A`, `variant_B_frame`, `variant_C`, and `variant_D` still trigger supports. Only `variant_B_insert` slices clean without supports.
- Studio Brain now has a tracked Bambu CLI install/status/smoke path, but raw STL slicing still needs a stable settings/template path and better CLI reliability for server-primary automation.

## Scope

- Redesign clip, saddle, and hanging-tag geometries so the target parts stop relying on unsupported cantilevers and flat underside roofs.
- Keep the CAD pipeline authoritative and machine-check the parts with validation plus slicer inspection before calling them printable.
- Make the Studio Brain host the primary automation surface for Bambu-family slicing, with a documented fallback when upstream CLI behavior is unstable.
- Capture fit, material, and orientation guidance so the next geometry pass is grounded in real print constraints instead of shape-only modeling.

## Success Criteria

- `variant_A`, `variant_B_frame`, `variant_C`, and `variant_D` all slice with zero detected support sections under the agreed inspection profile.
- The accepted profile, orientation, and material assumptions are written down and rerunnable from repo scripts.
- Studio Brain can run a tracked headless slice workflow for label artifacts, or fails with a clear documented fallback path instead of opaque segfaults.
- Label docs and previews describe the current printability truth honestly; no part is described as support-free until the slicer gate confirms it.

## Non-goals

- Final branding or sticker artwork for the QR labels.
- Direct printer binding, cloud queue management, or remote print submission.
- Replacing slicer judgment with CAD-only heuristics.

## Child Tickets

- `tickets/P1-support-free-label-clip-geometry-and-slicer-gates.md`
- `tickets/P1-bambu-headless-slice-template-and-cli-reliability.md`
- `tickets/P2-label-fit-calibration-and-operator-inspection-pack.md`
