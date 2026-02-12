# P2 — Agent X1C Print Intake Validation and Safety

Status: Open

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
