#!/usr/bin/env python3
"""Validate STL files for watertightness and disconnected components."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import trimesh


def inspect_stl(path: Path) -> dict:
    mesh = trimesh.load_mesh(str(path.resolve()), force="mesh")
    bounds = mesh.bounds.tolist() if mesh.bounds is not None else None
    return {
        "file": path.name,
        "watertight": bool(mesh.is_watertight),
        "components": len(mesh.split(only_watertight=False)),
        "volume_mm3": round(float(mesh.volume), 3),
        "faces": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "bounds_mm": bounds,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: check_printability.py <stl> [<stl> ...]")
        return 1

    reports = [inspect_stl(Path(arg)) for arg in argv[1:]]
    print(json.dumps(reports, indent=2))
    failures = [r for r in reports if (not r["watertight"]) or r["components"] != 1]
    return 2 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
