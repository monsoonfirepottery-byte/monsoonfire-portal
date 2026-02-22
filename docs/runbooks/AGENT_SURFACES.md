# Agent Surfaces Runbook

## Purpose

Keep website and portal discovery surfaces current, safe, and deterministic for AI agents and swarms.

## Public Surfaces

Website (`monsoonfire.com`):
- `/llms.txt`
- `/ai.txt`
- `/robots.txt`
- `/sitemap.xml`
- `/agent-docs/`

Portal (`portal.monsoonfire.com`):
- `/llms.txt`
- `/ai.txt`
- `/robots.txt`
- `/sitemap.xml`
- `/agent-docs/`
- `/contracts/portal-contracts.json`

## Authoritative References

- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `docs/CONTINUE_JOURNEY_AGENT_QUICKSTART.md`

## Update Workflow

1. Update docs/contracts first when behavior changes.
2. Refresh website + portal `llms.txt` and `ai.txt` links and labels.
3. Keep `website/` and `website/ncsitebuilder/` agent surfaces in sync.
4. Update portal static artifact (`web/public/contracts/portal-contracts.json`) when endpoint contracts change.
5. Run deterministic check:
   - `npm run agent:surfaces:check`
6. Run epic status view if needed:
   - `node ./scripts/epic-hub.mjs show tickets/P1-EPIC-09-agent-readable-website-and-portal.md`

## CI Gate

`npm run agent:surfaces:check` enforces:
- required file existence,
- basic secret-pattern scan,
- link-shape and host validation,
- start-here quality checks in `llms.txt`.

The gate is deterministic and does not perform external network calls.

## Safety Rules

- Never publish secrets, bearer tokens, dev admin tokens, or internal hosts.
- Never expose private staff-only runbooks as public URLs.
- Keep this layer discovery-only; do not change authentication or authorization behavior.

## iOS Translation Bridge

For future iOS docs tooling, keep these files structured so they can be transformed into a compact mobile index:

- Inputs: website/portal `llms.txt`, `ai.txt`, and portal contracts JSON
- Required fields: stable URLs, authority labels, and workflow pointers
- Transform target: a single read-only JSON index consumable by native docs tooling

Current source file for this bridge note: `docs/runbooks/AGENT_SURFACES.md`.
