Status: Planned

# P2 - Run real-life kiln audit field session

- Repo: studio-brain / kiln
- Area: Genesis overlay / field validation / owner-authorized interoperability audit
- Target window: Friday, April 17, 2026 (America/Phoenix) unless rescheduled earlier in the week

## Goal

Run a real-life audit of the owner-authorized L&L / Bartlett Genesis / KilnAid stack in the studio so we can validate the overlay architecture against actual hardware, normal operator workflows, and real exported evidence.

## Why this matters

- Current overlay MVP is built and tested against documented assumptions plus synthetic Genesis fixtures.
- We still need field validation of:
  - actual Genesis menu paths
  - real exported log formats
  - real operator start / acknowledgement flow
  - KilnAid browser/app behavior under normal auth
  - passive LAN behavior during idle, start, monitoring, and export

## Audit shape

Perform two passes:

1. Cold audit
   - kiln idle
   - panel/menu walkthrough
   - KilnAid UI walkthrough
   - passive LAN baseline
2. Live audit
   - owner-approved real or test firing
   - timestamped operator workflow capture
   - passive LAN capture during normal use
   - raw log export and evidence preservation

## Field checklist

- Record exact kiln model, controller model, firmware, zones, thermocouple type, MAC/IP if visible
- Photograph all normal-owner Genesis menus and submenus
- Capture locally available actions:
  - start
  - stop
  - skip
  - add hold
  - change temp
  - diagnostics
  - maintenance
  - Wi-Fi
  - log export
  - Start Code
  - Output 4 / accessory behavior
- Walk KilnAid app and browser UI with legitimate auth only
- Capture passive LAN metadata during:
  - idle
  - open app/site
  - refresh status
  - local start at panel
  - mid-fire monitoring
  - log export
- Record human checkpoints:
  - loaded kiln
  - verified clearance
  - pressed start
  - opened kiln
  - completed unload

## Deliverables to update

- `docs/kiln/genesis-capability-audit.md`
- `docs/kiln/kilnaid-observed-behavior.md`
- `docs/kiln/network-topology-and-traffic.md`
- `docs/kiln/studiobrain-kiln-integration-options.md`
- `docs/kiln/open-questions-and-vendor-ask.md`
- `artifacts/kiln/menus/`
- `artifacts/kiln/pcaps/`
- `artifacts/kiln/docs-rag/`

## Success criteria

- We can clearly separate:
  - documented
  - observed
  - inferred
  - speculative
- We can state what Genesis can do locally versus what KilnAid exposes remotely
- We can confirm what Studio Brain can supervise today without unsupported write/control claims
- We can produce vendor questions only for the remaining unknowns

## Guardrails

- No auth bypass
- No brute force
- No TLS interception
- No packet injection or replay
- No firmware modification
- No unsupported electrical or hardware shims
- No remote control claims unless a supported path is actually verified
