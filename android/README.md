# Monsoon Fire Portal — Android API Layer (Reference)

This folder provides a **reference Android client** for the Monsoon Fire Portal HTTP Cloud Functions.
A minimal Gradle project is included for compile checks.

Status:
- PortalContracts.kt ✅ (canonical Kotlin mirror of web/src/api/portalContracts.ts)
- PortalApiClient.kt ✅ (OkHttp client parity + troubleshooting meta)
- PortalModels.kt ✅ (domain-only models)
- Materials contracts ✅ (catalog + checkout endpoints mirrored in contracts)

## Project layout

- Gradle root: `android/`
- App module: `android/app/`
- Kotlin sources: `android/app/src/main/java/com/monsoonfire/portal/reference/`

## Dependencies (app-level)

Managed in `android/app/build.gradle.kts`:
- OkHttp (HTTP client)
- Kotlinx Serialization (JSON)

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

## Compile check (no device required)

PowerShell (Windows):

```powershell
cd android
./gradlew.bat :app:compileDebugKotlin
```

bash/zsh (macOS/Linux):

```bash
cd android
./gradlew :app:compileDebugKotlin
```

## Materials & supplies parity (pending UI)

- Implement catalog browsing + cart + checkout on Android using:
  - `listMaterialsProducts`
  - `createMaterialsCheckoutSession`
- Handle `/materials?status=success|cancel` deep links.

## Repository location

Android reference code lives in this repo under `android/` for parity with `ios/`.
