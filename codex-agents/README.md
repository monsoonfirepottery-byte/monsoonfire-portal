# @monsoonfire/codex-agents

Canonical agent guidance files for Monsoon Fire Portal and related projects.

This package is intended to be installed as a dev dependency and synced into a repo so Codex and other agents always read up-to-date `AGENTS.md` files.

## Included files

- `AGENTS.md` (repo root guidance)
- `web/AGENTS.md` (React/Vite guidance)
- `functions/AGENTS.md` (Cloud Functions guidance)
- `codex/SESSION_TEMPLATE.md` (session scaffolding template)

## How to use in a repo

Install:

```bash
npm install -D @monsoonfire/codex-agents
```

## Notes

- Keep repo docs and runbooks in sync with the latest portal features (ex: materials catalog + Stripe checkout).
- When updating AGENTS guidance, re-publish this package so downstream repos stay aligned.
