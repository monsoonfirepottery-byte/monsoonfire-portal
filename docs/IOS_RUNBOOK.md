# iOS Runbook (Shell + Env Config)

Date: 2026-02-05  
Status: Active

## Scope
- Run the iOS shell scaffold and validate environment wiring for API calls.
- Uses files in `ios/`:
  - `MonsoonFirePortalApp.swift`
  - `PortalAppShell.swift`
  - `PortalEnvironment.swift`
  - `PortalApiClient.swift`
  - `PortalContracts.swift`
  - `HandlerErrorLogStore.swift`
  - `ReservationsCheckInView.swift`
  - `ReservationPhotoUploader.swift`
  - `MyPiecesView.swift`
  - `KilnScheduleView.swift`
  - `EventsView.swift`
  - `MaterialsView.swift`
  - `BillingView.swift`
  - `AuthSessionManager.swift`
  - `PushNotificationManager.swift`

## Prerequisites
- Xcode 15+
- iOS 15+ simulator target
- Optional admin token for admin-gated endpoints
- Firebase Auth SDK linked for session-based mode (manual token fallback still available)

## Setup
1. Create/open an iOS app target and include all files in `ios/`.
2. Ensure deployment target is iOS 15 or later.
3. Navigation policy:
   - iOS 16+: `NavigationStack` (primary path).
   - iOS 15: `NavigationView` compatibility fallback.
4. Build and run the app.
5. Use in-app Auth controls first to establish session and token.
6. Use manual token fallback only when Firebase Auth SDK/session is unavailable.

## Environment Routing
- `Production`: `https://us-central1-monsoonfire-portal.cloudfunctions.net`
- `Emulator`: `http://127.0.0.1:5001/monsoonfire-portal/us-central1`
- `Custom`: user-supplied base URL

## Smoke Test Flow
1. Launch app and select environment.
2. In Auth section, sign in (anonymous or email/password/magic-link).
3. Confirm Access state shows signed-in.
4. (Optional) Paste admin token for staff-gated flows.
5. Run **createBatch smoke test**.
6. Confirm status output is success or actionable error.
7. Run smoke test with an invalid token once and confirm the entry appears in **Handler Error Log**.
8. Tap **Clear log** and confirm the handler log list is empty.
9. Open reservation check-in form, select a supported image (`jpg`, `jpeg`, `png`, `heic`, `webp`) and submit.
10. Confirm successful submit includes `photoUrl`/`photoPath` in request metadata.
11. Repeat with an invalid/oversized file and confirm submit is blocked with an upload error.
12. Open kiln schedule, run load, and verify kilns/firings list renders.
13. Verify staff unload button remains disabled when admin token/role is absent.
14. With staff access + valid staff UID, mark a firing unloaded and verify status updates.
15. Open events, run load, and verify list + detail render.
16. Run signup on a selectable event and verify signup status updates.
17. Run cancel signup and verify signup status clears or transitions to cancelled.
18. With admin token present, load staff roster and verify entries render.
19. Use roster filter/search and include-cancelled/expired toggles; verify visible rows update.
20. Staff check-in a `ticketed` attendee and verify status updates to checked-in and unpaid marker is visible when payment status is not paid.
21. Open materials, load catalog, add quantities, and create checkout session.
22. Verify checkout URL is returned and opens via **Open checkout**.
23. Verify checkout is blocked when cart is empty.
24. Open billing, load summary, and verify unpaid check-ins/material orders/receipts render.
25. Verify empty-state status messaging when no billing activity exists.
26. In shell Auth section, verify signed-out/signed-in transitions update.
27. Verify auth-derived ID token is used by smoke action without manual paste.
28. Verify manual token fallback still works when session token is unavailable.
29. In Notifications section, request permission and verify status transitions.
30. Refresh notification status and verify displayed authorization value matches OS settings.
31. Capture APNs token text and verify token is stored in shell status.
32. Tap **Submit device token to backend** and verify success status + token hash are shown.
33. Toggle offline mode, capture a token, verify it remains in pending queue, then go online and confirm auto-submit succeeds.
34. Tap **Unregister device token** and verify local token state clears with success status.
35. In Auth section, test email/password sign-in flow and verify signed-in session state.
36. Send a magic link, paste link URL into shell, complete sign-in, and verify session state.
37. Trigger callback deep links with `status=success` and `status=cancel`, verify callback status appears in shell.
38. Verify event callbacks route into Events and checkout/material callbacks route into Materials.

## Verification Checklist
1. Shell launches and navigation renders.
2. Environment picker changes resolved base URL.
3. Auth fields update config and are used in request.
4. `createBatch` smoke test returns response or structured failure text.
5. Handler error log records failures under `mf_handler_error_log_v1`.
6. Handler error log clear operation empties persisted entries.
7. Photo upload success path stores and submits `photoUrl` and `photoPath`.
8. Photo upload failure path does not submit a broken reservation payload.
9. Kiln schedule list loads without runtime errors.
10. Staff unload action writes `unloadedAt` and `unloadedByUid` on selected firing.
11. Non-staff cannot trigger unload action.
12. Events list/detail/signup/cancel flows execute without runtime errors.
13. Events staff roster + staff check-in flows execute without runtime errors.
14. Materials catalog/cart/checkout session flow executes without runtime errors.
15. Billing summary flow executes without runtime errors.
16. Auth session state and token refresh flows execute without runtime errors.
17. Notification permission/status flow executes without runtime errors.
18. Email/password and magic-link auth flows execute without runtime errors.
19. Route/role gating prevents signed-out users from write-capable screens/actions.
20. Device token capture hook executes without runtime errors.
21. Deep-link callback parser handles success, cancel, and unknown states without crashes.
22. Deep-link callback routing opens the expected screen when target is inferred.
23. Device token unregister flow deactivates token and clears local shell state.

## Notes
- This shell is intentionally minimal and acts as a migration scaffold.
- Keep contracts synced from `web/src/api/portalContracts.ts`.

## Auth Troubleshooting
- If FirebaseAuth SDK is not linked, shell will remain in manual token mode.
- If magic link completion fails, ensure the pasted URL is a valid Firebase email sign-in link.
- If signed-in state exists but API fails with auth errors, use **Refresh token** then retry.
