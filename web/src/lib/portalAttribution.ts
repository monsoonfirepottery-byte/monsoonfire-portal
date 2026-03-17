import { safeStorageReadJson, safeStorageRemoveItem, safeStorageSetItem } from "./safeStorage";

export const PORTAL_ENTRY_EXPERIMENT = "portal_path_v1";

export type PortalEntryVariant = "a" | "b";
export type PortalEntrySurface = "home" | "services" | "kiln_firing" | "memberships" | "contact";
export type PortalEntryTarget = "dashboard" | "reservations" | "membership" | "support";

export type PortalEntryAttribution = {
  experiment: typeof PORTAL_ENTRY_EXPERIMENT;
  variant: PortalEntryVariant;
  surface: PortalEntrySurface;
  target: PortalEntryTarget;
  capturedAtIso: string;
  expiresAtIso: string;
  sourcePath: string;
  arrivedTrackedAtIso?: string;
  authenticatedAtIso?: string;
  authenticatedUid?: string;
  targetConsumedAtIso?: string;
  targetOpenedAtIso?: string;
};

type PortalEntryCaptureResult = {
  entry: PortalEntryAttribution | null;
  cleanedHref: string | null;
};

type ReadOptions = {
  requireAuthenticatedUser?: boolean;
};

const STORAGE_AREA = "sessionStorage" as const;
const PORTAL_ENTRY_STORAGE_KEY = "mf_portal_entry_attribution_v1";
const PORTAL_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MF_QUERY_KEYS = ["mf_experiment", "mf_variant", "mf_surface", "mf_target"] as const;

function normalizeVariant(value: unknown): PortalEntryVariant | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "a" || normalized === "b" ? normalized : null;
}

function normalizeSurface(value: unknown): PortalEntrySurface | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  switch (normalized) {
    case "home":
    case "services":
    case "kiln_firing":
    case "memberships":
    case "contact":
      return normalized;
    default:
      return null;
  }
}

function normalizeTarget(value: unknown): PortalEntryTarget | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "dashboard":
    case "reservations":
    case "membership":
    case "support":
      return normalized;
    default:
      return null;
  }
}

function normalizeExperiment(value: unknown): typeof PORTAL_ENTRY_EXPERIMENT | null {
  if (typeof value !== "string") return null;
  return value.trim() === PORTAL_ENTRY_EXPERIMENT ? PORTAL_ENTRY_EXPERIMENT : null;
}

function normalizeSourcePath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function getNowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function clearPortalEntry(): void {
  safeStorageRemoveItem(STORAGE_AREA, PORTAL_ENTRY_STORAGE_KEY);
}

function writePortalEntry(entry: PortalEntryAttribution): void {
  safeStorageSetItem(STORAGE_AREA, PORTAL_ENTRY_STORAGE_KEY, JSON.stringify(entry));
}

function isPortalEntryAttribution(value: unknown): value is PortalEntryAttribution {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    normalizeExperiment(record.experiment) &&
      normalizeVariant(record.variant) &&
      normalizeSurface(record.surface) &&
      normalizeTarget(record.target) &&
      typeof record.capturedAtIso === "string" &&
      typeof record.expiresAtIso === "string"
  );
}

function normalizeStoredEntry(entry: PortalEntryAttribution, nowMs: number): PortalEntryAttribution | null {
  if (!isPortalEntryAttribution(entry)) {
    clearPortalEntry();
    return null;
  }

  const expiresAtMs = Date.parse(entry.expiresAtIso);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    clearPortalEntry();
    return null;
  }

  return {
    experiment: PORTAL_ENTRY_EXPERIMENT,
    variant: normalizeVariant(entry.variant) ?? "a",
    surface: normalizeSurface(entry.surface) ?? "home",
    target: normalizeTarget(entry.target) ?? "dashboard",
    capturedAtIso: entry.capturedAtIso,
    expiresAtIso: entry.expiresAtIso,
    sourcePath: normalizeSourcePath(entry.sourcePath),
    arrivedTrackedAtIso: typeof entry.arrivedTrackedAtIso === "string" ? entry.arrivedTrackedAtIso : undefined,
    authenticatedAtIso: typeof entry.authenticatedAtIso === "string" ? entry.authenticatedAtIso : undefined,
    authenticatedUid: typeof entry.authenticatedUid === "string" ? entry.authenticatedUid : undefined,
    targetConsumedAtIso: typeof entry.targetConsumedAtIso === "string" ? entry.targetConsumedAtIso : undefined,
    targetOpenedAtIso: typeof entry.targetOpenedAtIso === "string" ? entry.targetOpenedAtIso : undefined,
  };
}

function readStoredPortalEntry(nowMs = Date.now()): PortalEntryAttribution | null {
  const stored = safeStorageReadJson<PortalEntryAttribution>(STORAGE_AREA, PORTAL_ENTRY_STORAGE_KEY, null);
  if (!stored) return null;
  return normalizeStoredEntry(stored, nowMs);
}

function readScopedPortalEntry(nowMs = Date.now(), uid?: string | null, options?: ReadOptions): PortalEntryAttribution | null {
  const entry = readStoredPortalEntry(nowMs);
  if (!entry) return null;
  if (!entry.authenticatedUid) {
    return options?.requireAuthenticatedUser ? null : entry;
  }
  if (!uid) {
    return options?.requireAuthenticatedUser ? null : entry;
  }
  if (entry.authenticatedUid !== uid) {
    clearPortalEntry();
    return null;
  }
  return entry;
}

