# Engineering TODOs

Date: 2026-02-04
Owner: TBD
Status: Active

## Pinned (Website First-Visit Review — 2026-02-16)
- [x] Website first-time onboarding path + primary CTA clarity.
  - Ticket: `tickets/P2-website-new-user-primary-cta-and-start-path.md`
- [x] Website mobile navigation affordance and tap-target clarity.
  - Ticket: `tickets/P2-website-mobile-nav-clarity-and-tap-targets.md`
- [x] Website contact page conversion flow (intake-first, not mailto-only).
  - Ticket: `tickets/P2-website-contact-page-conversion-intake.md`
- [x] Website services page decision-support density and trust cues.
  - Ticket: `tickets/P3-website-services-page-decision-support-density.md`
- [x] Website support/FAQ progressive disclosure for first-time visitors.
  - Ticket: `tickets/P3-website-support-faq-progressive-disclosure.md`

## Next up
- [x] Deploy website changes to production and clear strict prod smoke parity.
  - Ticket: `tickets/P2-website-prod-smoke-parity-deploy.md`
- [ ] Investigate and remediate `npm audit` high severity vulnerability in `web/` dependencies.
  - Reported chain: `vite-plugin-pwa` -> `workbox-build` -> `glob` -> `minimatch` -> `@isaacs/brace-expansion`
  - `npm audit` currently reports no fix available. Track upstream updates.
- [ ] Replace the sample glaze matrix with the real CSV matrix data for `importGlazeMatrix`.
- [x] Stand up West Valley/Phoenix real-estate market-watch foundation (ticket + schema + scoring script + runbook).
  - Ticket: `tickets/P2-studio-real-estate-market-watch-and-expansion-fit.md`
- [x] Run first live listing snapshot and publish top candidate watchlist with expansion fit scores.
  - Runbook: `docs/REAL_ESTATE_MARKET_WATCH.md`
  - Script: `scripts/run-real-estate-market-watch.ps1`
  - Artifacts: `output/real-estate/market-watch-20260217T183648Z.json`, `output/real-estate/market-watch-20260217T183648Z.md`
- [ ] Normalize listing import quality gates (required URL field, monthly-vs-annual rate flag, and per-source parser adapters).
- [x] Generate quarterly price-trend rollup and agent-swarm context pack from historical snapshots.
  - Ticket: `tickets/P2-studio-real-estate-quarterly-trends-and-agent-context.md`
  - Script: `scripts/build-real-estate-quarterly-context.ps1`
  - Outputs: `output/real-estate/market-watch-history.csv`, `output/real-estate/real-estate-quarterly-report-YYYY-QX.md`, `output/real-estate/agent-swarm-context-YYYY-QX.json`
- [ ] Automate quarterly context generation cadence (scheduled run + memory ingest handoff for swarm prompts).
- [x] Add agentic local real-estate research scanner for proactive opportunity discovery and distress-signal hunting.
  - Ticket: `tickets/P2-studio-real-estate-agentic-research-and-distress-scanner.md`
  - Script: `scripts/run-real-estate-agentic-research.ps1`
  - Outputs: `output/real-estate/agentic-research-<timestamp>.json`, `output/real-estate/agentic-research-<timestamp>.md`, `output/real-estate/agent-swarm-research-context-<timestamp>.json`
- [ ] Wire daily/weekly autonomous research cadence and handoff into swarm execution queue.

## Later
- [ ] Add a single-glaze tiles board (photos/notes per glaze, not just combos).
- [ ] Refresh Community view recommended YouTube links quarterly (favor high-signal, beginner-safe pottery workflow videos and replace stale links).

## Notes
- Vite + Vitest dev flow now uses `web/scripts/dev.mjs` (no `concurrently`).
