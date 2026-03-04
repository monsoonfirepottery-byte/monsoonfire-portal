# Monsoon Fire Portal Documentation

Last reviewed: 2026-03-01

This folder contains active runbooks and contracts for the portal, functions, native parity, and operations workflows.

## Start Here

- Root operating guide: [`../AGENTS.md`](../AGENTS.md)
- Portal/API contracts: [`API_CONTRACTS.md`](API_CONTRACTS.md)
- Source-of-truth map: [`SOURCE_OF_TRUTH_INDEX.md`](SOURCE_OF_TRUTH_INDEX.md)
- Deep-link contract: [`DEEP_LINK_CONTRACT.md`](DEEP_LINK_CONTRACT.md)
- Library docs pack: [`library/README.md`](library/README.md)
- Agent-readable surface runbook: [`runbooks/AGENT_SURFACES.md`](runbooks/AGENT_SURFACES.md)
- Docs hygiene runbook: [`runbooks/DOCS_HYGIENE.md`](runbooks/DOCS_HYGIENE.md)
- Industry events curation runbook: [`runbooks/INDUSTRY_EVENTS_CURATION_RUNBOOK.md`](runbooks/INDUSTRY_EVENTS_CURATION_RUNBOOK.md)

## Environment URLs

- Production portal: `https://portal.monsoonfire.com`
- Firebase Hosting fallback: `https://monsoonfire-portal.web.app`
- Local Hosting emulator: `http://127.0.0.1:5000`
- Local Vite dev server: `http://127.0.0.1:5173`

## High-Value Commands

- Start emulators: `npm run emulators:start`
- Start portal dev server: `npm --prefix web run dev`
- Validate reservation docs parity: `npm run docs:reservations:check`
- Validate generated runtime docs drift: `npm run docs:contract:check`
- Contract/source-of-truth gate: `npm run source:truth:contract:strict`
- Agent surface gate: `npm run agent:surfaces:check`
- Docs hygiene audit: `npm run docs:hygiene`
- Docs refresh bundle: `npm run docs:refresh`

## Documentation Hygiene

- Use `npm run docs:hygiene:strict` before merging broad documentation updates.
- Use explicit package-prefixed npm commands in docs (`npm --prefix <pkg> run <script>`) to avoid ambiguous instructions.
- Keep generated docs machine-owned. Do not hand-edit `docs/generated/*.generated.md`.

## Historical Notes

These files are retained as archives and should not be treated as active source-of-truth:

- [`../PROJECT_SNAPSHOT.md`](../PROJECT_SNAPSHOT.md)
- [`../REVIEW_ACTION_PLAN.md`](../REVIEW_ACTION_PLAN.md)
- [`../WORKLOG.md`](../WORKLOG.md)
