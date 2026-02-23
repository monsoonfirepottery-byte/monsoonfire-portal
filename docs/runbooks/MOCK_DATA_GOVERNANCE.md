# Mock Data Governance Runbook

Date: 2026-02-23  
Owner: Platform + Portal + Studio-Brain

This runbook defines the approved, temporary pathways for mock/sample data in development and controlled non-dev incidents.

## 1) Dashboard kiln mock data (Portal)

File: `web/src/views/DashboardView.tsx`

- Default: mock fallback disabled.
- Dev enable:
  - `VITE_DASHBOARD_USE_MOCK_KILN_DATA=true`
- Non-dev override (temporary only):
  - `VITE_DASHBOARD_USE_MOCK_KILN_DATA=true`
  - `VITE_DASHBOARD_MOCK_KILN_DATA_ACK=ALLOW_NON_DEV_MOCK_DATA`
- Telemetry:
  - `dashboard_kiln_sample_fallback_used`
  - `dashboard_kiln_sample_fallback_blocked`

Exit criteria for non-dev override:
- upstream kiln data source restored
- mock fallback events return to zero

## 2) Materials sample seeding (Functions)

File: `functions/src/materials.ts`

- `seedMaterialsCatalog` always requires `force=true`.
- Emulator/dev runtime:
  - `force=true` is sufficient.
- Non-dev runtime (blocked by default):
  - set env `ALLOW_NON_DEV_SAMPLE_SEEDING=true`
  - send request `acknowledge=ALLOW_NON_DEV_SAMPLE_SEEDING`
  - optional `reason` string should be supplied for audit context.
- Logging:
  - `seedMaterialsCatalog blocked by policy`
  - `seedMaterialsCatalog policy allowed`
  - `seedMaterialsCatalog completed`

Exit criteria for non-dev override:
- seed intent completed
- `ALLOW_NON_DEV_SAMPLE_SEEDING` reset to false/removed

## 3) Stripe reader stub mode (Studio-Brain)

File: `studio-brain/src/cloud/stripeReader.ts`

- Default reader mode: `STUDIO_BRAIN_STRIPE_READER_MODE=auto`
- In production + `STRIPE_MODE=live`:
  - stub mode is blocked unless `STUDIO_BRAIN_ALLOW_STRIPE_STUB=true`
- Explicit mode controls:
  - `STUDIO_BRAIN_STRIPE_READER_MODE=auto|stub|live_read`
  - `live_read` currently returns blocked policy (not implemented)

Exit criteria for production stub override:
- Functions Stripe path healthy
- remove `STUDIO_BRAIN_ALLOW_STRIPE_STUB`
- verify no override warnings on startup

## 4) Incident checklist for temporary override windows

1. Record incident/ticket and owner.
2. Set minimum required flags only.
3. Execute action and collect logs.
4. Remove override flags immediately.
5. Post incident evidence in ticket and verify normal path.
