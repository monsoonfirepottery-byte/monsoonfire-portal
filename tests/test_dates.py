from datetime import date
from laindex.parsing.dates import intersects, parse_pickup_dates


def test_pickup_range_and_intersection():
    parsed = parse_pickup_dates("Loadout Thursday September 10, 2026 through Saturday September 12, 2026, 8am-2pm")
    assert parsed.start == date(2026,9,10)
    assert parsed.end == date(2026,9,12)
    assert len(parsed.dates) == 3
    assert intersects(parsed,date(2026,9,11),date(2026,9,11))


def test_unknown_pickup_is_manual_review():
    parsed=parse_pickup_dates("Pickup by appointment")
    assert intersects(parsed,date(2026,9,10),date(2026,9,12)) is None
