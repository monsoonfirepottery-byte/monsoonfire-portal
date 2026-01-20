# Monsoon Fire Portal — iOS API Layer

This directory contains the iOS reference implementation for the Monsoon Fire Portal backend.

Status:
- PortalContracts.swift ✅
- PortalApiClient.swift ✅
- Matches web/src/api/portalContracts.ts and portalApi.ts exactly

## How this is used

- Cloud Functions are called via raw HTTP POST (not Firebase callable functions)
- Auth is provided via Firebase ID token:
  - Header: `Authorization: Bearer <ID_TOKEN>`
- Admin-gated calls require:
  - Header: `x-admin-token: <ADMIN_TOKEN>` (dev only)

## Emulator configuration

Base URL:http://127.0.0.1:5001/monsoonfire-portal/us-central1

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
4. Add Firebase Auth
5. Obtain `idToken`
6. Call:

```swift
let api = PortalApiClient(config: .init(baseUrl: BASE_URL))
try await api.createBatch(...)
