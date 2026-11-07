const RESET_KEY = "mf-dev-message-sw-reset";

async function clearDevelopmentServiceWorkerState(hadReset: boolean): Promise<void> {
  let didCleanup = false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    didCleanup = registrations.length > 0;
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Ignore service worker teardown failures in development.
  }

  if (typeof caches !== "undefined") {
    try {
      const cacheKeys = await caches.keys();
      didCleanup = didCleanup || cacheKeys.length > 0;
      await Promise.all(cacheKeys.map((name) => caches.delete(name)));
    } catch {
      // Ignore cache cleanup failures in development.
    }
  }

  if (!hadReset) {
    try {
      window.localStorage?.setItem?.(RESET_KEY, "1");
    } catch {
      // Ignore localStorage persistence failures in restricted environments.
    }

    if (didCleanup) {
      window.location.reload();
      return;
    }
  }

  if (hadReset) {
    try {
      window.localStorage?.removeItem?.(RESET_KEY);
    } catch {
      // Ignore localStorage cleanup failures in restricted environments.
    }
  }
}

export function resetDevelopmentServiceWorkers(): void {
  if (typeof window === "undefined") return;
  const hostname = window.location.hostname;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocalhost || !("serviceWorker" in navigator)) return;

  let hadReset = false;
  try {
    hadReset = window.localStorage?.getItem?.(RESET_KEY) === "1";
  } catch {
    hadReset = false;
  }

  void clearDevelopmentServiceWorkerState(hadReset);
}

resetDevelopmentServiceWorkers();

