Status: Completed (2026-02-05)

# P1 - Hard-disable dev admin tools in production

- Repo: portal
- Area: Security
- Evidence: `web/src/App.tsx` stores admin token in sessionStorage and exposes dev UI paths.
- Recommendation: guard dev tools behind build-time env checks; strip in prod.
- Effort: S
- Risk: Med
- What to test: prod build shows no admin token UI; dev build still works.
