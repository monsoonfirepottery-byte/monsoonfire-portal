Status: Completed (2026-02-05)

# P1 - Tighten notification prefs schema in Firestore rules

- Repo: portal
- Area: Security
- Evidence: `firestore.rules` for `/users/{uid}/prefs/notifications` only checks map types, not keys.
- Recommendation: enforce `hasOnlyKeys` for `channels`, `events`, `frequency`, `quietHours` to prevent unexpected fields.
- Effort: M
- Risk: Med
- What to test: valid prefs write succeeds; extra keys are rejected.
