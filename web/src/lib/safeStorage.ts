export type StorageArea = "localStorage" | "sessionStorage";

const FALLBACK_STORAGE: StorageArea = "localStorage";

function resolveStorage(area: StorageArea): Storage | null {
  if (typeof window === "undefined") return null;

  if (area === "localStorage") {
    if (!window.localStorage) return null;
    return window.localStorage;
  }

  if (area === "sessionStorage") {
    if (!window.sessionStorage) return null;
    return window.sessionStorage;
  }

  return FALLBACK_STORAGE === "localStorage" ? window.localStorage : window.sessionStorage;
}

function safeAction<T>(area: StorageArea, callback: (storage: Storage) => T): T | null {
  try {
    const storage = resolveStorage(area);
    if (!storage) return null;
    return callback(storage);
  } catch {
    return null;
  }
}

export function safeStorageGetItem(area: StorageArea, key: string): string | null {
  return safeAction(area, (storage) => storage.getItem(key)) ?? null;
}

export function safeStorageReadJson<T>(area: StorageArea, key: string, fallback: T | null = null): T | null {
  const raw = safeStorageGetItem(area, key);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    safeStorageRemoveItem(area, key);
    return fallback;
  }
}

export function safeStorageSetItem(area: StorageArea, key: string, value: string): void {
  safeAction(area, (storage) => {
    storage.setItem(key, value);
    return null;
  });
}

export function safeStorageRemoveItem(area: StorageArea, key: string): void {
  safeAction(area, (storage) => {
    storage.removeItem(key);
    return null;
  });
}

export function safeReadBoolean(area: StorageArea, key: string, fallback = false): boolean {
  const raw = safeStorageGetItem(area, key);
  if (raw === null) return fallback;
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}
