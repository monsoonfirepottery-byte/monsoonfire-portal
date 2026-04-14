# Monsoon Fire Label CAD Toolchain

The old STL generator has been retired. It used Blender scene objects as export primitives, which produced disconnected meshes and misleading renders. The new default path is a CAD-kernel workflow:

- `CadQuery` for primary part construction
- `build123d` as a secondary parametric CAD API
- `trimesh` + `manifold3d` for printability validation and repair-oriented checks
- `jupyter-cadquery` + `ocp-vscode` for interactive preview
- Blender reserved for future render/import work, not STL construction

## Local Environment

A repo-local environment now lives at:

- `labels/.venv-cad`

Installed packages are listed in:

- `labels/requirements-cad.txt`

An interactive Jupyter kernel was installed for this environment as:

- `CadQuery 3D (Monsoon Fire)`

To launch Jupyter Lab from this CAD environment:

```powershell
.\labels\launch_cadquery_lab.ps1
```

## Build Pipeline

Primary entry point:

- `labels/generate_label_system.py`

CadQuery builder:

- `labels/build_label_system_cadquery.py`

Printability validator:

- `labels/check_printability.py`

Run the current build:

```bash
python labels/generate_label_system.py
```

This now:

- builds solids with CadQuery
- exports STL and STEP files
- validates watertightness and connected-component counts with `trimesh`
- writes `validation.json` inside each variant folder
- writes `validation_summary.json` at the `labels/` root
- exports quick inspection views for each part:
  - `*_front.svg`
  - `*_iso.svg`
  - `*_rear_iso.svg`
  - `*_iso.png`
  - `*_rear_iso.png`

## Current State

The new CadQuery pipeline is now the authoritative modeling path. The latest retry focuses on mechanically coherent label bodies instead of decorative scene assemblies.

Current exports are focused on:

- `variant_A`: single-part spring-clip plate with rear stand-off pads
- `variant_B`: intentional two-part assembly with a rail-retained insert
- `variant_C`: single-part double-sided hanging tag with a smaller inside panel
- `variant_D`: single-part industrial block with a heavier saddle clip

Each exported printable part currently validates as:

- watertight
- one connected component per STL
- positive-volume mesh

## Support Audit Baseline

The CadQuery pass fixed the original disconnected-mesh problem, but it did not yet finish the support-free FDM optimization work.

The current inspection gate is:

- `labels/slice_with_prusaslicer.ps1`
- PrusaSlicer inspection profile: `0.4 mm nozzle`, `0.16 mm layer`, `PLA`, `build-plate-only auto-support`
- latest baseline summary: `labels/slices/prusaslicer_x1c_inspect/slice_summary.json`

Current result:

- `variant_A`: support detected
- `variant_B_frame`: support detected
- `variant_B_insert`: no support detected
- `variant_C`: support detected
- `variant_D`: support detected

That means the current repository state should be treated as a printable-solid baseline, not as a finished support-free sign system. The redesign and acceptance work is tracked in `docs/epics/EPIC-LABEL-PRINTABILITY-AND-SUPPORT-FREE-CRATE-SIGNS.md`.

## Why This Changed

The broken Blender-based pipeline exported multiple selected objects together instead of guaranteeing a fused body. That is fine for scene composition, but wrong for fabrication. The fix is to model in a BREP/solid workflow first and only tessellate to STL after the solid exists.

## Next Recommended Step

Use the generated `*_rear_iso.*` preview files first when judging the clip and hanger mechanics, because they show the crate-engagement geometry more clearly than the front views. For any geometry change, rerun the PrusaSlicer inspection gate before calling the result support-free. If the next iteration needs richer presentation renders, import the validated STEP files into Blender or another renderer after confirming the fabrication geometry.
