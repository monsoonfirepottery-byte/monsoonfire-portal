type AnalyticsValue = string | number | boolean | null | undefined;
export type AnalyticsProps = Record<string, AnalyticsValue>;

type IdentifyUser = {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
};

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
  }
}

const DEV_MODE = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

export function shortId(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (!trimmed) return "unknown";
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function withTimestamp(props: AnalyticsProps = {}): AnalyticsProps {
  return {
    ...props,
    atIso: new Date().toISOString(),
  };
}

export function track(eventName: string, props: AnalyticsProps = {}): void {
  const payload = withTimestamp(props);

  if (DEV_MODE) {
    console.info("[analytics]", eventName, payload);
  }

  if (typeof window === "undefined") return;
  const gtag = window.gtag;
  if (typeof gtag !== "function") return;

  try {
    gtag("event", eventName, payload);
  } catch {
    // Analytics must never break primary user flows.
  }
}

export function identify(user: IdentifyUser | null | undefined): void {
  if (!user?.uid) return;

  const payload = withTimestamp({
    uid: shortId(user.uid),
    emailDomain: typeof user.email === "string" ? user.email.split("@")[1] || null : null,
    hasDisplayName: Boolean(user.displayName),
  });

  if (DEV_MODE) {
    console.info("[analytics]", "identify", payload);
  }

  if (typeof window === "undefined") return;
  const gtag = window.gtag;
  if (typeof gtag !== "function") return;

  try {
    gtag("set", "user_properties", payload);
  } catch {
    // Ignore telemetry transport issues.
  }
}