function updatePortalEntry(
  updater: (entry: PortalEntryAttribution) => PortalEntryAttribution | null,
  nowMs = Date.now()
): PortalEntryAttribution | null {
  const current = readStoredPortalEntry(nowMs);
  if (!current) return null;
  const next = updater(current);
  if (!next) {
    clearPortalEntry();
    return null;
  }
  writePortalEntry(next);
  return next;
}

export function readPortalEntryAttribution(nowMs = Date.now(), uid?: string | null): PortalEntryAttribution | null {
  return readScopedPortalEntry(nowMs, uid);
}

export function capturePortalEntryAttributionFromHref(
  href: string,
  sourcePath = "/",
  nowMs = Date.now()
): PortalEntryCaptureResult {
  let url: URL;
  try {
    url = typeof window !== "undefined" ? new URL(href, window.location.origin) : new URL(href);
  } catch {
    return { entry: null, cleanedHref: null };
  }

  const experiment = normalizeExperiment(url.searchParams.get("mf_experiment"));
  const variant = normalizeVariant(url.searchParams.get("mf_variant"));
  const surface = normalizeSurface(url.searchParams.get("mf_surface"));
  const target = normalizeTarget(url.searchParams.get("mf_target"));

  if (!experiment || !variant || !surface || !target) {
    return { entry: null, cleanedHref: null };
  }

  const entry: PortalEntryAttribution = {
    experiment,
    variant,
    surface,
    target,
    capturedAtIso: getNowIso(nowMs),
    expiresAtIso: getNowIso(nowMs + PORTAL_ENTRY_TTL_MS),
    sourcePath: normalizeSourcePath(sourcePath),
  };

  writePortalEntry(entry);

  MF_QUERY_KEYS.forEach((key) => {
    url.searchParams.delete(key);
  });

  return {
    entry,
    cleanedHref: url.toString(),
  };
}

export function shouldTrackPortalEntryArrived(nowMs = Date.now()): boolean {
  const entry = readStoredPortalEntry(nowMs);
  return Boolean(entry && !entry.arrivedTrackedAtIso);
}

export function markPortalEntryArrived(nowMs = Date.now()): PortalEntryAttribution | null {
  return updatePortalEntry((entry) => {
    if (entry.arrivedTrackedAtIso) return entry;
    return {
      ...entry,
      arrivedTrackedAtIso: getNowIso(nowMs),
    };
  }, nowMs);
}

export function shouldTrackPortalEntryAuthenticated(uid: string, nowMs = Date.now()): boolean {
  const entry = readStoredPortalEntry(nowMs);
  if (!entry) return false;
  if (entry.authenticatedUid && entry.authenticatedUid !== uid) {
    clearPortalEntry();
    return false;
  }
  return !entry.authenticatedAtIso;
}

export function markPortalEntryAuthenticated(uid: string, nowMs = Date.now()): PortalEntryAttribution | null {
  return updatePortalEntry((entry) => {
    if (entry.authenticatedUid && entry.authenticatedUid !== uid) {
      return null;
    }
    if (entry.authenticatedAtIso) {
      return entry.authenticatedUid === uid || !entry.authenticatedUid
        ? { ...entry, authenticatedUid: entry.authenticatedUid ?? uid }
        : null;
    }
    return {
      ...entry,
      authenticatedAtIso: getNowIso(nowMs),
      authenticatedUid: uid,
    };
  }, nowMs);
}

export function readPendingPortalTarget(uid: string, nowMs = Date.now()): PortalEntryTarget | null {
  const entry = readScopedPortalEntry(nowMs, uid, { requireAuthenticatedUser: true });
  if (!entry || entry.targetConsumedAtIso) return null;
  return entry.target;
}

export function consumePortalTarget(uid: string, nowMs = Date.now()): PortalEntryTarget | null {
  const current = readScopedPortalEntry(nowMs, uid, { requireAuthenticatedUser: true });
  if (!current || current.targetConsumedAtIso) return null;
  const next = updatePortalEntry((entry) => {
    if (entry.authenticatedUid !== uid) return null;
    return {
      ...entry,
      targetConsumedAtIso: entry.targetConsumedAtIso ?? getNowIso(nowMs),
    };
  }, nowMs);
  return next?.target ?? current.target;
}

export function shouldTrackPortalTargetOpened(uid: string, nowMs = Date.now()): boolean {
  const entry = readScopedPortalEntry(nowMs, uid, { requireAuthenticatedUser: true });
  return Boolean(entry && !entry.targetOpenedAtIso);
}

export function markPortalTargetOpened(uid: string, nowMs = Date.now()): PortalEntryAttribution | null {
  return updatePortalEntry((entry) => {
    if (entry.authenticatedUid !== uid) return null;
    if (entry.targetOpenedAtIso) return entry;
    return {
      ...entry,
      targetOpenedAtIso: getNowIso(nowMs),
    };
  }, nowMs);
}

export function clearPortalEntryAttribution(): void {
  clearPortalEntry();
}
