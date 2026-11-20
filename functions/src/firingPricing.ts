/** Pricing attached to a ticket at creation. Missing version means legacy. */
export const CURRENT_FIRING_PRICING_VERSION = 2;

/** Pause new v3 issuance independently of billing tickets that already use it. */
export function newFiringPricingVersion(enableV3 = process.env.FIRING_PRICING_V3_ENABLED): number {
  return enableV3 === "true" ? 3 : CURRENT_FIRING_PRICING_VERSION;
}

export type FiringPricingInput = {
  version?: number | null;
  heatId: string;
  billingUnit: "half_shelf" | "whole_kiln" | "custom";
  quantity: number;
  privateFulfilled?: boolean;
  rushFulfilled?: boolean;
};

export function calculateFiringPrice(input: FiringPricingInput): { rateKey: string | null; chargeCents: number | null } {
  const heat = input.heatId.trim().toLowerCase();
  if (input.version == null || input.version === 1) {
    if (input.billingUnit === "whole_kiln") return { rateKey: "whole_kiln", chargeCents: 6500 };
    if (input.billingUnit === "custom" || heat === "custom") return { rateKey: "custom_whole_kiln", chargeCents: 6500 };
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 3) return { rateKey: null, chargeCents: null };
    if (heat === "low") return { rateKey: "low_half_shelf", chargeCents: Math.min(input.quantity * 1500, 6500) };
    if (heat === "mid" || heat === "high") return { rateKey: "mid_half_shelf", chargeCents: Math.min(input.quantity * 2500, 6500) };
    return { rateKey: null, chargeCents: null };
  }
  if (input.version !== 2 && input.version !== 3) return { rateKey: null, chargeCents: null };
  if (input.version === 3) {
    if (input.billingUnit === "custom" || !["low", "mid", "high"].includes(heat)) return { rateKey: null, chargeCents: null };
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) return { rateKey: null, chargeCents: null };
    const cap = heat === "low" ? 8000 : heat === "mid" ? 12000 : 16000;
    const unit = heat === "low" ? 2000 : heat === "mid" ? 3500 : 4500;
    const base = input.billingUnit === "whole_kiln" || (heat === "high" && input.privateFulfilled)
      ? cap : Math.min(input.quantity * unit, cap);
    return { rateKey: `${heat}_shared_v3`, chargeCents: base + (input.privateFulfilled ? 2000 : 0) + (input.rushFulfilled ? 2000 : 0) };
  }
  // Custom and unsupported firing ranges require a staff quote.
  if (input.billingUnit === "custom" || (heat !== "low" && heat !== "mid")) return { rateKey: null, chargeCents: null };
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) return { rateKey: null, chargeCents: null };
  const cap = heat === "low" ? 8000 : 12000;
  const base = input.billingUnit === "whole_kiln" ? cap : Math.min(input.quantity * (heat === "low" ? 2000 : 3500), cap);
  return { rateKey: `${heat}_shared_v2`, chargeCents: base + (input.privateFulfilled ? 2000 : 0) + (input.rushFulfilled ? 2000 : 0) };
}
