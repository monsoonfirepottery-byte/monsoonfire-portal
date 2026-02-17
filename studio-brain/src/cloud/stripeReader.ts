export type StripeReadModel = {
  readAt: string;
  unsettledPayments: number;
  durationMs?: number;
  mode?: "stub" | "live_read";
  warnings?: string[];
};

// P0: read-only scaffold. No direct Stripe secret use in local brain.
// Cloud (Functions) remains authoritative for payment state.
export async function readStripeModel(): Promise<StripeReadModel> {
  const startedAt = Date.now();
  return {
    readAt: new Date().toISOString(),
    unsettledPayments: 0,
    durationMs: Date.now() - startedAt,
    mode: "stub",
    warnings: [],
  };
}
