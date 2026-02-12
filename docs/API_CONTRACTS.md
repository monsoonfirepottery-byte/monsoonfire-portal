# Monsoon Fire Portal — API Contracts (Web + iOS Reference)

This doc is the single “how do I call the backend” reference for Monsoon Fire Portal clients.

Source of truth for shapes/types:
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts` (HTTP client behavior + meta/troubleshooting)
- Native mirrors:
  - iOS: `ios/PortalContracts.swift`, `ios/PortalApiClient.swift`
  - Android: `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`, `android/app/src/main/java/com/monsoonfire/portal/reference/PortalApiClient.kt`

## Contract sync strategy (manual for now)

1. Update `web/src/api/portalContracts.ts` first (canonical).
2. Mirror changes in:
   - `ios/PortalContracts.swift` (+ `PortalApiClient.swift` if new endpoints)
   - `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`
3. Update `docs/API_CONTRACTS.md` if endpoints or payloads change.

Decision: auto-generation is deferred; manual sync keeps changes explicit for now.

---

## Environments

### Production (deployed Cloud Functions)
Base URL:
- `https://us-central1-monsoonfire-portal.cloudfunctions.net`

Example endpoint:
- `${BASE_URL}/createBatch`

### createReservation

POST `${BASE_URL}/createReservation`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CreateReservationRequest`):
```json
{
  "ownerUid": "uid_123 (staff-only, optional)",
  "wareType": "stoneware",
  "kilnId": "studio-electric",
  "kilnLabel": "Studio kiln (electric)",
  "quantityTier": "small",
  "quantityLabel": "Small batch",
  "dropOffQuantity": {
    "id": "small",
    "label": "Small batch",
    "pieceRange": "4–8 pieces"
  },
  "dropOffProfile": {
    "id": "many-stackable-bisque",
    "label": "Many flat pieces (bisque stack)",
    "pieceCount": "many",
    "hasTall": false,
    "stackable": true,
    "bisqueOnly": true,
    "specialHandling": false
  },
  "photoUrl": "https://firebasestorage.googleapis.com/v0/b/.../checkins/uid_123/req_8f9d1c3b/work.jpg",
  "photoPath": "checkins/uid_123/req_8f9d1c3b/work.jpg",
  "notes": {
    "general": "Please keep these together.",
    "clayBody": "B-mix",
    "glazeNotes": "Clear glaze on rim"
  },
  "addOns": {
    "rushRequested": false,
    "wholeKilnRequested": false
  },
  "firingType": "glaze",
  "shelfEquivalent": 0.5,
  "preferredWindow": {
    "earliestDate": "2026-02-09T10:00:00.000Z",
    "latestDate": "2026-02-11T22:30:00.000Z"
  },
  "linkedBatchId": null,
  "clientRequestId": "req_8f9d1c3b"
}
```

Response:
```json
{
  "ok": true,
  "reservationId": "abc123",
  "status": "REQUESTED"
}
```

`createReservation` verifies the ID token, trims the shelf equivalent to quarter/half/full values, validates that earliest ≤ latest, and writes the `reservations/{id}` document with `preferredWindow` timestamps plus `createdAt/updatedAt`. If `ownerUid` is supplied, it must be a staff-authenticated call. Reuse the same `clientRequestId` on retries to avoid duplicate submissions.

### Local emulator (Firebase Functions emulator)
Base URL:
- `http://127.0.0.1:5001/monsoonfire-portal/us-central1`

Example endpoint:
- `${BASE_URL}/createBatch`

Client selection:
- Web app uses `VITE_FUNCTIONS_BASE_URL` if set; otherwise falls back to prod default.
- App UI shows an **Emulator / Prod** badge derived from the base URL.

Important:
- Vite reads env vars at startup. If you change `VITE_FUNCTIONS_BASE_URL`, restart `npm run dev`.

---

## Authentication & headers

All function calls are **HTTP POST** with JSON.

Required headers:
- `Content-Type: application/json`
- `Authorization: Bearer <FIREBASE_ID_TOKEN>`

Dev-only admin header (required for admin-gated endpoints):
- `x-admin-token: <ADMIN_TOKEN>`

Notes:
- Never paste real `Authorization` tokens into chat/logs. Treat them as credentials.
- The web UI only shows the dev admin token input when `VITE_ENABLE_DEV_ADMIN_TOKEN=true` and the functions base URL is localhost; it stores the token in sessionStorage for that browser session only.
- Stripe webhook endpoints are verified via Stripe signature headers and **do not** use Firebase ID tokens.

