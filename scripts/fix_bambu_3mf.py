#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path


MODEL_SETTINGS_PATH = "Metadata/model_settings.config"
VALUE_ATTR_RE = re.compile(r'value="(.*)"')


def _escape_inner_value_quotes(text: str) -> str:
    fixed_lines: list[str] = []
    changed = False

    for line in text.splitlines(keepends=True):
        match = VALUE_ATTR_RE.search(line)
        if not match:
            fixed_lines.append(line)
            continue

        value = match.group(1)
        escaped = value.replace("&", "&amp;").replace('"', "&quot;")
        if escaped != value:
            changed = True
            line = f'{line[:match.start(1)]}{escaped}{line[match.end(1):]}'
        fixed_lines.append(line)

    fixed_text = "".join(fixed_lines)
    if not changed:
        return fixed_text

    # Fail fast if the output is still not parseable XML.
    import xml.etree.ElementTree as ET

    ET.fromstring(fixed_text)
    return fixed_text


def repair_3mf(src: Path, dest: Path) -> bool:
    repaired = False
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(
        dest, "w", compression=zipfile.ZIP_DEFLATED
    ) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == MODEL_SETTINGS_PATH:
                text = data.decode("utf-8")
                fixed_text = _escape_inner_value_quotes(text)
                repaired = repaired or fixed_text != text
                data = fixed_text.encode("utf-8")
            zout.writestr(info, data)
    return repaired


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Repair malformed XML metadata inside Bambu Studio 3MF exports."
    )
    parser.add_argument("src", type=Path, help="Input 3MF path")
    parser.add_argument(
        "dest",
        nargs="?",
        type=Path,
        help="Output 3MF path. Defaults to overwriting the source file.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    src = args.src.resolve()
    dest = args.dest.resolve() if args.dest else src
    tmp_dest = dest.with_suffix(dest.suffix + ".tmp")

    if not src.exists():
        print(f"Input file not found: {src}", file=sys.stderr)
        return 1

    repaired = repair_3mf(src, tmp_dest)
    tmp_dest.replace(dest)

    status = "repaired" if repaired else "unchanged"
    print(f"{status}: {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
