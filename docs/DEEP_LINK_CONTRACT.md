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
- Android: a central deep link parser does the same.
- Web: `web/src/App.tsx` should continue to read `window.location` for:
  - `status=success|cancel` messaging
  - initial route selection (glazes/materials/events)

