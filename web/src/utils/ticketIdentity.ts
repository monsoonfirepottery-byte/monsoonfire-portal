/**
 * Human-facing ticket language. The full ticket ID remains the stable
 * identifier for API calls, Firestore, and billing; these helpers only shape
 * what a person has to read.
 */
export function humanTicketReference(ticketId: string | null | undefined): string {
  const normalized = typeof ticketId === "string" ? ticketId.trim() : "";
  if (!normalized) return "Firing ticket";

  const lastSegment = normalized.split("-").filter(Boolean).at(-1) ?? normalized;
  const compact = lastSegment.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!compact) return "Firing ticket";
  return `Firing ticket ${compact.slice(-6)}`;
}

export function humanTicketName(displayName: string | null | undefined): string {
  const normalized = typeof displayName === "string" ? displayName.trim() : "";
  return normalized && normalized.toLowerCase() !== "artist" ? normalized : "Your firing";
}

export function technicalTicketReference(ticketId: string | null | undefined): string {
  const normalized = typeof ticketId === "string" ? ticketId.trim() : "";
  return normalized ? `Internal ticket ID: ${normalized}` : "Internal ticket ID unavailable";
}
