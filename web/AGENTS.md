# Web Workspace Agent Guide

Canonical repository instructions live in [`../AGENTS.md`](../AGENTS.md).
Use this file only for web-package command shortcuts to avoid drift.

## Web Commands

- Install dependencies: `npm --prefix web install`
- Start dev server: `npm --prefix web run dev`
- Build: `npm --prefix web run build`
- Lint: `npm --prefix web run lint`
- Unit tests: `npm --prefix web run test:run`
- Playwright smoke helper: `npm --prefix web run check:reservations-journey-playwright`

## Notes

- Restart dev server after editing Vite/Firebase environment values.
- Keep request contracts in sync with `web/src/api/portalContracts.ts`.
- Secrets hint: local portal staff credentials for auth-gated smoke checks are in `../secrets/portal/`.
