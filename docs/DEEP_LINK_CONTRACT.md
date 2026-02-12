# Deep Link Contract (Web + iOS + Android)

Date: 2026-02-10

## Goal

Define a stable URL contract that works for:
- Web navigation on `https://portal.monsoonfire.com`
- iOS Universal Links
- Android App Links

## Canonical routes

### Materials checkout callback
- `/materials?status=success`
- `/materials?status=cancel`

### Events checkout callback
- `/events?status=success&eventId=<EVENT_ID>`
- `/events?status=cancel&eventId=<EVENT_ID>`

### Notification tap routing
- `/kiln?firingId=<FIRING_ID>`
- `/pieces?batchId=<BATCH_ID>`
- `/events?eventId=<EVENT_ID>`

## Hosting requirements (.well-known)

For Universal Links / App Links, the portal origin must serve:
- `/.well-known/apple-app-site-association` (no extension; `application/json`)
- `/.well-known/assetlinks.json` (`application/json`)

Templates are in:
- `website/.well-known/apple-app-site-association`
- `website/.well-known/assetlinks.json`

These must be deployed on the same origin as the portal:
- `https://portal.monsoonfire.com/.well-known/...`

## Client routing requirements

- iOS: `ios/DeepLinkRouter.swift` parses the URL and chooses a target tab/screen.
- Android: `android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt` parses the URL and `MainActivity` handles VIEW intents.
- Web: `web/src/App.tsx` should continue to read `window.location` for:
  - `status=success|cancel` messaging
  - initial route selection (glazes/materials/events)

## QA trigger commands

iOS simulator (Safari):
- `xcrun simctl openurl booted "https://portal.monsoonfire.com/materials?status=success"`
- `xcrun simctl openurl booted "https://portal.monsoonfire.com/events?status=cancel&eventId=evt_123"`

Android emulator:
- `adb shell am start -a android.intent.action.VIEW -d "https://portal.monsoonfire.com/materials?status=success" com.monsoonfire.portal.reference`
- `adb shell am start -a android.intent.action.VIEW -d "https://portal.monsoonfire.com/kiln?firingId=firing_123" com.monsoonfire.portal.reference`

Expected:
- known links route without crash and show status feedback
- unknown links fail safely with fallback messaging
