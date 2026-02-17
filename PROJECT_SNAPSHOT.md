# Project Snapshot (Repo State)

## 0) One-liner
- Monsoon Fire is a Firebase-backed ceramics studio platform: a React/Vite Portal for members/staff operations, Cloud Functions APIs, Firestore data/rules, plus a separate static marketing website; it also includes iOS/Android parity scaffolding and a ticket-driven delivery process.

## 1) Repo Map
- Root: `D:/monsoonfire-portal`
- Primary packages/apps:
  - `web` | `web/` | React 19 + Vite + TypeScript + Firebase Web SDK | Main Portal app (member + staff UI, tracker route gate via `/tracker`).
  - `functions` | `functions/` | Firebase Functions v2 + TypeScript + Node 22 | API/backend surface (portal ops, events, reports, agentic, Stripe, notifications).
  - `website` | `website/` | Static HTML/CSS/JS | Marketing/public site + policies/support pages.
  - `ios` | `ios/` | Swift/SwiftUI-style client files | Native parity work (runtime/build docs indicate partial/ongoing).
  - `ios-gate` | `ios-gate/` | Swift package gate | iOS CI smoke/build gate target.
  - `android` | `android/` | Android project | Android compile/deeplink/parity artifacts.
- Key infrastructure:
  - Auth: Firebase Auth (Google, email/password, email link, anonymous, OAuth provider hooks) + custom claims (`staff`, `roles[]`).
  - Database: Firestore (`firestore.rules`, `firestore.indexes.json`) + Storage rules.
  - Hosting/Deploy: Firebase Hosting for portal (`web/dist`) and Functions deploy via Firebase CLI; website appears separately hosted/static.
  - Payments: Stripe (Functions + webhook endpoints + staff Stripe settings module).
  - CI/CD: GitHub Actions (`ci-smoke`, hosting PR/merge deploys, lighthouse, Android compile, iOS gates).

## 2) Features (Current)
List implemented, user-visible features grouped by surface:
- Website:
  - Multi-page studio marketing site (services, policies, FAQ, support, supplies, memberships). Where: `website/`. Status: Implemented.
  - SEO/policy assets (`sitemap.xml`, payments-refunds policy pages). Where: `website/sitemap.xml`, `website/policies/`. Status: Implemented.
- Client Portal:
  - Auth entry + signed-out view with provider/email flows. Where: `web/src/App.tsx`, `web/src/views/SignedOutView.tsx`. Status: Implemented.
  - Dashboard + kiln rentals flow (ware check-in, queues, firings). Where: `web/src/views/DashboardView.tsx`, `ReservationsView.tsx`, `KilnLaunchView.tsx`, `KilnScheduleView.tsx`. Status: Implemented.
  - Studio resources (My Pieces, Glaze Board, Store, Membership, Billing, Requests). Where: `web/src/views/*`. Status: Implemented.
  - Community/workshops/lending/messages/notifications/support. Where: `web/src/views/CommunityView.tsx`, `EventsView.tsx`, `LendingLibraryView.tsx`, `MessagesView.tsx`, `NotificationsView.tsx`, `SupportView.tsx`. Status: Implemented.
  - Internal tracker app route split (`/tracker*` loads tracker shell). Where: `web/src/main.tsx`, `web/src/tracker/TrackerApp.tsx`. Status: Implemented.
- Staff/Admin:
  - Staff Console modules (members, pieces/batches, firings, events, lending, store/billing, system, stripe, policy/reports, agent ops). Where: `web/src/views/StaffView.tsx`, `web/src/views/staff/*`. Status: Implemented/Partial by module.
  - Community report triage/actions/appeals UI. Where: `web/src/views/staff/ReportsModule.tsx`. Status: Implemented.
  - Agent Ops controls (feature flags, review, audit views). Where: `web/src/views/staff/AgentOpsModule.tsx`. Status: Implemented/Active.
- Mobile (if any):
  - iOS parity views and contracts present; CI gate exists, runtime verification partially blocked by environment historically. Where: `ios/`, `ios-gate/`, docs/tickets. Status: Partial.
  - Android compile workflow + project present. Where: `android/`, `.github/workflows/android-compile.yml`. Status: Partial.