---

## Integration tokens (PATs) for agents

Portal UI and native clients should keep using Firebase ID tokens.

For agentic / non-interactive workflows, the backend supports **Integration Tokens** (personal access tokens, PATs).

Token format:
- `mf_pat_v1.<tokenId>.<secret>`

Usage:
- Send as `Authorization: Bearer <PAT>`

Security properties:
- The token `secret` is only shown once on creation.
- The server stores only a hash (`secretHash`), never the plaintext secret.
- Tokens are scoped and revocable.

Required Functions runtime config:
- `INTEGRATION_TOKEN_PEPPER` (a long random secret used to hash PAT secrets; configure via Firebase Secrets in prod, and via `functions/.env.local` in the emulator)

### createIntegrationToken

POST `${BASE_URL}/createIntegrationToken`

Auth:
- Firebase ID token (interactive)

Request:
```json
{
  "label": "My assistant (optional)",
  "scopes": ["batches:read", "timeline:read", "firings:read", "events:read"]
}
```

Response:
```json
{
  "ok": true,
  "tokenId": "base64url...",
  "token": "mf_pat_v1.<tokenId>.<secret>",
  "record": { "tokenId": "...", "label": "...", "scopes": ["..."] }
}
```

### listIntegrationTokens

POST `${BASE_URL}/listIntegrationTokens`

Auth:
- Firebase ID token

Response:
```json
{
  "ok": true,
  "tokens": [
    {
      "tokenId": "base64url...",
      "label": "My assistant",
      "scopes": ["events:read"],
      "createdAt": "...",
      "lastUsedAt": null,
      "revokedAt": null
    }
  ]
}
```

### revokeIntegrationToken

POST `${BASE_URL}/revokeIntegrationToken`

Auth:
- Firebase ID token

Request:
```json
{ "tokenId": "base64url..." }
```

Response:
```json
{ "ok": true }
```

### helloPat (debug)

POST `${BASE_URL}/helloPat`

Auth:
- Firebase ID token OR PAT

Response:
```json
{ "ok": true, "uid": "uid_123", "mode": "firebase|pat", "scopes": ["..."] }
```

---

## Agent API v1 (JSON envelope + scopes)

Base URL:
- `${BASE_URL}/apiV1`

All v1 responses use:
- Success: `{ ok: true, requestId, data }`
- Error: `{ ok: false, requestId, code, message, details }`

If calling with a PAT, required scopes are enforced per endpoint.

### v1/hello

POST `${BASE_URL}/apiV1/v1/hello`

Auth:
- Firebase ID token OR PAT

Response:
```json
{ "ok": true, "requestId": "req_...", "data": { "uid": "uid_123", "mode": "pat", "scopes": ["..."] } }
```

### v1/events.feed

POST `${BASE_URL}/apiV1/v1/events.feed`

Auth:
- Firebase ID token OR PAT with scope `events:read`

Request:
```json
{ "uid": "uid_123 (optional, defaults to caller uid)", "cursor": 0, "limit": 100 }
```

Response:
```json
{
  "ok": true,
  "requestId": "req_...",
  "data": {
    "uid": "uid_123",
    "events": [{ "id": "evt", "cursor": 1, "type": "batch.updated", "subject": { "batchId": "..." } }],
    "nextCursor": 1
  }
}
```

### v1/batches.list

POST `${BASE_URL}/apiV1/v1/batches.list`

Auth:
- Firebase ID token OR PAT with scope `batches:read`

Request:
```json
{ "ownerUid": "uid_123 (optional)", "limit": 50, "includeClosed": true }
```

### v1/batches.get

POST `${BASE_URL}/apiV1/v1/batches.get`

Auth:
- Firebase ID token OR PAT with scope `batches:read`

Request:
```json
{ "batchId": "batch_123" }
```

### v1/batches.timeline.list

POST `${BASE_URL}/apiV1/v1/batches.timeline.list`

Auth:
- Firebase ID token OR PAT with scope `timeline:read`

Request:
```json
{ "batchId": "batch_123", "limit": 200 }
```

### v1/firings.listUpcoming

POST `${BASE_URL}/apiV1/v1/firings.listUpcoming`

Auth:
- Firebase ID token OR PAT with scope `firings:read`

Request:
```json
{ "limit": 200 }
```

---

## Emulator admin token requirement

