from __future__ import annotations

POSITIVE = {"matte black": 25, "black": 8, "door lever": 22, "door handle": 20, "handleset": 18, "lockset": 18, "deadbolt": 16, "round rose": 30, "round escutcheon": 30, "circular mounting": 28, "keyed entry": 22, "security door": 20, "exterior": 12}
NEGATIVE = {"rectangular backplate": -35, "brass": -30, "polished chrome": -25, "satin nickel": -20, "dummy": -20, "cabinet pull": -40, "shower": -40, "appliance handle": -40}


def classify(text: str) -> tuple[int, list[str]]:
    haystack = text.casefold()
    reasons: list[str] = []
    score = 0
    for term, weight in {**POSITIVE, **NEGATIVE}.items():
        if term in haystack:
            score += weight
            reasons.append(term if weight > 0 else f"reject:{term}")
    if not any(x in haystack for x in ("door", "lockset", "deadbolt", "handleset")):
        score -= 35
    return max(0, min(100, score)), reasons
