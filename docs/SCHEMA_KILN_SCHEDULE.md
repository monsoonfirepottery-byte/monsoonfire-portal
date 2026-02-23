# Firestore Schema — Kiln Schedule

This schema supports the Kiln Schedule view (kiln cards + monthly calendar + reminders).

## Collections

### `kilns`
Represents a single kiln and its typical cycles.

Fields:
- `name` (string)
- `type` (string) — e.g. Electric, Gas
- `volume` (string) — human readable (e.g. "7 cu ft")
- `maxTemp` (string) — human readable (e.g. "2232F")
- `status` (string) — `idle | loading | firing | cooling | unloading | maintenance`
- `isAvailable` (boolean)
- `typicalCycles` (array)
  - `id` (string)
  - `name` (string)
  - `typicalDurationHours` (number)
  - `tempRange` (string)
  - `notes` (string | null)
- `notes` (string | null)

Example document:
```json
{
  "name": "Kiln 1",
  "type": "Electric",
  "volume": "7 cu ft",
  "maxTemp": "2232F",
  "status": "loading",
  "isAvailable": true,
  "typicalCycles": [
    {
      "id": "k1-bisque",
      "name": "Bisque",
      "typicalDurationHours": 9,
      "tempRange": "1830F",
      "notes": "Slow ramp, overnight cool."
    }
  ],
  "notes": "Best for small batches and classroom work."
}
```

### `kilnFirings`
Scheduled or in-progress firing windows that drive the calendar.

Fields:
- `kilnId` (string) — must match a `kilns` doc id
- `title` (string)
- `cycleType` (string) — e.g. `bisque`, `glaze`, `custom`
- `startAt` (timestamp)
- `endAt` (timestamp)
- `status` (string) — `scheduled | in-progress | completed | cancelled`
- `confidence` (string) — `scheduled | estimated`
- `notes` (string | null)

Example document:
```json
{
  "kilnId": "kiln-1",
  "title": "Bisque firing",
  "cycleType": "bisque",
  "startAt": "2026-01-21T16:30:00Z",
  "endAt": "2026-01-22T02:00:00Z",
  "status": "scheduled",
  "confidence": "scheduled",
  "notes": "Drop-off deadline 7:00 AM."
}
```

## Queries

- Kilns: `orderBy("name", "asc")`, limit 25.
- Firings: `orderBy("startAt", "asc")`, limit 200.

These queries use single-field indexes only (no composite index expected).

## Notes

- Do not write `undefined` into Firestore fields.
- The Kiln Schedule view only uses mock fallback when `VITE_DASHBOARD_USE_MOCK_KILN_DATA=true`.
- Outside development, mock fallback additionally requires `VITE_DASHBOARD_MOCK_KILN_DATA_ACK=ALLOW_NON_DEV_MOCK_DATA`.
- Reminders are generated as downloadable `.ics` files client-side.
