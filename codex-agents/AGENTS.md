# Codex Agents Workspace Guide

Canonical repository instructions live in [`../AGENTS.md`](../AGENTS.md).
This workspace is for agent coordination assets and should not duplicate runtime command policy.

## Useful Commands

- Docs hygiene audit: `npm run docs:hygiene`
- Contract matrix check: `npm run source:truth:contract:strict`
- Platform reference audit: `npm run audit:platform:refs:strict`

## Notes

- Keep this file concise and defer behavior/policy rules to the root AGENTS guide.
- Secrets hint: if an agent run needs auth context, check `../secrets/` (especially `../secrets/portal/`) before declaring a hard blocker.
