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

## Later
- [ ] Add a single-glaze tiles board (photos/notes per glaze, not just combos).
- [ ] Refresh Community view recommended YouTube links quarterly (favor high-signal, beginner-safe pottery workflow videos and replace stale links).
- [ ] Track West Valley/Phoenix-area studio real estate opportunities for eventual expansion (warehouse/light-industrial listings, lease ranges, availability trend, and fit notes), while keeping home studio operations as default cost-effective baseline.

## Notes
- Vite + Vitest dev flow now uses `web/scripts/dev.mjs` (no `concurrently`).
