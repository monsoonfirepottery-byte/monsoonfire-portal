import { afterEach, describe, expect, it, vi } from "vitest";
import { safeReadBoolean, safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "./safeStorage";

type TestStorage = {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeStorage(): TestStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) ?? null : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("safeStorage", () => {
  const makeWindow = (localStorage: Storage, sessionStorage?: Storage) => {
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage: sessionStorage ?? localStorage,
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns fallback when localStorage read throws", () => {
    const testStorage = makeStorage();
    const storage: Storage = {
      ...(testStorage as TestStorage),
      clear: () => {
        /* no-op */
      },
      key: () => null,
      length: 0,
    };
    const throwingStorage = { ...storage, getItem: () => { throw new Error("storage unavailable"); } };

    makeWindow(throwingStorage);

    expect(safeStorageGetItem("localStorage", "mf_unknown_key")).toBeNull();
    expect(safeReadBoolean("localStorage", "mf_flag")).toBe(false);
  });

  it("reads and writes boolean flags safely when storage is healthy", () => {
    const testStorage = makeStorage();
    const storage = testStorage as unknown as Storage;
    storage.clear = () => {
      testStorage.store.clear();
    };
    storage.key = (index: number) => Array.from(testStorage.store.keys())[index] ?? null;
    Object.defineProperty(storage, "length", {
      configurable: true,
      get: () => testStorage.store.size,
    });

    makeWindow(storage);

    const valueKey = "mf_safe_storage_bool";
    safeStorageSetItem("localStorage", valueKey, "1");
    expect(safeStorageGetItem("localStorage", valueKey)).toBe("1");
    expect(safeReadBoolean("localStorage", valueKey)).toBe(true);

    safeStorageRemoveItem("localStorage", valueKey);
    expect(safeStorageGetItem("localStorage", valueKey)).toBeNull();
    expect(safeReadBoolean("localStorage", valueKey)).toBe(false);
  });

  it("does not throw when localStorage set/remove/write operations fail", () => {
    const testStorage = makeStorage();
    const storage = testStorage as unknown as Storage;
    storage.clear = () => {
      testStorage.store.clear();
    };
    storage.key = () => null;
    Object.defineProperty(storage, "length", {
      configurable: true,
      get: () => testStorage.store.size,
    });

    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    makeWindow(storage);

    expect(() => safeStorageSetItem("localStorage", "mf_fail", "value")).not.toThrow();
    expect(() => safeStorageRemoveItem("localStorage", "mf_fail")).not.toThrow();
  });
});