When using the Functions emulator, admin-gated endpoints also require the emulator to have a configured token to compare against.

Symptom:
- `401` with `{ ok: false, message: "ADMIN_TOKEN not configured" }`

Fix:
- Ensure the emulator process has an environment variable set:
  - `ADMIN_TOKEN=<your_dev_admin_token>`
  - `ALLOW_DEV_ADMIN_TOKEN=true`
- Then restart the emulator (env vars are read at process start).

PowerShell example:
- `$env:ADMIN_TOKEN="..."; firebase emulators:start --only functions`

bash example:
- `ADMIN_TOKEN="..." firebase emulators:start --only functions`

---

## Functions

### createBatch

POST `${BASE_URL}/createBatch`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>` (if endpoint is admin-gated)

Request body (`CreateBatchRequest`):
```json
{
  "ownerUid": "string",
  "ownerDisplayName": "string",
  "title": "string",
  "intakeMode": "string",
  "estimatedCostCents": 2500,
  "kilnName": null,
  "notes": null,
  "clientRequestId": "req_8f9d1c3b"
}
```

---

### registerDeviceToken

POST `${BASE_URL}/registerDeviceToken`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`RegisterDeviceTokenRequest`):
```json
{
  "token": "<APNS_HEX_TOKEN>",
  "platform": "ios",
  "environment": "production",
  "appVersion": "1.0.0",
  "appBuild": "1",
  "deviceModel": "iPhone"
}
```

Response (`RegisterDeviceTokenResponse`):
```json
{
  "ok": true,
  "uid": "uid_123",
  "tokenHash": "sha256hex..."
}
```

Persistence contract:
- Function enforces Firebase auth (`401` + `code: UNAUTHENTICATED` without valid bearer token).
- Writes idempotently to `users/{uid}/deviceTokens/{tokenHash}`.
- Keeps first `createdAt` and updates `updatedAt` on re-registration.
- Stores metadata: `platform`, `environment`, `appVersion`, `appBuild`, `deviceModel`.

---

### unregisterDeviceToken

POST `${BASE_URL}/unregisterDeviceToken`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`UnregisterDeviceTokenRequest`):
```json
{
  "tokenHash": "sha256hex..."
}
```

Response (`UnregisterDeviceTokenResponse`):
```json
{
  "ok": true,
  "uid": "uid_123",
  "tokenHash": "sha256hex..."
}
```

Behavior:
- Authenticated user can deactivate only their own token record.
- Accepts either raw token (`token`) or precomputed hash (`tokenHash`).
- Sets `active=false`, `deactivatedAt`, and `updatedAt`.

---

### Push delivery telemetry + cleanup

Notification jobs with `channels.push=true` now write push delivery attempt telemetry to:
- `notificationDeliveryAttempts/{attemptId}`

Current provider state:
- Push delivery uses an APNs relay adapter when configured.
- Relay configuration env vars:
  - `APNS_RELAY_URL`
  - `APNS_RELAY_KEY`
- Attempts are recorded with statuses and reasons such as:
  - `NO_ACTIVE_DEVICE_TOKENS`
  - `PUSH_PROVIDER_SENT`
  - `PUSH_PROVIDER_PARTIAL`
  - `APNS relay failed: ...`

Token invalidation:
- Provider rejection codes `BadDeviceToken`, `Unregistered`, and `Device_Token_Not_For_Topic`
  trigger token deactivation with `deactivationReason` set to the provider code.

Scheduled cleanup:
- `cleanupStaleDeviceTokens` runs daily and deactivates device tokens with:
  - `active=true`
  - `updatedAt` older than 90 days

Reliability controls:
- Notification job processing now classifies failures into:
  - `auth`
  - `provider_4xx`
  - `provider_5xx`
  - `network`
  - `unknown`
- Retryable classes (`provider_5xx`, `network`, `unknown`) are re-queued with exponential backoff.
- Max attempts: 5. Exhausted or non-retryable failures are written to:
  - `notificationJobDeadLetters/{jobId}`

Aggregate metrics:
- `aggregateNotificationDeliveryMetrics` runs every 30 minutes.
- Writes 24-hour aggregate snapshot to:
  - `notificationMetrics/delivery_24h`
- Snapshot includes:
  - `totalAttempts`
  - `statusCounts`
  - `reasonCounts`
  - `providerCounts`
- Staff-gated manual trigger endpoint:
  - `POST ${BASE_URL}/runNotificationMetricsAggregationNow`

Drill endpoints (staff-gated):
- `POST ${BASE_URL}/runNotificationFailureDrill`
  - body: `{ uid, mode, channels?, forceRunNow? }`
  - `mode`: `auth | provider_4xx | provider_5xx | network | success`
  - queues deterministic drill jobs for retry/dead-letter validation.
- `POST ${BASE_URL}/runNotificationMetricsAggregationNow`
  - triggers immediate 24h metrics snapshot refresh.

Secret management:
- Push relay key is read from runtime environment variable `APNS_RELAY_KEY`.
- Configure it in deploy environment and emulator `.env` before running push relay sends.

---

## Materials + Supplies (Stripe Checkout)

### listMaterialsProducts

POST `${BASE_URL}/listMaterialsProducts`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`ListMaterialsProductsRequest`):
```json
{
  "includeInactive": false
}
```

Response (`ListMaterialsProductsResponse`):
```json
{
  "ok": true,
  "products": [
    {
      "id": "laguna-bmix-5-25",
      "name": "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
      "description": "Smooth, white body for mid-fire porcelain-style work.",
      "category": "Clays",
      "sku": "LAGUNA_BMIX_5_25",
      "priceCents": 4000,
      "currency": "USD",
      "stripePriceId": null,
      "imageUrl": null,
      "trackInventory": true,
      "inventoryOnHand": 40,
      "inventoryReserved": 0,
      "inventoryAvailable": 40,
      "active": true
    }
  ]
}
```

### createMaterialsCheckoutSession

POST `${BASE_URL}/createMaterialsCheckoutSession`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CreateMaterialsCheckoutSessionRequest`):
```json
{
  "items": [
    { "productId": "laguna-bmix-5-25", "quantity": 2 },
    { "productId": "day-pass", "quantity": 1 }
  ],
  "pickupNotes": "Pickup Friday afternoon."
}
```

