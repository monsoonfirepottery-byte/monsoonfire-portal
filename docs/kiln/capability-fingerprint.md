# Capability Fingerprint

## Purpose

Genesis firmware, exported log fields, and provider behavior can drift over time. The capability fingerprint avoids hard-coded assumptions by deriving a versioned capability document from evidence.

## Inputs

- controller family
- firmware version
- kiln zone count
- observed log fields
- provider support declarations
- operator-confirmed features

## Outputs

Each generated `KilnCapabilityDocument` stores:

- `enabledFeatures`
- `disabledFeatures`
- `ambiguousFeatures`
- `capabilities`
- `evidence`
- `observedFields`
- `providerSupport`
- `operatorConfirmedFeatures`
- `fingerprintHash`
- `generatedAt`

## Current Detection Rules

MVP detection currently infers:

- diagnostics from observed diagnostic, error-code, or relay fields
- local log export from export/log-export field markers
- zone telemetry from zone temperature or percent-power fields
- start-code support from start-code field markers
- program catalog support from program-name, program-type, or segment fields
- observed remote write only from provider-declared supported write actions

## Ambiguity Handling

Ambiguity is persisted instead of hidden.

- Missing proof of remote write keeps `remote_write` ambiguous.
- Missing history support keeps `history_snapshots` ambiguous.
- Confidence stays tied to evidence origin: `documented`, `observed`, or `inferred`.

## Control Posture Derivation

Control posture is derived from the latest capability document plus operator evidence:

- `Observed only` when there is no operator-confirmed start
- `Human-triggered` after operator confirmation, even if there is no write path
- `Supported write path` only when supported vendor write actions exist and `STUDIO_BRAIN_KILN_ENABLE_SUPPORTED_WRITES=true`

## Operational Guidance

- Treat capability documents as cached observations, not eternal truth.
- Regenerate when firmware, provider support, or observed fields change.
- Never upgrade posture from observation to control without explicit supported-write evidence.
