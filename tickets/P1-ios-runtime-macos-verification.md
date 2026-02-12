Status: Open

# P1 - iOS runtime verification on macOS (Xcode)

- Repo: portal
- Area: iOS runtime
- Evidence: Windows-only workflow cannot run iOS simulator/runtime; Sprint 10 requires macOS/Xcode validation.
- Recommendation:
  - Use a macOS machine (local or CI runner) to build and run the iOS app on simulator/device.
  - Validate critical flows (auth, deep links, token copy/submit, push controls) and capture notes/screenshots in `docs/IOS_RUNBOOK.md`.
- Update (2026-02-06): macOS CI smoke workflow exists (`.github/workflows/ios-macos-smoke.yml`) but does not replace manual simulator/device runtime validation.
- Update (2026-02-12): CI compile blockers remediated in `ios/PortalAppShell.swift`:
  - add missing `clientRequestId` to `CreateBatchRequest`
  - replace iOS16-only `LabeledContent` with iOS15-compatible `HStack` row
  Manual simulator/device runtime verification remains required to close this ticket.
- Effort: M
- Risk: Med
- What to test: no crashes on startup, auth succeeds, and API calls succeed against expected base URL.
