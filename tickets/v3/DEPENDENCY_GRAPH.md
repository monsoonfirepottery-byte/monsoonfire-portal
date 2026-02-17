# Studio OS v3 Dependency Graph

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Nodes
- `P0-v3-studio-brain-scaffold.md`
- `P0-v3-config-and-secrets-contract.md`
- `P0-v3-observability-baseline.md`
- `P0-v3-studio-state-readonly-computation.md`
- `P0-v3-cloud-truth-guardrails-and-drift-detection.md`
- `P0-v3-dashboard-studio-state-diffs.md`
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- `P1-v3-rate-limits-quotas-and-abuse-controls.md`
- `P1-v3-illegal-or-infringing-work-intake-controls.md`
- `P1-v3-approval-ui-in-staff-console.md`
- `P1-v3-policy-exemptions-and-kill-switch.md`
- `P1-v3-connector-framework-hubitat-readonly.md`
- `P1-v3-connector-framework-roborock-readonly.md`
- `P1-v3-connector-test-harness.md`
- `P1-v3-ops-anomaly-detector-draft-recommendations.md`
- `P1-v3-marketing-swarm-draft-only.md`
- `P2-v3-os-cockpit-consolidation.md`
- `P2-v3-finance-reconciliation-draft-flags.md`
- `P2-v3-trust-safety-assistive-triage.md`
- `P2-v3-write-path-pilot-firestore-approved-actions.md`
- `P2-v3-dr-recovery-and-rebuild-playbook.md`
- `P2-v3-kpi-scorecard-and-slo-alerting.md`
- `P2-v3-data-retention-portability-and-audit-export.md`
- `P2-v3-multi-studio-boundaries-readiness.md`
- `P2-v3-security-chaos-and-tabletop-exercises.md`
- `P2-v3-spec-governance-and-policy-lint.md`

## Edges (A -> B means B depends on A)
- `P0-v3-studio-brain-scaffold.md` -> `P0-v3-config-and-secrets-contract.md`
- `P0-v3-studio-brain-scaffold.md` -> `P0-v3-observability-baseline.md`
- `P0-v3-studio-brain-scaffold.md` -> `P0-v3-studio-state-readonly-computation.md`
- `P0-v3-studio-state-readonly-computation.md` -> `P0-v3-cloud-truth-guardrails-and-drift-detection.md`
- `P0-v3-studio-state-readonly-computation.md` -> `P0-v3-dashboard-studio-state-diffs.md`
- `P0-v3-dashboard-studio-state-diffs.md` -> `P2-v3-os-cockpit-consolidation.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md` -> `P1-v3-rate-limits-quotas-and-abuse-controls.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md` -> `P1-v3-illegal-or-infringing-work-intake-controls.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-approval-ui-in-staff-console.md`
- `P1-v3-approval-ui-in-staff-console.md` -> `P1-v3-policy-exemptions-and-kill-switch.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-connector-framework-hubitat-readonly.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-connector-framework-roborock-readonly.md`
- `P1-v3-connector-framework-hubitat-readonly.md` -> `P1-v3-connector-test-harness.md`
- `P1-v3-connector-framework-roborock-readonly.md` -> `P1-v3-connector-test-harness.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-ops-anomaly-detector-draft-recommendations.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P1-v3-marketing-swarm-draft-only.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P2-v3-write-path-pilot-firestore-approved-actions.md`
- `P1-v3-policy-exemptions-and-kill-switch.md` -> `P2-v3-write-path-pilot-firestore-approved-actions.md`
- `P2-v3-os-cockpit-consolidation.md` -> `P2-v3-kpi-scorecard-and-slo-alerting.md`
- `P0-v3-observability-baseline.md` -> `P2-v3-kpi-scorecard-and-slo-alerting.md`
- `P0-v3-studio-brain-scaffold.md` -> `P2-v3-data-retention-portability-and-audit-export.md`
- `P2-v3-os-cockpit-consolidation.md` -> `P2-v3-multi-studio-boundaries-readiness.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md` -> `P2-v3-multi-studio-boundaries-readiness.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` -> `P2-v3-spec-governance-and-policy-lint.md`
- `P0-v3-studio-state-readonly-computation.md` -> `P2-v3-dr-recovery-and-rebuild-playbook.md`
- `P1-v3-policy-exemptions-and-kill-switch.md` -> `P2-v3-security-chaos-and-tabletop-exercises.md`
- `P2-v3-dr-recovery-and-rebuild-playbook.md` -> `P2-v3-security-chaos-and-tabletop-exercises.md`

## Critical Path
1. `P0-v3-studio-brain-scaffold.md`
2. `P0-v3-config-and-secrets-contract.md`
3. `P0-v3-observability-baseline.md`
4. `P0-v3-studio-state-readonly-computation.md`
5. `P1-v3-capability-registry-proposal-approval-audit.md`
6. `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
7. `P1-v3-approval-ui-in-staff-console.md`
8. `P1-v3-policy-exemptions-and-kill-switch.md`
9. `P2-v3-write-path-pilot-firestore-approved-actions.md`

## Parallelizable Clusters
- Cluster A: `P0-v3-config-and-secrets-contract.md` + `P0-v3-observability-baseline.md`
- Cluster B: Hubitat + Roborock connector tickets
- Cluster C: Ops anomaly + Marketing draft swarm
- Cluster D: Finance + Trust/Safety assistive modules
- Cluster E: retention/export + multi-studio readiness
