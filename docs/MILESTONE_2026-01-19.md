# Milestone — 2026-01-19

✅ Web is green with emulator + prod switching.
✅ Canonical API contracts extracted: web/src/api/portalContracts.ts
✅ Web API client centralized: web/src/api/portalApi.ts
✅ App routes CF calls through the API client (no raw fetch in App.tsx)
✅ API contract doc added: docs/API_CONTRACTS.md
✅ iOS reference client created (spec-level): PortalContracts.swift + PortalApiClient.swift

Notes:
- Windows machine cannot run Swift/Xcode; iOS smoke test must be executed on macOS.
- Emulator ADMIN_TOKEN must be set in env and emulator restarted.

## Progress update (2026-01-22)
- Events feature implemented (web UI + Functions + contracts + seed script).
- Materials and Supplies catalog implemented with Stripe Checkout.
- UI styling pass applied across core views to align with shared tokens.
