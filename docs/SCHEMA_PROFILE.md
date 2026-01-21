# Monsoon Fire Portal — Profile schema

## Collection: `profiles/{uid}`
Document keyed by the client UID. The profile doc stores what the studio tracks outside of `users`.

Fields:
- `displayName` (string | null) — what the client prefers to be called.
- `preferredKilns` (array of strings) — which kilns the client likes or wants priority with.
- `membershipTier` (string) — e.g. `Studio`, `Premium`, `Founding`.
- `membershipSince` (timestamp) — when the tier was first assigned (can fall back to Firebase metadata).
- `membershipExpiresAt` (timestamp | null) — next renewal or expiry window.
- `notifyKiln` / `notifyClasses` / `notifyPieces` (boolean) — toggles surface on the profile form.
- `studioNotes` (string | null) — staff-provided context or reminders about the client.
- `updatedAt` (timestamp)

## Usage
- The Profile view streams this document and allows clients to edit display name, preferred kilns, and notification settings.
- The UI also surfaces studio notes (read-only) and historical membership metrics derived from batches (`useBatches`).

## Sample document
```json
{
  "displayName": "Mario",
  "preferredKilns": ["Kiln 2", "Kiln 1"],
  "membershipTier": "Studio",
  "membershipSince": "2025-10-12T13:45:00Z",
  "membershipExpiresAt": "2026-01-31T23:59:59Z",
  "notifyKiln": true,
  "notifyClasses": false,
  "notifyPieces": true,
  "studioNotes": "Loves reduction firings. Ask before loading.",
  "updatedAt": "2026-01-21T04:20:00Z"
}
```
