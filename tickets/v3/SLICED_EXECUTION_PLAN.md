# Studio OS v3 Sliced Execution Plan

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Slice 1 (P0-Week 1): Runtime Foundation
### Tickets
- `P0-v3-studio-brain-scaffold.md`
- `P0-v3-config-and-secrets-contract.md`
- `P0-v3-observability-baseline.md`

### Exit Checklist
- Runtime boots with migrations and health checks.
- Config parser enforces safe defaults and redaction.
- Startup, jobs, and failures emit structured events.

## Slice 2 (P0-Week 2): Read-Only State + Drift Controls
### Tickets
- `P0-v3-studio-state-readonly-computation.md`
- `P0-v3-cloud-truth-guardrails-and-drift-detection.md`
- `P0-v3-dashboard-studio-state-diffs.md`

### Exit Checklist
- Daily snapshots and diffs persisted locally.
- Dashboard shows derived-state labeling and stale-state warnings.
- Drift detector emits warnings on mismatch thresholds.

## Slice 3 (P1-Week 3): Capability Safety Core
### Tickets
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- `P1-v3-rate-limits-quotas-and-abuse-controls.md`

### Exit Checklist
- Capability execution path requires policy evaluation.
- Agent delegation checks enforced server-side.
- Quota denials reason-coded and auditable.

## Slice 4 (P1-Week 4): Approval + Policy Control
### Tickets
- `P1-v3-approval-ui-in-staff-console.md`
- `P1-v3-policy-exemptions-and-kill-switch.md`

### Exit Checklist
- Staff can approve/reject with rationale.
- Kill switch and exemption lifecycle tested end-to-end.

## Slice 5 (P1-Week 5): Connector Read-Only Launch
### Tickets
- `P1-v3-connector-framework-hubitat-readonly.md`
- `P1-v3-connector-framework-roborock-readonly.md`
- `P1-v3-connector-test-harness.md`

### Exit Checklist
- Connectors pass contract harness.
- Read-only capability bindings validated.
- Connector health visible and failure-classified.

## Slice 6 (P1-Week 6): Department Draft Value
### Tickets
- `P1-v3-ops-anomaly-detector-draft-recommendations.md`
- `P1-v3-marketing-swarm-draft-only.md`
- `P1-v3-illegal-or-infringing-work-intake-controls.md`

### Exit Checklist
- Recommendations and content drafts generated with confidence scores.
- No auto-execution or auto-publish paths enabled.

## Slice 7 (P2-Week 7): Cockpit + Pilot
### Tickets
- `P2-v3-os-cockpit-consolidation.md`
- `P2-v3-write-path-pilot-firestore-approved-actions.md`

### Exit Checklist
- Single cockpit shows state, queue, approvals, connector health, audit.
- One low-risk write pilot completes with rollback drill.

## Slice 8 (P2-Week 8): Scale and Governance
### Tickets
- `P2-v3-finance-reconciliation-draft-flags.md`
- `P2-v3-trust-safety-assistive-triage.md`
- `P2-v3-dr-recovery-and-rebuild-playbook.md`
- `P2-v3-kpi-scorecard-and-slo-alerting.md`
- `P2-v3-data-retention-portability-and-audit-export.md`
- `P2-v3-multi-studio-boundaries-readiness.md`
- `P2-v3-spec-governance-and-policy-lint.md`
- `P2-v3-security-chaos-and-tabletop-exercises.md`

### Exit Checklist
- Recovery runbook and rebuild path validated.
- KPI/SLO dashboard tracking operational quality.
- Governance lint active for capability/connector changes.

## Blocker Policy
- If a slice hits non-security blocker > 1 day, mark partial complete and move next parallelizable ticket.
- Security blockers pause all write-path work but allow read-only and docs tracks to continue.
