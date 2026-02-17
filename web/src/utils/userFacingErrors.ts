function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "");
}

export function isConnectivityError(err: unknown): boolean {
  const raw = asMessage(err).toLowerCase();
  return (
    raw.includes("failed to fetch") ||
    raw.includes("networkerror") ||
    raw.includes("network request failed") ||
    raw.includes("load failed")
  );
}

export function checkoutErrorMessage(err: unknown): string {
  if (isConnectivityError(err)) {
    return "Could not reach checkout services. Check your connection and try again.";
  }

  const raw = asMessage(err).toLowerCase();
  if (raw.includes("stripe") || raw.includes("checkout")) {
    return "Checkout is temporarily unavailable. Please try again in a minute.";
  }

  return "We could not start checkout right now. Please try again.";
}

export function serviceOfflineMessage(): string {
  return "Could not reach portal services. If you are using local emulators, confirm Firestore and Functions are running.";
}
