#!/usr/bin/env python3
"""Launch the CadQuery-based label-system build inside the local CAD venv."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_PYTHON = ROOT / ".venv-cad" / "Scripts" / "python.exe"
BUILD_SCRIPT = ROOT / "build_label_system_cadquery.py"


def main() -> int:
    if not VENV_PYTHON.exists():
        print(f"Missing CAD environment at {VENV_PYTHON}")
        print("Create it first or rerun the local setup steps from labels/README.md.")
        return 1

    cmd = [str(VENV_PYTHON), str(BUILD_SCRIPT)]
    print("Running:", " ".join(cmd))
    completed = subprocess.run(cmd, cwd=ROOT.parent)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
