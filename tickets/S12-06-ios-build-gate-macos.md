# S12-06 - iOS Build Gate (macOS CI + Local Workflow)

Created: 2026-02-10
Sprint: 12
Status: Completed
Swarm: D (QA + CI)

## Problem

iOS compilation and runtime verification require macOS + Xcode. Without a build gate, iOS regressions will accumulate silently.

## Tasks

- Decide macOS build strategy:
  - GitHub Actions macOS runner (preferred)
  - self-hosted Mac mini runner
- Add a minimal iOS build pipeline:
  - compile
  - run unit tests (if any)
  - run a smoke build for simulator
- Document local verification steps for Windows-first devs:
  - what can be validated on Windows
  - what must be validated on macOS
- Update evidence pack template to include iOS build logs.

## Acceptance

- PR fails fast on iOS compile errors with clear logs.
- There is a repeatable path to run iOS smoke checks on macOS.

## Progress updates
- iOS macOS build workflow is active in GitHub Actions and blocks PRs on Swift compile regressions.
- CI surfaced a concrete compile drift in `ios/PortalApiSmokeTest.swift` (`CreateBatchRequest` missing `clientRequestId`), which has now been patched.
- Local/operational verification workflow is documented in `docs/IOS_RUNBOOK.md`, including Windows-first constraints and macOS-required checks.
