Status: Completed

# P0 - Complete release candidate evidence pack (alpha gate)

- Repo: portal
- Area: Release / Ops
- Evidence: `docs/RELEASE_CANDIDATE_EVIDENCE.md` contains unchecked items and placeholder counters/sign-off.
- Recommendation:
  - Run CI gates and drills, then fill evidence sections with real outputs/links.
  - Record baseline counters (`statusCounts`, `reasonCounts`, `providerCounts`) and final risk register owners.
- Update (2026-02-06): local verification now recorded in `docs/RELEASE_CANDIDATE_EVIDENCE.md` (functions/web lint, web tests/build, chunk budgets). Remaining: production drill run with real staff auth, CI workflow links, counters/sign-off fields.
- Update (2026-02-12): unblocked smoke CI by fixing long-standing `functions/src/stripeConfig.ts` TypeScript errors (readonly secrets tuple typing + `??`/`||` precedence). `npm --prefix functions run build` now passes locally.
- Update (2026-02-12): release evidence now includes passing workflow links for smoke/lighthouse/iOS/macOS/android/deploy on head SHA `2be9ae22cfcd91b261e956d7cc4b550e595ab601`.
- Update (2026-02-12): added alpha preflight automation (`scripts/alpha-preflight.ps1`) and explicit accepted-risk register entries in `docs/RELEASE_CANDIDATE_EVIDENCE.md` for remaining external-console dependencies.
- Effort: S
- Risk: Med
- What to test: evidence pack has no unresolved checkboxes except explicit accepted risks with owner + mitigation.
