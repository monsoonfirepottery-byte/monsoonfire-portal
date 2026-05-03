# Repo-Wide Agentic Health Audit - 2026-04-27

## Summary

Audit posture: audit first, ranked by production safety.

Scope covered tracked repo surfaces across portal web, Firebase Functions, Studio Brain, website, scripts, workflows, docs, tickets, and tracked artifacts. Public contracts stayed frozen during this wave: portal APIs, Firestore rules, function request/response contracts, website deploy behavior, Studio Brain HTTP contracts, and mobile mirrors were not changed except for guardrail-only script behavior.

Baseline finding: build and branch-moving checks must run isolated. Generated tracked `studio-brain/lib/` output can dirty the worktree when builds run during branch operations.

Secrets policy: local secret directories are referenced by path/name only. Raw secret values were not printed or copied into this audit.

## Inventory Commands

- `npm run audit:agentic:inventory`
- `npm run audit:write-surfaces`
- `npm run audit:destructive-surfaces`
- `npm run audit:branch-guard`
- `npm run guard:ephemeral:artifacts`
- `npm run security:history:scan`

Reports are written under ignored `output/qa/` paths unless a reviewed tracked audit artifact is intentional.

## Findings

| id | severity | surface | evidence | risk | recommended action | owner/scope | verification gate | refactor batch | GitHub |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AH-P1-001 | P1 | generated artifacts | unclear policy for `output/`, `studio-brain/lib/`, `docs/generated/`, `artifacts/`, `test-results/` | generated output can mask real source edits | define tracking policy and guard accidental routine artifacts | repo automation | `npm run guard:ephemeral:artifacts` | Batch 0 | #498 closed |
| AH-P1-002 | P1 | mutation-capable automation | workflows/scripts could mutate GitHub or live surfaces without obvious dry-run posture | accidental live mutation | inventory side effects and default manual paths to dry-run/read-only | GitHub workflows/scripts | `npm run audit:agentic:inventory` | Batch 2 | #499 closed |
| AH-P1-003 | P1 | Codex MCP config | repo-local Codex MCP config drift | agents can launch wrong or stale tool wiring | normalize config and add audit test | Codex harness | `npm run audit:codex-mcp` | Batch 2 | #500 closed |
| AH-P1-004 | P1 | Firestore index guard | portal index guard wrote tracked logs by default | read-only audit can dirty repo | move routine output under ignored `output/` and keep tracked artifacts explicit | portal ops | `npm run portal:index:guard` | Batch 1 | #501 closed |
| AH-P1-005 | P1 | Firestore rules tests | rules test runner failed on Windows | production auth/rules coverage unavailable on local Windows | fix cross-platform runner behavior | portal QA | `npm run test:rules` | Batch 1 | #502 closed |
| AH-P1-006 | P1 | security history | historical Discord/clawbot markers surfaced in history scan | possible stale secret exposure signal | triage markers by path/pattern without printing values | security history | `npm run security:history:scan` | Batch 1 | #503 closed |
| AH-P1-007 | P1 | contract matrix | strict mode passed while 4 warning rows existed | contract drift can look green | normalize `warn`/`warning`, make strict fail, split real drift follow-ups | source-of-truth contracts | `node ./scripts/source-of-truth-contract-matrix.mjs --strict --json` | Batch 3 | #504 closed; follow-ups #520, #521, #522 |
| AH-P1-008 | P1 | branch-moving checks | branch divergence guard must be isolated from builds | audits can leave unexpected branch/status | add wrapper that verifies branch, HEAD, and status stability | repo automation | `npm run audit:branch-guard` | Batch 2 | #505 closed |
| AH-P1-009 | P1 | prod auth provider config | checker could not use documented local credential source | provider drift cannot be verified | support repo/home env credential discovery and ADC/service-account auth | portal auth | `node ./scripts/check-prod-auth-provider-config.mjs --strict --json --skip-provider apple.com` | Batch 1 | #506 closed; follow-up #523 |
| AH-P1-010 | P1 | live authz probes | My Pieces and notifications authz probes wrote live data by default | QA scripts can mutate prod accidentally | default to dry-run, require explicit prod mutation flag | portal QA | `npm run portal:mypieces:authz:check`, `npm run portal:notifications:authz:check` | Batch 1 | #507 closed |
| AH-P2-001 | P2 | apply-mode workflows | `--apply` workflow paths needed explicit ownership/dry-run defaults | scheduled/manual automation can surprise operators | add side-effect metadata and safer dispatch defaults | GitHub workflows | `npm run audit:agentic:inventory` | Batch 2 | #508 closed |
| AH-P2-002 | P2 | TypeScript boundaries | production-source `any` hotspots in functions/web/Studio Brain | contract drift and unsafe writes are easier to miss | refactor one high-risk boundary family at a time with tests | functions/web/studio-brain | `npm --prefix functions run lint`, `npm --prefix functions run build` | Batch 4 | #509 closed |
| AH-P2-003 | P2 | package scripts | root scripts lacked owner/side-effect catalog | operators cannot tell read-only from live | generate command catalog by owner/default mode/side effect | repo automation | `npm run audit:agentic:inventory` | Batch 0 | #510 closed |
| AH-P2-004 | P2 | docs hygiene | stale local paths and missing links in docs | stale docs can route agents into dead workflows | clean machine paths and broken links | docs/runbooks | `node ./scripts/docs-hygiene-audit.mjs --strict --json` | Batch 3 | #511 closed |
| AH-P2-005 | P2 | security history | broad generic assignment scan had many noisy hits | false positives can hide real credential issues | triage generic matches separately from strict scan | security history | broad scanner artifact review | Batch 1 | #513 closed |
| AH-P2-006 | P2 | workflow permissions | workflow write permissions and apply tokens needed explicit review | excessive workflow permission blast radius | tighten dry-run defaults and document intentional writes | GitHub workflows | `npm run audit:agentic:inventory` | Batch 2 | #514 closed |
| AH-P2-007 | P2 | destructive deploy scripts | remote/local cleanup commands (`rm -rf`, preview deletion, temp cleanup) need boundary evidence | irreversible deploy or cleanup foot-gun | add path-boundary assertions and destructive-surface audit | deploy/host tooling | `npm run audit:destructive-surfaces` | Batch 2 | #515 closed |
| AH-P2-008 | P2 | Firestore/auth write surfaces | no owner map for write/auth-heavy files | first refactor slice could touch wrong boundary | generate write/auth owner inventory | portal safety | `npm run audit:write-surfaces` | Batch 0 | #516 closed |

## Follow-Up Batches

Batch 0 is the audit inventory and ownership map. Batch 1 is production safety. Batch 2 is automation safety. Batch 3 is source-of-truth hygiene. Batch 4 is maintainability refactors after the audit findings are reviewed.

Issue #512 in the numeric range is not an audit finding; it remains a separate Codex sidecar feature ticket.

## Split Follow-Ups

- #520 - API docs vs web portal function contract coverage.
- #521 - backend-only method inventory and reviewed waivers.
- #522 - iOS and Android contract mirror sync or subset waivers.
- #523 - Facebook production auth provider configuration or waiver.
