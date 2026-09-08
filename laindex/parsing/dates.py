from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

MONTHS = "January February March April May June July August September October November December Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
MONTH_PATTERN = "|".join(MONTHS)


@dataclass(frozen=True)
class PickupParse:
    start: date | None
    end: date | None
    dates: tuple[date, ...]
    confidence: float
    raw: str


def _parse_one(value: str, default_year: int) -> date | None:
    cleaned = re.sub(r"(?:st|nd|rd|th)\b", "", value.strip(), flags=re.I)
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            pass
    for fmt in ("%B %d", "%b %d"):
        try:
            return datetime.strptime(cleaned, fmt).replace(year=default_year).date()
        except ValueError:
            pass
    return None


def parse_pickup_dates(text: str, default_year: int = 2026) -> PickupParse:
    raw = " ".join(text.split())
    found: list[date] = []
    patterns = [rf"(?:{MONTH_PATTERN})\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?", r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"]
    for pattern in patterns:
        for match in re.finditer(pattern, raw, re.I):
            parsed = _parse_one(match.group(), default_year)
            if parsed and parsed not in found:
                found.append(parsed)
    found.sort()
    if not found:
        return PickupParse(None, None, (), 0.0, raw)
    if len(found) == 2 and re.search(r"(?:-|–|through|to)\s*(?:\w+\s+)?\d", raw, re.I):
        days = (found[1] - found[0]).days
        dates = tuple(found[0] + timedelta(days=n) for n in range(max(days, 0) + 1))
        return PickupParse(found[0], found[1], dates, 0.9, raw)
    return PickupParse(found[0], found[-1], tuple(found), 0.85, raw)


def intersects(parsed: PickupParse, start: date, end: date) -> bool | None:
    if parsed.start is None or parsed.end is None:
        return None
    return parsed.start <= end and parsed.end >= start
