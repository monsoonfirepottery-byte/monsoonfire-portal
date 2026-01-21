export function formatMaybeTimestamp(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate !== "function") return "-";
  try {
    return maybe.toDate().toLocaleString();
  } catch {
    return "-";
  }
}

export function formatDateTime(value: unknown): string {
  if (!value) return "-";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return maybe.toDate().toLocaleString();
      } catch {
        return "-";
      }
    }
  }
  return "-";
}

export function formatCents(value: unknown): string {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}
