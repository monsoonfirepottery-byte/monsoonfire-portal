# Studio OS v3 Backlog

Anchor sentence (applies to every ticket):
Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Backlog Conventions
- Priority buckets: `P0` foundational, `P1` safety/value expansion, `P2` advanced workflows.
- Each ticket includes:
  - Goal + non-goals
  - Acceptance criteria
  - Files/dirs
  - Tests
  - Security notes
  - Rollback plan
  - Dependencies + estimate + telemetry gates
- Status values: `todo`, `in_progress`, `blocked`, `done`.

## Epics
- E01 Studio Brain Control Plane (Local Runtime)
- E02 StudioState Model (Read-only Intelligence Substrate)
- E03 Capability Gateway + Proposal/Approval Engine
- E04 Connector Framework (Cloud + Local + Physical)
- E05 Studio Ops Autopilot (Draft-only Recommendations)
- E06 Marketing Department Swarm (Draft-to-Publish)
- E07 Finance & Reconciliation Swarm
- E08 Trust & Safety Automation (Assistive)
- E09 Self-Improving Specifications
- E10 OS Surfaces UI Consolidation

## P0 Tickets
- `P0-v3-studio-brain-scaffold.md`
- `P0-v3-studio-state-readonly-computation.md`
- `P0-v3-dashboard-studio-state-diffs.md`
- `P0-v3-config-and-secrets-contract.md`
- `P0-v3-observability-baseline.md`
- `P0-v3-cloud-truth-guardrails-and-drift-detection.md`

## P1 Tickets
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-connector-framework-hubitat-readonly.md`
- `P1-v3-connector-framework-roborock-readonly.md`
- `P1-v3-marketing-swarm-draft-only.md`
- `P1-v3-ops-anomaly-detector-draft-recommendations.md`
- `P1-v3-approval-ui-in-staff-console.md`
- `P1-v3-policy-exemptions-and-kill-switch.md`
- `P1-v3-connector-test-harness.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- `P1-v3-rate-limits-quotas-and-abuse-controls.md`
- `P1-v3-illegal-or-infringing-work-intake-controls.md`

## P2 Tickets
- `P2-v3-finance-reconciliation-draft-flags.md`
- `P2-v3-trust-safety-assistive-triage.md`
- `P2-v3-os-cockpit-consolidation.md`
- `P2-v3-spec-governance-and-policy-lint.md`
- `P2-v3-write-path-pilot-firestore-approved-actions.md`
- `P2-v3-dr-recovery-and-rebuild-playbook.md`
- `P2-v3-kpi-scorecard-and-slo-alerting.md`
- `P2-v3-data-retention-portability-and-audit-export.md`
- `P2-v3-multi-studio-boundaries-readiness.md`
- `P2-v3-security-chaos-and-tabletop-exercises.md`

## Global Exit Gates (all tickets)
- No cloud-authoritative behavior regression in portal/functions.
- External writes are blocked unless explicit approval/exemption logic applies.
- Audit logs include actor, rationale, capability/action, and input/output hashes.
- Local runtime failure does not block core studio operations in cloud surfaces.

## Suggested Milestone Mapping
- Milestone A (P0 complete): runtime, config contract, observability, read-only snapshot + dashboard.
- Milestone B (P1 safety core): capabilities, approvals, connector harness, read-only physical connectors.
- Milestone C (P1 value): ops + marketing draft-only modules shipping into cockpit.
- Milestone D (P2 controlled scale): finance + trust/safety assistive modules + narrow write pilot + DR runbook.

## Companion Planning Artifacts
- `tickets/v3/DEPENDENCY_GRAPH.md`
- `tickets/v3/SLICED_EXECUTION_PLAN.md`
- `tickets/v3/DEFINITION_OF_DONE.md`
- `tickets/v3/RISK_REGISTER.md`
- `tickets/v3/EPIC_SCORECARD.md`
