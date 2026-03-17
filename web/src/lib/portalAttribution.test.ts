import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_ENTRY_EXPERIMENT,
  capturePortalEntryAttributionFromHref,
  clearPortalEntryAttribution,
  consumePortalTarget,
  markPortalEntryArrived,
  markPortalEntryAuthenticated,
  markPortalTargetOpened,
  readPendingPortalTarget,
  readPortalEntryAttribution,
  shouldTrackPortalEntryArrived,
  shouldTrackPortalEntryAuthenticated,
  shouldTrackPortalTargetOpened,
} from "./portalAttribution";

type TestStorage = {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeStorage(): Storage {
  const backing: TestStorage = {
    store: new Map<string, string>(),
    getItem: (key) => (backing.store.has(key) ? backing.store.get(key) ?? null : null),
    setItem: (key, value) => {
      backing.store.set(key, String(value));
    },
    removeItem: (key) => {
      backing.store.delete(key);
    },
  };

  const storage = backing as unknown as Storage;
  storage.clear = () => {
    backing.store.clear();
  };
  storage.key = (index: number) => Array.from(backing.store.keys())[index] ?? null;
  Object.defineProperty(storage, "length", {
    configurable: true,
    get: () => backing.store.size,
  });
  return storage;
}

describe("portalAttribution", () => {
  afterEach(() => {
    clearPortalEntryAttribution();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installWindow() {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    vi.stubGlobal("window", {
      location: {
        origin: "https://portal.monsoonfire.com",
      },
      localStorage,
      sessionStorage,
    });
    return { localStorage, sessionStorage };
  }

  it("captures portal entry params into session storage and strips them from the URL", () => {
    const { localStorage, sessionStorage } = installWindow();
    const nowMs = Date.parse("2026-03-14T16:00:00.000Z");

    const result = capturePortalEntryAttributionFromHref(
      "https://portal.monsoonfire.com/?mf_experiment=portal_path_v1&mf_variant=b&mf_surface=kiln-firing&mf_target=reservations&utm_content=portal_path_v1_kiln_firing_b_reservations&ref=homepage",
      "/",
      nowMs
    );

    expect(result.entry).toMatchObject({
      experiment: PORTAL_ENTRY_EXPERIMENT,
      variant: "b",
      surface: "kiln_firing",
      target: "reservations",
      sourcePath: "/",
    });
    expect(result.cleanedHref).toBe(
      "https://portal.monsoonfire.com/?utm_content=portal_path_v1_kiln_firing_b_reservations&ref=homepage"
    );
    expect(readPortalEntryAttribution(nowMs)).toMatchObject({
      variant: "b",
      surface: "kiln_firing",
      target: "reservations",
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });

  it("keeps attribution scoped to the authenticated user and consumes the target once", () => {
    installWindow();
    const nowMs = Date.parse("2026-03-14T17:00:00.000Z");

    capturePortalEntryAttributionFromHref(
      "https://portal.monsoonfire.com/?mf_experiment=portal_path_v1&mf_variant=a&mf_surface=services&mf_target=reservations",
      "/services/",
      nowMs
    );

    expect(shouldTrackPortalEntryAuthenticated("user_123", nowMs + 1_000)).toBe(true);
    markPortalEntryAuthenticated("user_123", nowMs + 1_000);
    expect(shouldTrackPortalEntryAuthenticated("user_123", nowMs + 2_000)).toBe(false);
    expect(readPendingPortalTarget("user_123", nowMs + 3_000)).toBe("reservations");
    expect(consumePortalTarget("user_123", nowMs + 4_000)).toBe("reservations");
    expect(readPendingPortalTarget("user_123", nowMs + 5_000)).toBeNull();
    expect(readPortalEntryAttribution(nowMs + 5_000, "user_123")).toMatchObject({
      authenticatedUid: "user_123",
      targetConsumedAtIso: "2026-03-14T17:00:04.000Z",
    });
  });

  it("clears captured attribution when a different user session appears", () => {
    const { sessionStorage } = installWindow();
    const nowMs = Date.parse("2026-03-14T18:00:00.000Z");

    capturePortalEntryAttributionFromHref(
      "https://portal.monsoonfire.com/?mf_experiment=portal_path_v1&mf_variant=b&mf_surface=contact&mf_target=support",
      "/contact/",
      nowMs
    );
    markPortalEntryAuthenticated("user_123", nowMs + 1_000);

    expect(shouldTrackPortalEntryAuthenticated("user_456", nowMs + 2_000)).toBe(false);
    expect(readPortalEntryAttribution(nowMs + 2_000, "user_456")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("tracks arrival and target-open markers once for the same authenticated user", () => {
    installWindow();
    const nowMs = Date.parse("2026-03-14T19:00:00.000Z");

    capturePortalEntryAttributionFromHref(
      "https://portal.monsoonfire.com/?mf_experiment=portal_path_v1&mf_variant=a&mf_surface=memberships&mf_target=membership",
      "/memberships/",
      nowMs
    );

    expect(shouldTrackPortalEntryArrived(nowMs)).toBe(true);
    markPortalEntryArrived(nowMs + 1_000);
    expect(shouldTrackPortalEntryArrived(nowMs + 2_000)).toBe(false);

    markPortalEntryAuthenticated("user_123", nowMs + 3_000);
    expect(shouldTrackPortalTargetOpened("user_123", nowMs + 4_000)).toBe(true);
    markPortalTargetOpened("user_123", nowMs + 5_000);
    expect(shouldTrackPortalTargetOpened("user_123", nowMs + 6_000)).toBe(false);
  });

  it("expires stale attribution so later sessions are not contaminated", () => {
    installWindow();
    const nowMs = Date.parse("2026-03-14T20:00:00.000Z");

    capturePortalEntryAttributionFromHref(
      "https://portal.monsoonfire.com/?mf_experiment=portal_path_v1&mf_variant=a&mf_surface=home&mf_target=dashboard",
      "/ab/b/",
      nowMs
    );

    expect(readPortalEntryAttribution(nowMs)).not.toBeNull();
    expect(readPortalEntryAttribution(nowMs + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});
