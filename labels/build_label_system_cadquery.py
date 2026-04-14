#!/usr/bin/env python3
"""Build printable pottery crate label parts with CadQuery."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import cadquery as cq
from cadquery import exporters
import trimesh


ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class PartExport:
    name: str
    shape: cq.Workplane
    color: str = "#d97a32"


@dataclass(frozen=True)
class VariantExport:
    name: str
    assembly_type: str
    parts: tuple[PartExport, ...]
    notes: str
    print_orientation: str
    recommended_material: str


def union_all(parts: list[cq.Workplane]) -> cq.Workplane:
    result = parts[0]
    for part in parts[1:]:
        result = result.union(part)
    return result


def rounded_plate(width: float, height: float, thickness: float, fillet: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(width, height, thickness, centered=(True, True, False))
        .edges("|Z")
        .fillet(fillet)
    )


def raised_badge(shape: str, x: float, y: float, z: float, size: float, depth: float, overlap: float = 0.25) -> cq.Workplane:
    base_z = z - overlap
    total_depth = depth + overlap
    wp = cq.Workplane("XY").center(x, y)
    if shape == "square":
        badge = wp.rect(size * 2.0, size * 2.0)
    elif shape == "triangle":
        badge = wp.polygon(3, size * 2.25)
    elif shape == "hex":
        badge = wp.polygon(6, size * 2.2)
    elif shape == "diamond":
        badge = wp.rect(size * 1.9, size * 1.9).rotate((0, 0, 0), (0, 0, 1), 45)
    else:
        badge = wp.circle(size)
    return badge.extrude(total_depth).translate((0, 0, base_z))


def text_solid(text: str, x: float, y: float, z: float, size: float, depth: float, overlap: float = 0.25) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .center(x, y)
        .text(text, size, depth + overlap, combine=False)
        .translate((0, 0, z - overlap))
    )


def qr_recess(body: cq.Workplane, x: float, y: float, size: float, depth: float, face_selector: str = ">Z") -> cq.Workplane:
    body = body.faces(face_selector).workplane().center(x, y).rect(size, size).cutBlind(-depth)
    notch_y = y - (size / 2.0)
    return body.faces(face_selector).workplane().center(x, notch_y).circle(2.8).cutBlind(-depth)


def qr_frame(x: float, y: float, z: float, size: float, wall: float, height: float, overlap: float = 0.2) -> cq.Workplane:
    outer = cq.Workplane("XY").center(x, y).rect(size + wall * 2, size + wall * 2).extrude(height + overlap)
    inner = cq.Workplane("XY").center(x, y).rect(size, size).extrude(height + overlap)
    return outer.cut(inner).translate((0, 0, z - overlap))


def back_pad(width: float, height: float, thickness: float, x: float, y: float, z_back: float) -> cq.Workplane:
    return cq.Workplane("XY").box(width, height, thickness, centered=(True, True, False)).translate((x, y, z_back - thickness))


def saddle_clip(
    width: float,
    x_center: float,
    top_y: float,
    anchor_drop: float,
    channel_depth: float,
    roof_thickness: float,
    leg_thickness: float,
    leg_drop: float,
) -> cq.Workplane:
    outer_depth = channel_depth + leg_thickness
    profile = [
        (top_y - anchor_drop, 0.0),
        (top_y, 0.0),
        (top_y, -outer_depth),
        (top_y - leg_drop, -outer_depth),
        (top_y - leg_drop, -channel_depth),
        (top_y - roof_thickness, -channel_depth),
        (top_y - roof_thickness, -roof_thickness),
        (top_y - anchor_drop, -roof_thickness),
    ]
    return (
        cq.Workplane("YZ")
        .polyline(profile)
        .close()
        .extrude(width)
        .translate((x_center - (width / 2.0), 0, 0))
    )


def export_svg_view(shape: cq.Workplane, out_path: Path, projection_dir: tuple[float, float, float]) -> None:
    exporters.export(
        shape.val(),
        str(out_path),
        exportType="SVG",
        opt={
            "width": 960,
            "height": 720,
            "marginLeft": 24,
            "marginTop": 24,
            "projectionDir": projection_dir,
            "showAxes": False,
            "showHidden": False,
            "strokeWidth": 0.7,
            "strokeColor": (37, 42, 48),
        },
    )


def render_preview_png(mesh: trimesh.Trimesh, out_path: Path, color: str, elev: float, azim: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    triangles = mesh.vertices[mesh.faces]
    mins = mesh.bounds[0]
    maxs = mesh.bounds[1]
    center = (mins + maxs) / 2.0
    extents = maxs - mins
    radius = float(max(extents)) * 0.58

    fig = plt.figure(figsize=(7.5, 5.8), dpi=170)
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor("white")

    poly = Poly3DCollection(
        triangles,
        facecolor=color,
        edgecolor=(0.1, 0.1, 0.1, 0.08),
        linewidths=0.05,
        alpha=1.0,
    )
    ax.add_collection3d(poly)
    ax.set_xlim(center[0] - radius, center[0] + radius)
    ax.set_ylim(center[1] - radius, center[1] + radius)
    ax.set_zlim(center[2] - radius, center[2] + radius)
    ax.set_box_aspect(extents.tolist())
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    plt.tight_layout(pad=0.0)
    fig.savefig(out_path, bbox_inches="tight", pad_inches=0.0, facecolor="white")
    plt.close(fig)


def export_previews(out_dir: Path, part: PartExport, mesh: trimesh.Trimesh) -> dict:
    front_svg = out_dir / f"{part.name}_front.svg"
    iso_svg = out_dir / f"{part.name}_iso.svg"
    rear_iso_svg = out_dir / f"{part.name}_rear_iso.svg"
    iso_png = out_dir / f"{part.name}_iso.png"
    rear_iso_png = out_dir / f"{part.name}_rear_iso.png"

    export_svg_view(part.shape, front_svg, (0.0, 0.0, 1.0))
    export_svg_view(part.shape, iso_svg, (1.0, -1.0, 1.0))
    export_svg_view(part.shape, rear_iso_svg, (-1.0, 1.0, -1.0))
    render_preview_png(mesh, iso_png, part.color, elev=24, azim=-54)
    render_preview_png(mesh, rear_iso_png, part.color, elev=25, azim=126)

    return {
        "front_svg": front_svg.name,
        "iso_svg": iso_svg.name,
        "iso_png": iso_png.name,
        "rear_iso_svg": rear_iso_svg.name,
        "rear_iso_png": rear_iso_png.name,
    }


def variant_a() -> VariantExport:
    plate = rounded_plate(94, 64, 3.6, 2.0)
    plate = qr_recess(plate, 20, -11, 31, 0.7)

    clip = saddle_clip(
        width=34,
        x_center=0,
        top_y=32,
        anchor_drop=18,
        channel_depth=4.6,
        roof_thickness=2.2,
        leg_thickness=2.0,
        leg_drop=22,
    )

    solid = union_all(
        [
            plate,
            raised_badge("square", -34, 18, 3.6, 5.2, 1.1),
            text_solid("BISQUE", -5, 11, 3.6, 10.5, 0.9),
            qr_frame(20, -11, 3.6, 31, 1.6, 0.8),
            clip,
            back_pad(14, 10, 1.2, -26, -18, 0.0),
            back_pad(14, 10, 1.2, 26, -18, 0.0),
        ]
    )

    return VariantExport(
        name="variant_A",
        assembly_type="single_part",
        parts=(PartExport("variant_A", solid, "#e37d27"),),
        notes="Single-part spring clip label with lower back pads to keep the sign face parallel to the crate wall.",
        print_orientation="Print front face down so the saddle roof bridges across the crate-wall channel.",
        recommended_material="PETG preferred; PLA acceptable for light duty.",
    )


def variant_b() -> VariantExport:
    frame = rounded_plate(98, 68, 3.2, 2.0)
    frame = union_all(
        [
            frame,
            saddle_clip(18, -24, 34, 14, 4.6, 2.2, 2.0, 18),
            saddle_clip(18, 24, 34, 14, 4.6, 2.2, 2.0, 18),
            back_pad(12, 8, 1.0, -24, -24, 0.0),
            back_pad(12, 8, 1.0, 24, -24, 0.0),
            cq.Workplane("XY").box(3.2, 54.2, 1.6, centered=(True, True, False)).translate((-40.2, 0, 3.2)),
            cq.Workplane("XY").box(3.2, 54.2, 1.6, centered=(True, True, False)).translate((40.2, 0, 3.2)),
            cq.Workplane("XY").box(83.8, 3.2, 1.6, centered=(True, True, False)).translate((0, -27.4, 3.2)),
            cq.Workplane("XY").box(18, 3.2, 1.6, centered=(True, True, False)).translate((-27, 27.4, 3.2)),
            cq.Workplane("XY").box(18, 3.2, 1.6, centered=(True, True, False)).translate((27, 27.4, 3.2)),
        ]
    )

    insert = rounded_plate(83.2, 52.2, 1.8, 1.2)
    insert = qr_recess(insert, 19, -10, 30, 0.5)
    insert = union_all(
        [
            insert,
            raised_badge("circle", -31, 17, 1.8, 5.0, 0.9),
            text_solid("GLAZE", -7, 9, 1.8, 9.8, 0.8),
            qr_frame(19, -10, 1.8, 30, 1.2, 0.6),
            cq.Workplane("XY").box(22, 6, 1.8, centered=(True, True, False)).translate((0, 28.1, 0.0)),
        ]
    )

    return VariantExport(
        name="variant_B",
        assembly_type="two_part_assembly",
        parts=(
            PartExport("variant_B_frame", frame, "#6c757d"),
            PartExport("variant_B_insert", insert, "#3c7dd8"),
        ),
        notes="Replaceable cartridge system with front retention rails and a separate printable insert.",
        print_orientation="Print both parts face down; the insert drops into the rail set from the top after printing.",
        recommended_material="PETG frame plus PLA or PETG inserts depending on swap frequency.",
    )


def variant_c() -> VariantExport:
    front_panel = rounded_plate(86, 62, 3.6, 2.0).translate((0, -6, 0))
    front_panel = qr_recess(front_panel, 20, -14, 30, 0.6)

    back_panel = rounded_plate(66, 44, 3.0, 1.5).translate((0, 3, -8.0))
    back_panel = qr_recess(back_panel, 0, -2, 30, 0.6, face_selector="<Z")

    connector = saddle_clip(
        width=66,
        x_center=0,
        top_y=25,
        anchor_drop=12,
        channel_depth=5.0,
        roof_thickness=2.4,
        leg_thickness=3.0,
        leg_drop=18,
    )

    solid = union_all(
        [
            front_panel,
            back_panel,
            connector,
            raised_badge("triangle", -33, 13, 3.6, 5.5, 1.0),
            text_solid("PICKUP", -2, 7, 3.6, 9.6, 0.8),
            qr_frame(20, -14, 3.6, 30, 1.2, 0.7),
            qr_frame(0, -2, -8.0, 30, 1.0, 0.7),
        ]
    )

    return VariantExport(
        name="variant_C",
        assembly_type="single_part",
        parts=(PartExport("variant_C", solid, "#3ea86a"),),
        notes="Double-sided hanging tag with a full outside panel and smaller inside QR panel tied together by one saddle body.",
        print_orientation="Print the larger front face down; the bridge spans only the wall slot so it remains support-free.",
        recommended_material="PETG strongly recommended for repeated hanging and handling.",
    )


def variant_d() -> VariantExport:
    body = rounded_plate(104, 72, 5.2, 2.2)
    body = qr_recess(body, 24, -7, 34, 1.6)

    clip = saddle_clip(
        width=44,
        x_center=-16,
        top_y=36,
        anchor_drop=22,
        channel_depth=4.8,
        roof_thickness=2.8,
        leg_thickness=3.0,
        leg_drop=28,
    )

    solid = union_all(
        [
            body,
            raised_badge("hex", -37, 22, 5.2, 5.8, 1.2),
            text_solid("HOLD", -18, 4, 5.2, 11.5, 1.0),
            qr_frame(24, -7, 5.2, 34, 2.0, 1.0),
            clip,
            cq.Workplane("XY").box(10, 24, 2.2, centered=(True, True, False)).translate((-38, 18, -2.2)),
            cq.Workplane("XY").box(10, 24, 2.2, centered=(True, True, False)).translate((6, 18, -2.2)),
            back_pad(24, 12, 1.6, 30, -22, 0.0),
            back_pad(28, 16, 2.0, -16, -24, 0.0),
        ]
    )

    return VariantExport(
        name="variant_D",
        assembly_type="single_part",
        parts=(PartExport("variant_D", solid, "#b63b39"),),
        notes="Heavy-duty block with deeper QR protection, a thicker saddle clip, and rear reinforcement pads.",
        print_orientation="Print front face down; the heavy saddle remains printable because the channel roof bridges under 5 mm.",
        recommended_material="PETG or ABS/ASA if the tags will live in hotter, rougher studio conditions.",
    )


def export_part(out_dir: Path, part: PartExport) -> dict:
    stl_path = out_dir / f"{part.name}.stl"
    step_path = out_dir / f"{part.name}.step"
    exporters.export(part.shape, str(stl_path), tolerance=0.06, angularTolerance=0.08)
    exporters.export(part.shape, str(step_path), exportType="STEP")

    mesh = trimesh.load_mesh(str(stl_path.resolve()), force="mesh")
    preview_files = export_previews(out_dir, part, mesh)

    return {
        "name": part.name,
        "stl": stl_path.name,
        "step": step_path.name,
        "watertight": bool(mesh.is_watertight),
        "components": len(mesh.split(only_watertight=False)),
        "volume_mm3": round(float(mesh.volume), 3),
        "faces": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "bounds_mm": mesh.bounds.tolist() if mesh.bounds is not None else None,
        "previews": preview_files,
    }


def cleanup_legacy_artifacts() -> None:
    blend = ROOT / "monsoonfire_label_system.blend"
    if blend.exists():
        blend.unlink()
    textures = ROOT / "textures"
    if textures.exists():
        shutil.rmtree(textures)
    for artifact in ROOT.glob("variant_*/*"):
        if artifact.suffix.lower() in {".png", ".svg", ".glb"}:
            artifact.unlink()
    stale_variant_b = ROOT / "variant_B" / "variant_B.stl"
    if stale_variant_b.exists():
        stale_variant_b.unlink()


def build_all() -> list[dict]:
    cleanup_legacy_artifacts()
    variants = [variant_a(), variant_b(), variant_c(), variant_d()]
    reports: list[dict] = []

    for variant in variants:
        out_dir = ROOT / variant.name
        out_dir.mkdir(parents=True, exist_ok=True)
        part_reports = [export_part(out_dir, part) for part in variant.parts]
        report = {
            "variant": variant.name,
            "assembly_type": variant.assembly_type,
            "notes": variant.notes,
            "print_orientation": variant.print_orientation,
            "recommended_material": variant.recommended_material,
            "parts": part_reports,
        }
        (out_dir / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        reports.append(report)

    (ROOT / "validation_summary.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    return reports


def main() -> int:
    reports = build_all()
    failures = [
        part
        for report in reports
        for part in report["parts"]
        if (not part["watertight"]) or part["components"] != 1
    ]
    print(json.dumps(reports, indent=2))
    if failures:
        print("Validation failures detected.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