Response (`CreateMaterialsCheckoutSessionResponse`):
```json
{
  "ok": true,
  "orderId": "abc123",
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

Notes:
- Uses Stripe hosted Checkout with `automatic_tax: { enabled: true }`.
- Pickup-only flow (no shipping).
- Inventory is enforced per product if `trackInventory` is true.

### seedMaterialsCatalog (admin-only)

POST `${BASE_URL}/seedMaterialsCatalog`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`
- `Content-Type: application/json`

Request body (`SeedMaterialsCatalogRequest`):
```json
{
  "force": false
}
```

Response (`SeedMaterialsCatalogResponse`):
```json
{
  "ok": true,
  "created": 6,
  "updated": 2,
  "total": 8
}
```

### stripeWebhook (Stripe-only)

POST `${BASE_URL}/stripeWebhook`

Headers:
- `Stripe-Signature: <signature>`

Notes:
- Validates the Stripe webhook signature with `STRIPE_WEBHOOK_SECRET`.
- On `checkout.session.completed`, marks the order `paid` and decrements tracked inventory.

---

## Events (Attendance-only billing)

Notes:
- Single ticket type per event.
- Waitlist auto-promotion uses a 12-hour claim window.
- Attendees can cancel up to 3 hours before event start.
- Add-ons are selectable only at check-in.
- Charges are created only when the attendee checks in.
- Never write `undefined` into Firestore; omit fields or use `null`.

### listEvents

POST `${BASE_URL}/listEvents`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`ListEventsRequest`):
```json
{
  "includeDrafts": false,
  "includeCancelled": false
}
```

Response (`ListEventsResponse`):
```json
{
  "ok": true,
  "events": [
    {
      "id": "event_123",
      "title": "Raku Night",
      "summary": "Live-fire glazing plus snacks.",
      "startAt": "2026-03-14T01:00:00.000Z",
      "endAt": "2026-03-14T04:00:00.000Z",
      "timezone": "America/Phoenix",
      "location": "Monsoon Fire Studio",
      "priceCents": 8500,
      "currency": "USD",
      "includesFiring": true,
      "firingDetails": "Raku firing included.",
      "capacity": 20,
      "waitlistEnabled": true,
      "status": "published",
      "remainingCapacity": 4
    }
  ]
}
```

### listEventSignups (admin-only)

