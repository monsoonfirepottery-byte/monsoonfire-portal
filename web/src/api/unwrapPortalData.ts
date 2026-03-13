export function unwrapPortalData<T>(payload: T | { ok?: unknown; data?: T } | null | undefined): T | null {
  if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === true) {
    const nested = (payload as { data?: T }).data;
    if (nested && typeof nested === "object") {
      return nested;
    }
  }
  return (payload as T | null | undefined) ?? null;
}
