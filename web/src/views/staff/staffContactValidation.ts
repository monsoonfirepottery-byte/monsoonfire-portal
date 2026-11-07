export type ArtistContactField = "artist-name" | "artist-email";

export function missingArtistContactFields(displayName: string, email: string): ArtistContactField[] {
  return [
    !displayName.trim() ? "artist-name" : null,
    !email.trim() ? "artist-email" : null,
  ].filter((field): field is ArtistContactField => field !== null);
}

export function missingArtistContactMessage(displayName: string, email: string): string | null {
  const missing = missingArtistContactFields(displayName, email).map((field) =>
    field === "artist-name" ? "artist name" : "artist email",
  );
  return missing.length > 0
    ? `Add ${missing.join(" and ")} before marking the work ready.`
    : null;
}
