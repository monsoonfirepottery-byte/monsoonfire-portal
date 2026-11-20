from __future__ import annotations

from dataclasses import dataclass
from laindex.config import LocationConfig


@dataclass(frozen=True)
class LocationDecision:
    qualifies: bool
    reason: str


def qualifies_location(city: str | None, state: str | None, longitude: float | None, config: LocationConfig) -> LocationDecision:
    if (state or "").upper() not in {"AZ", "ARIZONA"}:
        return LocationDecision(False, "outside Arizona")
    normalized = (city or "").casefold()
    denied = {x.casefold() for x in config.denied_cities}
    allowed = {x.casefold() for x in config.allowed_cities}
    if normalized in denied:
        return LocationDecision(False, "city denied")
    if longitude is not None and config.east_boundary_longitude is not None and longitude > config.east_boundary_longitude:
        return LocationDecision(False, "east of configured boundary")
    if normalized in allowed:
        return LocationDecision(True, "allowed city")
    return LocationDecision(False, "city requires manual review")
