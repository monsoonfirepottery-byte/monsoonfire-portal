# P2 — Portal Inline Style to CSS Migration

Status: Completed

Date: 2026-02-17

Problem
- Several portal React views still render styling through `style={{ ... }}` props.
- This increases CSP risk surface and makes style governance harder as UI logic grows.

Current Coverage
- Completed:
  - `web/src/components/TroubleshootingPanel.tsx`
  - `web/src/components/ActiveBatchCard.tsx`
  - `web/src/views/DashboardView.tsx`
  - `web/src/views/ReservationsView.tsx`
  - `web/src/views/StaffView.tsx`
  - `web/src/views/staff/AgentOpsModule.tsx`
  - `web/src/views/staff/StudioBrainModule.tsx`
  - `web/src/views/staff/ReportsModule.tsx`

Scope
- Replace inline `style={{ ... }}` with shared classes in stylesheet (`web/src/App.css` and staff module styles where applicable).
- Prefer existing utility classes before adding new class names.
- Keep all UI behavior (layout, spacing, typography) unchanged.

Acceptance
- No JSX `style={{` instances in `web/src` except style hooks for generated/third-party payload objects if explicitly justified.
- New classes documented in CSS and covered by spot visual checks on affected views.
- Existing snapshots/build remain stable.

Notes
- This ticket is intended for dedicated portal style governance cleanup; keep scope independent from API hardening work.