- Backend/Cloud Functions:
  - Core batch lifecycle endpoints (`createBatch`, `continueJourney`, kiln transitions, close, sync). Where: `functions/src/index.ts`. Status: Implemented.
  - Events + ticketing + event checkout + Stripe event webhook. Where: `functions/src/events.ts`. Status: Implemented.
  - Materials/store catalog + checkout + Stripe webhook. Where: `functions/src/materials.ts`. Status: Implemented.
  - Reporting moderation pipeline endpoints (create/list/triage/action/appeals + cleanup). Where: `functions/src/reports.ts`. Status: Implemented.
  - Agentic surface (api v1, integration tokens, delegations, catalog, ops). Where: `functions/src/apiV1.ts`, `integrationTokens.ts`, `agent*.ts`. Status: Implemented/Expanding.
  - Notification token and drill/aggregation jobs. Where: `functions/src/notifications.ts`. Status: Implemented.

## 3) Epics / Workstreams
- Alpha launch + cutover evidence
  - Goal: finalize production readiness evidence and hosted cutover checks.
  - Included features: drill scripts, auth/provider run logs, hosting checklist automation.
  - Key files/folders: `docs/EXTERNAL_CUTOVER_EXECUTION.md`, `scripts/run-external-cutover-checklist.ps1`, `tickets/P0-*`.
  - Open items / TODOs / blockers:
    - Real provider credential + hosted auth checks still tracked as tickets (`tickets/P1-prod-auth-oauth-provider-credentials.md`, `tickets/P0-alpha-drills-real-auth.md`).
- Auth + security hardening (v2 agentic)
  - Goal: harden identity/authz boundaries for Firebase users + PAT/delegated agent access.
  - Included features: authz helper, audit logs, delegation schema/workflows, stricter checks, app check flag support.
  - Key files/folders: `functions/src/authz.ts`, `functions/src/shared.ts`, `firestore.rules`, `docs/AUTH_V2_AGENTIC_IDENTITY_PLAN_2026-02-12.md`, `tickets/P1-v2-*`.
  - Open items / TODOs / blockers:
    - MFA/blocking-functions are roadmap tickets (`tickets/P2-v2-mfa-and-strong-auth-roadmap.md`, `tickets/P2-v2-auth-blocking-functions-roadmap.md`).
- Community trust & safety
  - Goal: report/triage/action pipeline with ops policy and auditability.
  - Included features: in-app report creation, staff triage, appeals, content actions, policy modules.
  - Key files/folders: `functions/src/reports.ts`, `web/src/views/staff/ReportsModule.tsx`, `docs/COMMUNITY_REPORTING_*`, `tickets/P1-community-reporting-*`.
  - Open items / TODOs / blockers:
    - Ongoing retention/ops policy refinements tracked (`tickets/P2-community-reporting-ops-policy-and-retention.md`).
- Agentic commerce / integrations
  - Goal: deterministic APIs for quote/reserve/pay/status and agent client governance.
  - Included features: API v1 routes, PAT/integration tokens, delegated tokens, agent service catalog, agent ops staff tools.
  - Key files/folders: `functions/src/apiV1.ts`, `functions/src/agentCatalog.ts`, `functions/src/agentClients.ts`, `functions/src/agentCommerce.ts`, `web/src/views/staff/AgentOpsModule.tsx`.
  - Open items / TODOs / blockers:
    - Risk engine / independent agent account maturity tickets remain (`tickets/P2-agent-risk-engine-fraud-velocity-and-manual-review.md`, `tickets/P2-agent-independent-accounts-prepay-and-limits.md`).
- Accessibility + UX hardening
  - Goal: WCAG baseline + regression guardrails for portal and website.
  - Included features: baseline docs, guardrails, smoke checks, ticketed remediation.
  - Key files/folders: `docs/PORTAL_ACCESSIBILITY_*`, `docs/WEBSITE_ACCESSIBILITY_*`, `tickets/P1-website-a11y-*`, `tickets/P1-portal-a11y-*`.
  - Open items / TODOs / blockers:
    - Continued QA cadence and remaining tickets (`tickets/P2-portal-a11y-regression-guardrails.md`, `tickets/P2-website-a11y-ongoing-qa-and-regression-guardrails.md`).

