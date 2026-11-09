from __future__ import annotations

DEFAULT_POSITIVE = {
    "kiln": 35, "pugmill": 35, "slab roller": 35, "ball mill": 30, "pottery": 20,
    "compressor": 18, "vacuum pump": 25, "oscilloscope": 30, "multimeter": 24,
    "fluke": 18, "server": 15, "workstation": 16, "drill press": 22, "precision": 15,
    "thermocouple": 24, "controller": 18, "scientific": 18, "industrial": 12,
}
DEFAULT_NEGATIVE = {"mattress": -45, "cosmetic": -35, "clothing": -30, "party supplies": -30, "patio furniture": -20, "toy": -18, "decor": -15}


def weighted_score(text: str, positive: dict[str, int] | None = None, negative: dict[str, int] | None = None) -> tuple[int, list[str]]:
    haystack = text.casefold()
    score = 20
    reasons: list[str] = []
    for term, weight in (positive or DEFAULT_POSITIVE).items():
        if term.casefold() in haystack:
            score += weight
            reasons.append(term)
    for term, weight in (negative or DEFAULT_NEGATIVE).items():
        if term.casefold() in haystack:
            score += weight
            reasons.append(f"not:{term}")
    return max(0, min(100, score)), reasons