POST `${BASE_URL}/listEventSignups`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`
- `Content-Type: application/json`

Request body (`ListEventSignupsRequest`):
```json
{
  "eventId": "event_123",
  "includeCancelled": false,
  "includeExpired": false,
  "limit": 300
}
```

Response (`ListEventSignupsResponse`):
```json
{
  "ok": true,
  "signups": [
    {
      "id": "signup_1",
      "uid": "uid_123",
      "displayName": "Sam Lee",
      "email": "sam@example.com",
      "status": "ticketed",
      "paymentStatus": "unpaid",
      "createdAt": "2026-03-01T18:12:00.000Z",
      "offerExpiresAt": null,
      "checkedInAt": null,
      "checkInMethod": null
    }
  ]
}
```

Notes:
- Staff uses this roster to check attendees in quickly.
- Rows with `status == "checked_in"` and `paymentStatus != "paid"` should be flagged as UNPAID.
- Local testing: seed sample events with `node functions/scripts/seedEvents.js` (writes to Firestore emulator by default).


### getEvent

POST `${BASE_URL}/getEvent`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`GetEventRequest`):
```json
{
  "eventId": "event_123"
}
```

Response (`GetEventResponse`):
```json
{
  "ok": true,
  "event": {
    "id": "event_123",
    "title": "Raku Night",
    "summary": "Live-fire glazing plus snacks.",
    "description": "A hands-on raku firing night.",
    "startAt": "2026-03-14T01:00:00.000Z",
    "endAt": "2026-03-14T04:00:00.000Z",
    "timezone": "America/Phoenix",
    "location": "Monsoon Fire Studio",
    "priceCents": 8500,
    "currency": "USD",
    "includesFiring": true,
    "firingDetails": "Raku firing included.",
    "policyCopy": "You won’t be charged unless you attend. If plans change, no worries—cancel anytime up to 3 hours before the event.",
    "addOns": [
      { "id": "extra-clay", "title": "Extra Clay", "priceCents": 1500, "isActive": true }
    ],
    "capacity": 20,
    "waitlistEnabled": true,
    "offerClaimWindowHours": 12,
    "cancelCutoffHours": 3,
    "status": "published"
  },
  "signup": {
    "id": "signup_1",
    "status": "ticketed",
    "paymentStatus": "unpaid"
  }
}
```

### createEvent (admin-only)

POST `${BASE_URL}/createEvent`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`
- `Content-Type: application/json`

Request body (`CreateEventRequest`):
```json
{
  "templateId": "template_raku_night",
  "title": "Raku Night",
  "summary": "Live-fire glazing plus snacks.",
  "description": "A hands-on raku firing night.",
  "location": "Monsoon Fire Studio",
  "timezone": "America/Phoenix",
  "startAt": "2026-03-14T01:00:00.000Z",
  "endAt": "2026-03-14T04:00:00.000Z",
  "capacity": 20,
  "priceCents": 8500,
  "currency": "USD",
  "includesFiring": true,
  "firingDetails": "Raku firing included.",
  "policyCopy": "You won’t be charged unless you attend. If plans change, no worries—cancel anytime up to 3 hours before the event.",
  "addOns": [
    { "id": "extra-clay", "title": "Extra Clay", "priceCents": 1500, "isActive": true }
  ],
  "waitlistEnabled": true,
  "offerClaimWindowHours": 12,
  "cancelCutoffHours": 3
}
```

Response (`CreateEventResponse`):
```json
{
  "ok": true,
  "eventId": "event_123"
}
```

### publishEvent (admin-only)

POST `${BASE_URL}/publishEvent`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>`
- `Content-Type: application/json`

Request body (`PublishEventRequest`):
```json
{
  "eventId": "event_123"
}
```

Response (`PublishEventResponse`):
```json
{
  "ok": true,
  "status": "published"
}
```

### signupForEvent

POST `${BASE_URL}/signupForEvent`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`SignupForEventRequest`):
```json
{
  "eventId": "event_123"
}
```

Response (`SignupForEventResponse`):
```json
{
  "ok": true,
  "signupId": "signup_1",
  "status": "ticketed"
}
```

### cancelEventSignup

POST `${BASE_URL}/cancelEventSignup`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CancelEventSignupRequest`):
```json
{
  "signupId": "signup_1"
}
```

Response (`CancelEventSignupResponse`):
```json
{
  "ok": true,
  "status": "cancelled"
}
```

Notes:
- Cancellation allowed until 3 hours before `event.startAt`.
- Server enforces cutoff and returns an error if the window has passed.

### claimEventOffer

POST `${BASE_URL}/claimEventOffer`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`ClaimEventOfferRequest`):
```json
{
  "signupId": "signup_1"
}
```