## 4) Data Model & Integrations
- Firestore/DB collections and key documents (best-effort, from rules + code):
  - Core: `batches`, `batches/{id}/pieces`, `timeline`, `profiles`, `reservations`, `kilnLaunchRequests`, `kilnFirings`, `kilns`, `firingsCalendarEvents`, `announcements`.
  - Messaging/support: `directMessages`, `messages`, `supportRequests`, `faqItems`.
  - Commerce/events/materials: `events`, `eventSignups`, `eventCharges`, `materialsProducts`, `materialsOrders`, `library*`.
  - Tracker: `trackerProjects`, `trackerEpics`, `trackerTickets`, `trackerIntegrationHealth`.
  - Safety/agent/audit: `communityReports`, `communityReportAppeals`, `communityFeedOverrides`, `communityReportAuditLogs`, `agentClients`, `delegations`, `auditEvents`, `securityAudit`, `integrationTokenAudit`, `rateLimits`, `delegatedTokenNonces`.
  - Evidence: `firestore.rules` match blocks.
- External services:
  - Stripe (checkout + webhooks + staff config). Where: `functions/src/stripeConfig.ts`, `functions/src/events.ts`, `functions/src/materials.ts`, `web/src/views/staff/StripeSettingsModule.tsx`.
  - GitHub lookup integration for tracker metadata. Where: `functions/src/index.ts` (`githubLookup`), tracker web UI.
  - Google Calendar sync for firings. Where: `functions/src/index.ts` (`debugCalendarId`, `acceptFiringsCalendar`, `syncFiringsNow`).
  - Firebase email extension configured. Where: `firebase.json` extensions block.
- Env vars (names only):
  - Web: `VITE_FUNCTIONS_BASE_URL`, `VITE_ENABLE_DEV_ADMIN_TOKEN`, `VITE_PERSIST_DEV_ADMIN_TOKEN`, `VITE_USE_EMULATORS`, `VITE_USE_AUTH_EMULATOR`, `VITE_USE_FIRESTORE_EMULATOR`, `VITE_AUTH_DOMAIN`, `VITE_AUTH_EMULATOR_HOST`, `VITE_AUTH_EMULATOR_PORT`, `VITE_FIRESTORE_EMULATOR_HOST`, `VITE_FIRESTORE_EMULATOR_PORT`, `VITE_STORAGE_EMULATOR_HOST`, `VITE_STORAGE_EMULATOR_PORT`, `VITE_REPO_BLOB_BASE_URL`.
  - Functions: `ALLOWED_ORIGINS`, `ALLOW_DEV_ADMIN_TOKEN`, `FUNCTIONS_EMULATOR`, `ADMIN_TOKEN`, `STRICT_TOKEN_REVOCATION_CHECK`, `ENFORCE_APPCHECK`, `ALLOW_APPCHECK_BYPASS_IN_EMULATOR`, `DELEGATED_AGENT_TOKEN_SECRET`, `DELEGATED_TOKEN_AUDIENCE`, `DELEGATED_TOKEN_MAX_AGE_MS`, `INTEGRATION_TOKEN_PEPPER`, `AGENT_CLIENT_KEY_PEPPER`, `AUTO_COOLDOWN_MINUTES`, `GOOGLE_CALENDAR_CREDENTIALS`, `GITHUB_LOOKUP_TOKEN`, `GITHUB_TOKEN`, `PORTAL_BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_PUBLIC_URL`, `GCLOUD_PROJECT`, `APNS_RELAY_URL`, `APNS_RELAY_KEY`.
  - Secret Manager Stripe params also present (`STRIPE_TEST_SECRET_KEY`, `STRIPE_LIVE_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_LIVE_WEBHOOK_SECRET`).

## 5) Security & Safety Posture (Repo Evidence)
- AuthN/AuthZ model:
  - Firebase bearer token required for protected functions (`requireAuthUid`), staff via custom claims (`staff` or `roles[]`). Evidence: `functions/src/shared.ts`.
  - Optional emulator-only dev admin header (`x-admin-token`) gated by `ALLOW_DEV_ADMIN_TOKEN` + emulator check. Evidence: `functions/src/shared.ts`, `AGENTS.md`.
  - Firestore rules enforce owner/staff boundaries across many collections. Evidence: `firestore.rules`.
- Rate limiting / abuse prevention:
  - Durable + in-memory rate limit logic in shared middleware (`enforceRateLimit`, `rateLimits` collection).
  - Community reporting dedupe + per-user/day limits + coordination signals.
  - Agent controls: cooldown/kill-switch/feature flags and security audit streams.
- Content policy/prohibited content:
  - Moderation policy versions + community safety blocked terms/hosts; staff scan endpoints and report workflows.
  - Docs/playbooks for trust/safety and incident handling.
- Known risky areas or missing guardrails (repo-evidenced):
  - Some roadmap-level hardening still open (MFA, blocking functions, broader rollout items) in `tickets/P2-v2-*`.
  - Current working tree includes local hardening changes not yet committed (`firestore.rules`, `functions/src/reports.ts`).

