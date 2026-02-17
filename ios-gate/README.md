# iOS Build Gate (SPM)

This folder contains a minimal Swift Package used only as a CI compile gate.

What it is:
- A tiny Swift Package Manager (SPM) executable target that must compile on macOS.
- A place to keep a minimal contract mirror (`Codable` request/response structs) so contract drift breaks CI loudly.

What it is not:
- Not a full app.
- No signing.
- No simulator run.
- No UI.

## Run locally (macOS)

```bash
cd ios-gate
swift build -c release
```

## What it catches

- Swift compiler breakage in shared contract shapes.
- Accidental web-only assumptions leaking into shared/native-facing contracts.
- Contract drift for critical endpoints (starting with `continueJourney`).

## What it does not catch

- Runtime behavior, UI issues, or simulator/device integration.
- Firebase SDK integration issues (this gate intentionally avoids external dependencies).

