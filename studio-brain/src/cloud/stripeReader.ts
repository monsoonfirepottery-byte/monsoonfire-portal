export type StripeReadModel = {
  readAt: string;
  unsettledPayments: number;
  durationMs?: number;
  mode?: "stub" | "live_read";
  warnings?: string[];
};

export type StripeReaderPolicy = {
  allowed: boolean;
  mode: "stub" | "live_read";
  warnings: string[];
};

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function resolveStripeReaderPolicy(options: {
  stripeMode?: string;
  allowStubOverride?: boolean;
} = {}): StripeReaderPolicy {
  const stripeMode = options.stripeMode ?? process.env.STRIPE_MODE ?? "test";
  const allowStubOverride =
    options.allowStubOverride ?? parseBool(process.env.STUDIO_BRAIN_ALLOW_STRIPE_STUB);
  const production = process.env.NODE_ENV === "production";

  if (stripeMode !== "live" || !production) {
    return { allowed: true, mode: "stub", warnings: [] };
  }

  if (allowStubOverride) {
    return {
      allowed: true,
      mode: "stub",
      warnings: [
        "stripe stub override enabled for production live mode",
        "cloud functions remain the authoritative Stripe source of truth",
      ],
    };
  }

  return {
    allowed: false,
    mode: "live_read",
    warnings: ["production live mode requested but Stripe live-read is not implemented"],
  };
}

// P0: read-only scaffold. No direct Stripe secret use in local brain.
// Cloud (Functions) remains authoritative for payment state.
export async function readStripeModel(): Promise<StripeReadModel> {
  const startedAt = Date.now();
  const policy = resolveStripeReaderPolicy();

  if (!policy.allowed) {
    throw new Error("stripe stub fallback is blocked for production live mode");
  }

  return {
    readAt: new Date().toISOString(),
    unsettledPayments: 0,
    durationMs: Date.now() - startedAt,
    mode: policy.mode,
    warnings: policy.warnings,
  };
}
