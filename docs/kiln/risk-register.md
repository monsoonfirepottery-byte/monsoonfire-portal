# Genesis Overlay Risk Register

## In Bounds

- preserving raw exported evidence
- normalizing controller telemetry and events
- recording operator acknowledgements
- queueing and workflow orchestration
- advisory analytics and maintenance signals
- read-only provider abstractions

## Explicitly Out of Bounds

- bypassing auth
- brute forcing codes or credentials
- TLS interception or packet replay
- vendor-service command injection
- firmware modification
- electrical or relay-layer control shims
- unsupported controller start/stop/program writes

## Current Risks

### Schema drift

Export formats may change across Genesis firmware revisions.

Mitigation:
- parser auto-detection
- parser diagnostics
- ambiguous-field capture
- raw artifact preservation

### Overstating control

An operations UI can accidentally imply remote control authority.

Mitigation:
- explicit control-posture badges
- human-trigger workflow
- supported-write feature flag defaulted off

### Thin evidence

Health analytics can become overconfident with sparse telemetry or limited history.

Mitigation:
- confidence notes on snapshots
- conservative defaults when evidence is weak

### Watched-folder fragility

Missing or changing watch paths can create ingestion blind spots.

Mitigation:
- separate kiln watch runtime status
- no mutation of source files
- duplicate detection by checksum and source path

### Future integration pressure

Teams may be tempted to add “just one” unsupported write path.

Mitigation:
- document the boundary
- force capability detection plus feature-flag enablement
- keep unsupported ideas in design docs, not shipping code
