import { afterEach, describe, expect, it, vi } from "vitest";

describe("development service worker cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not touch registrations outside localhost", async () => {
    const getRegistrations = vi.fn();
    vi.stubGlobal("window", { location: { hostname: "portal.monsoonfire.com" } });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });
    await import("./devServiceWorkerCleanup");
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("unregisters development service workers on localhost", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    vi.stubGlobal("window", {
      location: { hostname: "localhost", reload: vi.fn() },
      localStorage: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() },
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue([]) });
    await import("./devServiceWorkerCleanup");
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  });
});

