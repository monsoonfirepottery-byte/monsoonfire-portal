# P1 - iOS Build Gate (B-tier)

You are Codex (gpt-5.3). Implement an iOS build gate (B-tier) for this repo.

## Goal
- Add a minimal iOS stub project that compiles in CI so PRs fail immediately if iOS build breaks.
- This stub is NOT a full app, not signed, not shipped. It exists only to keep our API/contracts iOS-compatible.
- Keep changes small, reversible, and well-documented.

## Constraints / Principles
- Prefer Swift Package Manager (SPM) where possible.
- No Xcode code signing required.
- No simulator run required.
- The gate should run fast and fail loudly.
- Avoid coupling to browser-only assumptions (no web-only APIs in shared contracts).

## Repo assumptions
- Current app is React/Vite + Firebase (Auth/Firestore/Functions).
- Cloud Functions use explicit Authorization: Bearer <idToken> and optional x-admin-token.
- We are moving toward an eventual Swift/SwiftUI iOS app; web is stepping stone.

## What to add
1) Create a new folder at repo root:
`/ios-gate/`
Containing a minimal Swift Package:
- `Package.swift`
- `Sources/MonsoonFireGate/main.swift` (or a tiny library + an executable target)
The package should compile with `swift build` on macOS runners.

2) Add a minimal contract mirror in Swift that matches our backend API shapes:
- `ContinueJourneyRequest { uid: String, fromBatchId: String }`
- `ContinueJourneyResponse { ok: Bool, newBatchId: String?, existingBatchId: String?, batchId: String?, message: String? }`
- Common error envelope (optional)
Keep it minimal, Codable, and resilient to extra fields.

3) Add a CI workflow:
- GitHub Actions workflow file:
  - `.github/workflows/ios-build-gate.yml`
- Runs on pull_request and pushes to main.
- Uses `runs-on: macos-latest`
- Steps:
  - checkout
  - cd ios-gate && swift build -c release
- Ensure workflow fails if build fails.

4) Add a short doc:
- `/ios-gate/README.md` explaining:
  - what the gate is
  - how to run locally: `cd ios-gate && swift build`
  - what kinds of changes it catches (e.g., contract drift / portability)
  - what it does NOT do (no UI, no signing, no simulator)

5) Keep output clean:
- Provide full file contents for each new file.
- If you must modify existing repo files, list them explicitly and keep changes minimal.

## Definition of Done
- `cd ios-gate && swift build` works locally on macOS.
- CI workflow runs on PR and fails when the Swift package doesnt compile.
- Contracts in Swift reflect current Cloud Function request/response shapes (especially continueJourney).

