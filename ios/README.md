# Monsoon Fire Portal — iOS API Layer

This directory contains the iOS reference implementation for the Monsoon Fire Portal backend.

Status:
- PortalContracts.swift ✅ (canonical Swift mirror of web/src/api/portalContracts.ts)
- PortalApiClient.swift ✅ (HTTP client parity with web/src/api/portalApi.ts)
- PortalModels.swift ✅ (domain-only models, non-API)
- Materials contracts ✅ (catalog + checkout endpoints mirrored in contracts)

## How this is used

- Cloud Functions are called via raw HTTP POST (not Firebase callable functions)
- Auth is provided via Firebase ID token:
  - Header: `Authorization: Bearer <ID_TOKEN>`
- Admin-gated calls require:
  - Header: `x-admin-token: <ADMIN_TOKEN>` (dev only)

## Emulator configuration

Base URL: http://127.0.0.1:5001/monsoonfire-portal/us-central1

Requirements:
- Functions emulator running
- Emulator process must have `ADMIN_TOKEN` set
- Emulator must be restarted after setting env vars

## First test when on macOS

1. Open Xcode
2. Create new iOS App (SwiftUI)
3. Copy:
   - PortalContracts.swift
   - PortalApiClient.swift
   - PortalModels.swift (optional)
4. Add Firebase Auth
5. Obtain `idToken`
6. Call:

```swift
let api = PortalApiClient(config: .init(baseUrl: BASE_URL))
try await api.createBatch(...)
```

## Materials & supplies parity (pending UI)

- Implement catalog browsing + cart + checkout on iOS using:
  - `listMaterialsProducts`
  - `createMaterialsCheckoutSession`
- Handle `/materials?status=success|cancel` deep links.

## Android parity

Android reference code lives in this repo under `android/` for parity with iOS.
