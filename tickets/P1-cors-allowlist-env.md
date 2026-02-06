Status: Completed (2026-02-05)

# P1 - Move CORS allowlist to env for portal domains

- Repo: portal
- Area: Backend
- Evidence: `functions/src/shared.ts` uses `DEFAULT_ALLOWED_ORIGINS` list.
- Recommendation: set `ALLOWED_ORIGINS` in env for prod/staging domains; document required values.
- Effort: S
- Risk: Low
- What to test: requests from portal domains pass preflight.
