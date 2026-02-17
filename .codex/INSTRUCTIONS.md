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

## Collaboration defaults from durable memory

- Default execution mode: high autonomy.
  - Continue implementation until a concrete blocker appears.
  - Minimize routine checkpoint prompts; surface only blocking decisions.
- Use external memory workspace for cross-session continuity:
  - `C:\Users\micah\.codex\memory`
  - Stable records: `accepted/accepted.jsonl`
  - Candidate records: `proposed/proposed.jsonl`
- Keep strategic thread visible:
  - monitor West Valley/Phoenix expansion real-estate opportunities while home studio remains baseline.
