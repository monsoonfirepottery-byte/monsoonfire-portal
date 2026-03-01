# iOS Workspace Agent Guide

Canonical repository instructions live in [`../AGENTS.md`](../AGENTS.md).
Use this file for iOS-specific pointers only.

## iOS References

- iOS runbook: [`../docs/IOS_RUNBOOK.md`](../docs/IOS_RUNBOOK.md)
- Deep-link contract: [`../docs/DEEP_LINK_CONTRACT.md`](../docs/DEEP_LINK_CONTRACT.md)
- Store readiness gate: `npm run mobile:store-readiness`

## Notes

- Keep Swift contract mirrors aligned with `web/src/api/portalContracts.ts`.
- Treat this directory as parity/reference unless explicitly working on native implementation tasks.
- Secrets hint: local auth/test secrets are available in `../secrets/` when emulator or integration verification needs credentials.
