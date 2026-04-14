# Studio Brain Kiln Integration Options

## Executive Position

Studio Brain should treat the kiln stack as a supervised industrial workflow, not a target for control bypass.

Current evidence supports:

- strong supervision and operations support
- log ingestion
- maintenance analytics
- human-in-the-loop launch checkpoints

Current evidence does not yet support:

- trusted remote control authority through KilnAid
- any command path that bypasses on-panel safety, authentication, or manufacturer intent

Important nuance:

- the reviewed Genesis manual documents a `KISS`-based remote-start path after local arming and Start Code entry
- this is not the same thing as verified KilnAid remote control
- Studio Brain should treat `KISS` as a distinct capability surface that needs vendor confirmation before any integration design depends on it

## Architecture 1: Supported Path

### Summary

Genesis panel remains the control authority.
KilnAid remains the vendor monitoring plane.
Studio Brain becomes the operations and intelligence layer around them.

### Studio Brain Responsibilities

- queueing and scheduling
- job-to-batch linkage
- customer status visibility
- maintenance reminders
- alert routing
- firing-log ingestion
- trend analysis
- completion prediction

### Human Checkpoints

1. Studio Brain assembles kiln load recommendation.
2. Staff reviews ware, clay-body compatibility, and safety prerequisites.
3. Studio Brain says `press Start now` with the exact program and verification checklist.
4. Human enters any Start Code and starts at the panel.
5. Studio Brain supervises via KilnAid and imported logs.

### Why This Is Best

- aligns with documented product behavior
- avoids insurance and warranty landmines
- keeps kiln safety authority at the panel
- still gives Studio Brain real operational value

## Architecture 2: Owner-Safe Augmented Path

### Summary

No command injection. Add observation, prediction, and richer data fusion.

### Components

- passive LAN observer
- log collector for local export workflow
- KilnAid/browser screenshot and telemetry archive
- Studio Brain mirror dashboard
- anomaly detection from logs and relay-health baselines

### Good Use Cases

- detect abnormal slow heating
- predict completion windows
- detect recurring error-code patterns
- recommend thermocouple/relay service windows
- notify staff and customers without touching vendor control paths

### Conditions

- owner-authorized LAN
- no interception or replay
- no hidden credentials
- no changes to vendor infrastructure

## Architecture 3: High-Risk / Not Recommended

These are documented here only to keep boundaries explicit.

### Off-Limits Or Red-Lane Ideas

- relay-actuated touch simulation
- servo or solenoid hardware poking the panel
- fake-controller or MITM command shims
- unsupported firmware access or modification
- electrical intervention in safety interlocks
- anything that circumvents Start Code or vendor auth

### Why Not

- safety risk
- warranty and insurance exposure
- unclear legal posture
- fragile and hard to certify
- likely to degrade trust rather than improve operations

## Risk Register

| Risk | Severity | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Treating monitoring as control authority | High | Medium | keep human start checkpoint |
| Overstating KilnAid write capability | High | Medium | require observed proof or vendor confirmation |
| Unsafe network experimentation | High | Low | passive-only, no TLS interception |
| Maintenance prediction based on weak data | Medium | Medium | label inference confidence and keep human review |
| Firmware/version drift changing behavior | Medium | Medium | capture firmware version in every audit |

## Recommended Path

### Now

1. Finish Track A corpus and source-backed capability matrix.
2. Run Track B live panel walkthrough.
3. Run Track C authenticated browser/mobile audit.
4. Determine whether `KISS` is still supported and whether it is operationally relevant to the owner’s kiln.
5. Run Track D passive LAN observation.
6. Only then lock the integration contract.

### First Implementation Slice

Build Studio Brain around:

- kiln asset registry
- firing/job linkage
- log import
- status mirror
- maintenance trend views
- operator prompts and checklists

Do not build remote control claims into the first implementation slice.

## What Studio Brain Can Control Today

- its own schedules, queues, reminders, alerts, and reporting
- human workflow sequencing
- customer communications
- log ingestion and analytics once exported or otherwise legitimately accessed

## What Studio Brain Can Only Supervise

- kiln starts and stops unless a supported remote write path is proven
- any `KISS`-based remote-start path until current support status, safety implications, and owner relevance are confirmed
- live firing progression inside vendor systems
- controller configuration changes
- firmware changes
- any safety-critical physical process on the kiln itself
