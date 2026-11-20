from dataclasses import dataclass


@dataclass(frozen=True)
class AllInEstimate:
    low: float
    high: float
    confidence: float


def estimate_all_in(bid: float, premium_percent: float | None, tax_percent: float | None, fixed_fees: float = 0, tax_on_premium: bool | None = None, fallback_tax: float = 9.2) -> AllInEstimate:
    premium = bid * (premium_percent or 0) / 100
    tax = tax_percent if tax_percent is not None else fallback_tax
    subtotal = bid + premium
    low_taxable = bid
    high_taxable = subtotal if tax_on_premium is not False else bid
    low = subtotal + low_taxable * tax / 100 + fixed_fees
    high = subtotal + high_taxable * tax / 100 + fixed_fees
    confidence = 1.0 if premium_percent is not None and tax_percent is not None and tax_on_premium is not None else 0.6
    return AllInEstimate(round(low, 2), round(high, 2), confidence)