Response (`ClaimEventOfferResponse`):
```json
{
  "ok": true,
  "status": "ticketed"
}
```

Notes:
- Offer claim window is 12 hours from `offerExpiresAt`.

### checkInEvent

POST `${BASE_URL}/checkInEvent`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CheckInEventRequest`):
```json
{
  "signupId": "signup_1",
  "method": "self"
}
```

Response (`CheckInEventResponse`):
```json
{
  "ok": true,
  "status": "checked_in",
  "paymentStatus": "unpaid"
}
```

Notes:
- Staff check-in uses `method: "staff"` and includes `checkedInByUid` server-side.
- Check-in does not require payment to complete; staff UI should show unpaid status.
- Staff check-in currently requires `x-admin-token` until staff roles are enforced server-side.

### createEventCheckoutSession

POST `${BASE_URL}/createEventCheckoutSession`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CreateEventCheckoutSessionRequest`):
```json
{
  "eventId": "event_123",
  "signupId": "signup_1",
  "addOnIds": ["extra-clay"]
}
```

Response (`CreateEventCheckoutSessionResponse`):
```json
{
  "ok": true,
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

Notes:
- Requires `eventSignups.status == "checked_in"` and `paymentStatus == "unpaid"`.
- Base ticket price + selected add-ons are charged.

### eventStripeWebhook (Stripe-only)

POST `${BASE_URL}/eventStripeWebhook`

Headers:
- `Stripe-Signature: <signature>`

Notes:
- Validates the Stripe webhook signature with `STRIPE_WEBHOOK_SECRET`.
- On `checkout.session.completed`, marks the signup `paymentStatus` as `paid` and writes a receipt.


## Billing (planned)

Notes:
- No dedicated billing endpoints yet.
- Billing page will aggregate `materialsOrders`, `eventSignups`, and `eventCharges`.
- If Firestore rules remain strict, add `listBillingSummary` as a new HTTP function and mirror the contract in iOS/Android.

### listBillingSummary

POST `${BASE_URL}/listBillingSummary`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`ListBillingSummaryRequest`):
```json
{
  "limit": 25,
  "from": "2026-01-01T00:00:00.000Z",
  "to": "2026-02-01T00:00:00.000Z"
}
```

Response (`BillingSummaryResponse`):
```json
{
  "ok": true,
  "unpaidCheckIns": [
    {
      "signupId": "signup_abc",
      "eventId": "event_123",
      "eventTitle": "Raku Night",
      "status": "checked_in",
      "paymentStatus": "unpaid",
      "amountCents": 8500,
      "currency": "USD",
      "checkedInAt": "2026-03-14T02:15:00.000Z",
      "createdAt": "2026-03-01T18:12:00.000Z"
    }
  ],
  "materialsOrders": [
    {
      "id": "order_xyz",
      "status": "checkout_pending",
      "totalCents": 4000,
      "currency": "USD",
      "pickupNotes": "Pickup Friday",
      "createdAt": "2026-03-01T09:00:00.000Z",
      "updatedAt": "2026-03-01T09:00:00.000Z",
      "items": [
        {
          "productId": "laguna-bmix-5-25",
          "name": "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
          "quantity": 1,
          "unitPrice": 4000,
          "currency": "USD"
        }
      ]
    }
  ],
  "receipts": [
    {
      "id": "charge_789",
      "type": "event",
      "sourceId": "signup_abc",
      "title": "Raku Night",
      "amountCents": 8500,
      "currency": "USD",
      "paidAt": "2026-03-14T04:00:00.000Z"
    }
  ],
  "summary": {
    "unpaidCheckInsCount": 1,
    "unpaidCheckInsAmountCents": 8500,
    "materialsPendingCount": 1,
    "materialsPendingAmountCents": 4000,
    "receiptsCount": 1,
    "receiptsAmountCents": 8500
  }
}
```

Notes:
- Consolidates unpaid event check-ins + pending materials orders + paid receipts.
- Clients can use the arrays to populate the billing overview, unpaid grid, and receipts timeline.
- Optional `from`/`to` filters are best-effort and applied in-memory (invalid dates are ignored).

---

## Stripe config (Functions env vars)

Set these environment variables for the Functions runtime:

- `STRIPE_SECRET_KEY` — Stripe secret key for API calls.
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret.
- `PORTAL_BASE_URL` — base URL for success/cancel redirects (ex: `https://monsoonfire.com`).
