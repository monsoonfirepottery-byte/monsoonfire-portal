# Codex Instructions — Monsoon Fire Portal

- Make changes as clean, complete files (no patch instructions).
- Prefer ONE file per response unless explicitly requested.
- Never write undefined values to Firestore payloads.
- Cloud Functions require Authorization: Bearer <idToken>.
- Dev admin header: x-admin-token is user-provided; never hardcode secrets.
- continueJourney requires body { uid, fromBatchId }.
- Keep UI tolerant of missing/extra Firestore fields.
- If touching App.tsx, preserve ErrorBoundary and in-flight guards.
- When adding queries, call out composite index implications.
- Prefer patterns portable to iOS (stateless request/response, explicit JSON contracts).
