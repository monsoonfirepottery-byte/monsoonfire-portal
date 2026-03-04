# Website GA Live Execution Handoff Template

Use this template when owner-side GA exports and live experiment outcomes are available.

## Snapshot metadata
- Retrieval date (UTC):
- GA property:
- Export owner:
- Reporting window start (UTC):
- Reporting window end (UTC):

## Source artifacts (owner environment)
- Top acquisition channels export path:
- Landing pages export path:
- Path-to-conversion export path:
- Event audit export path:
- Goal table export path:
- Weekly dashboard export path:

## Experiment execution log (minimum two)

### Experiment 1
- Hypothesis:
- Segment:
- Start date (UTC):
- End date (UTC):
- Direction result (`win`, `loss`, `inconclusive`):
- Estimated lift or decline (%):
- Decision:

### Experiment 2
- Hypothesis:
- Segment:
- Start date (UTC):
- End date (UTC):
- Direction result (`win`, `loss`, `inconclusive`):
- Estimated lift or decline (%):
- Decision:

## Day-30 readout
- Top three conversion blockers:
- Owners assigned:
- Wins:
- Losses:
- Next-quarter backlog (top five):

## Command checklist
1. `npm run website:ga:data-package:check -- --strict`
2. `npm run website:ga:baseline:report -- --strict`
3. `npm run website:ga:funnel:report -- --strict`
4. `npm run website:ga:experiments:backlog -- --strict`
5. `npm run website:ga:content:opportunities -- --strict`
6. `npm run website:ga:dashboard:weekly -- --strict`
7. `npm run website:ga:roadmap:readiness -- --strict`
