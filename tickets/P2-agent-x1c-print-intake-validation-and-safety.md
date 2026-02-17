# P2 — Agent X1C Print Intake Validation and Safety

Status: Completed

## Problem
- 3D print jobs from agents can contain unsafe, unprintable, or policy-violating requests.
- Unvalidated jobs waste material/time and increase legal risk.

## Goals
- Add a validated intake path for X1C jobs with deterministic constraints.
- Catch invalid files and unsafe requests before quoting.

## Scope
- Intake schema: file type, material profile, dimensions, purpose, finishing requirements.
- Validation checks for allowed formats, size/material bounds, and policy flags.
- Explicit rejection reasons and remediation hints in API response.

## Security
- Malware/file handling protections for uploaded assets.
- Prohibited-use checks integrated before schedule/quote.
- No execution of untrusted file content in backend.

## Acceptance
- Invalid or disallowed jobs are rejected with machine-readable reason codes.
- Valid jobs produce deterministic quote inputs.
- Staff can override with logged justification when policy allows.

## Progress notes
- Added deterministic X1C intake validation in `functions/src/apiV1.ts`:
  - Added `kind: "x1c_print"` support.
  - Added schema fields:
    - `x1cFileType` (`3mf|stl|step`)
    - `x1cMaterialProfile` (`pla|petg|abs|asa|pa_cf|tpu`)
    - `x1cDimensionsMm` (bounded to <= 256mm on all axes)
    - `x1cQuantity` (1..20)
  - Added validation rejection with machine-readable reason codes and validation version.
  - Added normalized `x1cSpec` persistence for accepted intake payloads.
- Updated user intake UI (`web/src/views/AgentRequestsView.tsx`) for X1C requests:
  - Captures file type, material profile, dimensions, and quantity.
  - Adds client-side guardrails for dimensional and quantity bounds.
- Updated staff triage filters (`web/src/views/staff/AgentOpsModule.tsx`) to include `x1c_print`.