## 6) Developer Workflow
- How to run locally (commands):
  - Portal: `cd web && npm install && npm run dev`
  - Functions: `cd functions && npm install && npm run build`
  - Emulators: `firebase emulators:start --only firestore,functions,auth` (or configured subset).
- How to test:
  - Web lint: `npm --prefix web run lint`
  - Web tests: `npm --prefix web run test:run`
  - Functions tests: `npm --prefix functions test`
  - A11y smoke: `npm --prefix web run a11y:smoke`
- How to deploy:
  - Functions: `npm --prefix functions run deploy` (wrapper for Firebase deploy).
  - Hosting+Functions config in `firebase.json`; CI uses hosting deploy actions.
- Common gotchas (repo evidence):
  - Firestore rejects `undefined` values (`AGENTS.md`).
  - `continueJourney` requires `{ uid, fromBatchId }` (`AGENTS.md`, `functions/src/index.ts`).
  - Missing composite indexes can block queries (`AGENTS.md`, API contracts/tickets).
  - Emulator auth mismatch causes "Invalid Authorization token" fallback mode in several views (`web/src/views/StaffView.tsx`, `MaterialsView.tsx`).

## 7) Recent Activity Summary
- Last 10 commits (hash + subject):
  - `d2103e3b` ops(cutover): add one-command external execution checklist runner
  - `001e1cbe` ops(hosting): fix cutover verifier parsing and record DNS blocker
  - `86943614` ops(auth): add provider execution run log template helper
  - `5c7cf708` ops(hosting): expand cutover verifier with asset cache checks and report output
  - `9978bd61` ops(drills): add structured notification drill output and log capture
  - `00cf05f4` chore(tickets): mark v2 auth hardening slice completed
  - `d5d2ea22` security(rate-limit): add agent denial logging and optional auto-cooldown
  - `1fb17aa7` chore(tickets): normalize v2 auth ticket markdown
  - `e959669f` web(auth): make dev admin token persistence explicit opt-in
  - `dc988f3d` staff(auth): add security audit filters in agent ops
- Any uncommitted changes:
  - `firestore.rules` modified.
  - `functions/src/reports.ts` modified.
- Areas most actively modified:
  - Security/auth hardening, cutover runbooks/scripts, agent ops/authz, ticket synchronization and sprint docs.

## 8) Memory / Decisions Log (Repo-derived)
- Dev admin token is explicitly dev/emulator-only and should never be hardcoded; header is `x-admin-token`. evidence: `AGENTS.md`, `functions/src/shared.ts`.
- `continueJourney` contract requires `{ uid, fromBatchId }`; this is a known non-negotiable. evidence: `AGENTS.md`, `functions/src/index.ts`.
- Firestore `undefined` writes are a known foot-gun; omit or use null. evidence: `AGENTS.md`.
- Composite index failures are expected in some query patterns and should be surfaced, not hidden. evidence: `AGENTS.md`, `tickets/P1-agent-api-v1-contracts.md`.
- App has explicit no-blank-screen expectation with top-level ErrorBoundary/safety rails. evidence: `AGENTS.md`, `web/src/App.tsx` (`AppErrorBoundary`).
- Tracker markdown can be normalized/backfilled and synced into Firestore via scripts. evidence: `tickets/README.md`, `functions/scripts/syncTrackerTicketsFromMarkdown.js`.
- V2 auth hardening work is documented with tickets + implementation notes and feature flags. evidence: `docs/AUTH_V2_AGENTIC_IDENTITY_PLAN_2026-02-12.md`, `tickets/P1-v2-*`.

## 9) Open Questions
- Is `website/` deployed from this repo in CI/CD or via a separate external process? (Evidence suggests separate/static flow; exact production pipeline Unknown.)
- Which ticket files are fully shipped vs planning-only across all `P2/P3` agentic items? (Some include implemented notes, but global completion state is Unknown.)
- Production status of App Check enforcement (`ENFORCE_APPCHECK`) across all endpoints is flag-dependent; active production flag state is Unknown.
- Final iOS runtime parity status on real macOS/Xcode hardware is Unknown from repo-only evidence.

---
Scan notes:
- Large dependency trees (`node_modules`, generated `functions/lib`) were sampled/filtered where possible.
- Snapshot emphasizes source/docs/tickets and omits vendor package internals.
