import { defineSecret } from "firebase-functions/params";

export type StripeMode = "test" | "live";

export const STRIPE_TEST_SECRET_KEY = defineSecret("STRIPE_TEST_SECRET_KEY");
export const STRIPE_LIVE_SECRET_KEY = defineSecret("STRIPE_LIVE_SECRET_KEY");
export const STRIPE_TEST_WEBHOOK_SECRET = defineSecret("STRIPE_TEST_WEBHOOK_SECRET");
export const STRIPE_LIVE_WEBHOOK_SECRET = defineSecret("STRIPE_LIVE_WEBHOOK_SECRET");

export const STRIPE_SECRET_PARAMS = [
  STRIPE_TEST_SECRET_KEY,
  STRIPE_LIVE_SECRET_KEY,
  STRIPE_TEST_WEBHOOK_SECRET,
  STRIPE_LIVE_WEBHOOK_SECRET,
] as const;

function readSecretValue(secret: { value: () => string }, label: string): string {
  const value = secret.value().trim();
  if (!value) {
    throw new Error(`${label} is not configured`);
  }
  return value;
}

export function getStripeSecretKey(mode: StripeMode): string {
  return mode === "live"
    ? readSecretValue(STRIPE_LIVE_SECRET_KEY, "STRIPE_LIVE_SECRET_KEY")
    : readSecretValue(STRIPE_TEST_SECRET_KEY, "STRIPE_TEST_SECRET_KEY");
}

export function getStripeWebhookSecret(mode: StripeMode): string {
  return mode === "live"
    ? readSecretValue(STRIPE_LIVE_WEBHOOK_SECRET, "STRIPE_LIVE_WEBHOOK_SECRET")
    : readSecretValue(STRIPE_TEST_WEBHOOK_SECRET, "STRIPE_TEST_WEBHOOK_SECRET");
}

