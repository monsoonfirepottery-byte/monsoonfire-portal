# Ops Evidence Autopilot

Single-command orchestration for recurring operational evidence capture.

## Script
- `scripts/run-ops-evidence-autopilot.ps1`

## What it can run
1. Studio OS v3 local drills (`scripts/run-studio-os-v3-local-drills.mjs`)
2. Studio OS v3 staging drills (`scripts/run-studio-os-v3-staging-drills.mjs`) when `STUDIO_BRAIN_ID_TOKEN` is set
3. Notification reliability drills (`scripts/run-notification-drills.ps1`) when token + uid are supplied

## Outputs
- `output/ops-evidence/ops-evidence-summary-<UTC>.json`
- `output/ops-evidence/ops-evidence-summary-<UTC>.md`
- Any generated drill artifacts are referenced in the summary.

## Usage

### Local studio drills only
```powershell
pwsh -File scripts/run-ops-evidence-autopilot.ps1
```

### Local + staging studio drills
```powershell
$env:STUDIO_BRAIN_ID_TOKEN = "<REAL_STAFF_FIREBASE_ID_TOKEN>"
pwsh -File scripts/run-ops-evidence-autopilot.ps1 -StudioDrills both
```

### Add notification drills
```powershell
pwsh -File scripts/run-ops-evidence-autopilot.ps1 `
  -RunNotificationDrills `
  -NotificationIdToken "<REAL_FIREBASE_ID_TOKEN>" `
  -NotificationUid "<REAL_UID>"
```

## Notes
- The script never writes token values to docs/tickets.
- Staging drills are automatically skipped when `STUDIO_BRAIN_ID_TOKEN` is missing.
- Notification drills are skipped if ID token or UID is missing.
