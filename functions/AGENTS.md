# Functions Workspace Agent Guide

Canonical repository instructions live in [`../AGENTS.md`](../AGENTS.md).
Use this file only for functions-package command shortcuts to avoid drift.

## Functions Commands

- Install dependencies: `npm --prefix functions install`
- Build TypeScript: `npm --prefix functions run build`
- Lint: `npm --prefix functions run lint`
- Run tests: `npm --prefix functions run test`
- Emulator shell: `npm --prefix functions run shell`
- Deploy functions: `npm --prefix functions run deploy`

## Notes

- Keep protected routes on `Authorization: Bearer <idToken>`.
- Preserve dev-only admin header behavior (`x-admin-token`) without hardcoding token values.
- Secrets hint: local credentials/tokens are available under `../secrets/portal/` when verification needs real auth context.
