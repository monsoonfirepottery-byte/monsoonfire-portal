# Specs Governance

- Use `CAPABILITY_CONNECTOR_ADR_TEMPLATE.md` for every new capability or connector.
- Keep owner, approval mode, rollback plan, and escalation path explicit.
- Policy lint is enforced in CI via `npm --prefix studio-brain run lint:policy`.
- Write-capable capabilities without approval metadata are blocking violations.
