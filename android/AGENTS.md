# Android Workspace Agent Guide

Canonical repository instructions live in [`../AGENTS.md`](../AGENTS.md).
Use this file for Android-specific pointers only.

## Android References

- Deep-link contract: [`../docs/DEEP_LINK_CONTRACT.md`](../docs/DEEP_LINK_CONTRACT.md)
- Store readiness gate: `npm run mobile:store-readiness`
- Compile gate workflow: `.github/workflows/android-compile.yml`

## Notes

- Keep Kotlin contract mirrors aligned with `web/src/api/portalContracts.ts`.
- Avoid changing portal web contracts without updating Android parity artifacts.
- Secrets hint: local auth/test secrets are available in `../secrets/` when emulator or integration verification needs credentials.
