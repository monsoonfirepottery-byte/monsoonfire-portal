# Studio OS v3 Release Readiness Checklist

As of 2026-02-16, this checklist maps each backlog ticket to current implementation evidence.

Legend:
- `done-in-code`: implemented with code/test evidence in repo
- `needs-ops-proof`: implemented in code, still needs recurring operational evidence

## P0 Foundation
| Ticket | Status | Evidence |
| --- | --- | --- |
| `P0-v3-studio-brain-scaffold.md` | `done-in-code` | `studio-brain/src/index.ts`, `studio-brain/src/db/migrate.ts` |
| `P0-v3-studio-state-readonly-computation.md` | `done-in-code` | `studio-brain/src/studioState/compute.ts`, `studio-brain/src/jobs/studioStateJob.ts` |
| `P0-v3-dashboard-studio-state-diffs.md` | `done-in-code` | `studio-brain/src/http/dashboard.ts`, `studio-brain/src/http/server.ts` |
| `P0-v3-config-and-secrets-contract.md` | `done-in-code` | `studio-brain/src/config/env.ts`, `studio-brain/src/config/logger.ts` |
| `P0-v3-observability-baseline.md` | `done-in-code` | `studio-brain/src/http/server.ts`, `studio-brain/src/jobs/runner.ts` |
| `P0-v3-cloud-truth-guardrails-and-drift-detection.md` | `done-in-code` | `studio-brain/src/studioState/drift.ts`, `studio-brain/src/studioState/compute.ts` |

## P1 Safety + Value Core
| Ticket | Status | Evidence |
| --- | --- | --- |
| `P1-v3-capability-registry-proposal-approval-audit.md` | `done-in-code` | `studio-brain/src/capabilities/runtime.ts`, `studio-brain/src/http/server.ts` |
| `P1-v3-connector-framework-hubitat-readonly.md` | `done-in-code` | `studio-brain/src/connectors/hubitatConnector.ts`, `studio-brain/src/connectors/hubitatConnector.test.ts` |
| `P1-v3-connector-framework-roborock-readonly.md` | `done-in-code` | `studio-brain/src/connectors/roborockConnector.ts`, `studio-brain/src/connectors/roborockConnector.test.ts` |
| `P1-v3-marketing-swarm-draft-only.md` | `done-in-code` | `studio-brain/src/swarm/marketing/draftPipeline.ts`, `studio-brain/src/http/server.ts` |
| `P1-v3-ops-anomaly-detector-draft-recommendations.md` | `done-in-code` | `studio-brain/src/swarm/ops/anomalyDetector.ts`, `studio-brain/src/http/server.ts` |
| `P1-v3-approval-ui-in-staff-console.md` | `done-in-code` | `web/src/views/staff/StudioBrainModule.tsx`, `web/src/views/staff/StudioBrainModule.test.tsx` |
| `P1-v3-policy-exemptions-and-kill-switch.md` | `done-in-code` | `studio-brain/src/capabilities/runtime.ts`, `studio-brain/src/http/server.ts` |
| `P1-v3-connector-test-harness.md` | `done-in-code` | `studio-brain/src/connectors/testing/runHarness.ts`, `studio-brain/reports/connector-contract-summary.json` |
| `P1-v3-agent-identity-bridge-and-delegation-enforcement.md` | `done-in-code` | `studio-brain/src/capabilities/actorResolution.ts`, `studio-brain/src/http/server.test.ts` |
| `P1-v3-rate-limits-quotas-and-abuse-controls.md` | `done-in-code` | `studio-brain/src/http/server.ts`, `studio-brain/src/capabilities/policy.ts` |
| `P1-v3-illegal-or-infringing-work-intake-controls.md` | `done-in-code` | `studio-brain/src/swarm/trustSafety/intakeControls.ts`, `studio-brain/src/http/server.ts` |

## P2 Advanced Workflows
| Ticket | Status | Evidence |
| --- | --- | --- |
| `P2-v3-finance-reconciliation-draft-flags.md` | `done-in-code` | `studio-brain/src/swarm/finance/reconciliation.ts`, `studio-brain/src/http/server.ts` |
| `P2-v3-trust-safety-assistive-triage.md` | `done-in-code` | `studio-brain/src/swarm/trustSafety/triageAssistant.ts`, `studio-brain/src/http/server.ts` |
| `P2-v3-os-cockpit-consolidation.md` | `done-in-code` | `web/src/views/staff/StudioBrainModule.tsx`, `web/src/views/staff/ReportsModule.tsx` |
| `P2-v3-spec-governance-and-policy-lint.md` | `done-in-code` | `studio-brain/src/observability/policyLint.ts`, `studio-brain/src/cli/policyLint.ts`, `.github/workflows/ci-smoke.yml` |
| `P2-v3-write-path-pilot-firestore-approved-actions.md` | `done-in-code` | `functions/src/v3Execution/pilotFirestoreAction.ts`, `studio-brain/src/http/server.ts`, `docs/runbooks/STUDIO_BRAIN_PILOT_WRITE_VERIFICATION.md` |
| `P2-v3-dr-recovery-and-rebuild-playbook.md` | `done-in-code` | `studio-brain/src/ops/rebuild.ts`, `studio-brain/src/cli/rebuild.ts` |
| `P2-v3-kpi-scorecard-and-slo-alerting.md` | `done-in-code` | `studio-brain/src/observability/scorecard.ts`, `studio-brain/src/http/server.ts` |
| `P2-v3-data-retention-portability-and-audit-export.md` | `done-in-code` | `studio-brain/src/jobs/retentionJob.ts`, `studio-brain/src/observability/auditExport.ts`, `studio-brain/src/cli/exportAudit.ts` |
| `P2-v3-multi-studio-boundaries-readiness.md` | `done-in-code` | `studio-brain/src/capabilities/actorResolution.ts`, `studio-brain/src/http/server.test.ts` |
| `P2-v3-security-chaos-and-tabletop-exercises.md` | `needs-ops-proof` | `studio-brain/scripts/chaos/README.md`, `docs/runbooks/STUDIO_OS_V3_INCIDENT_DRILLS.md` |

## Outstanding Evidence Tasks
1. Record recurring drill runs in `docs/DRILL_EXECUTION_LOG.md` using v3 scenario IDs.
2. Keep expanding cross-service integration coverage beyond current cockpit action-flow tests in `web/src/views/staff/StudioBrainModule.test.tsx`.

## Recently Closed Evidence Gaps
1. CI policy-lint wiring is explicit in `.github/workflows/ci-smoke.yml` (`Studio Brain policy lint` step).
2. Cockpit UI action-flow regressions now cover admin-token gate, kill-switch toggle payload, and intake deny override payload in `web/src/views/staff/StudioBrainModule.test.tsx`.
3. Ops drill contract coverage now includes auth/required-field validation and metadata fidelity checks (`mttrMinutes`, `unresolvedRisks`) in `studio-brain/src/http/server.test.ts`.
4. Ops degraded-mode coverage now includes auth/status guardrails, metadata fidelity (`status`, `mode`), audit prefix filtering, and non-staff rejection for ops audit/drill listing in `studio-brain/src/http/server.test.ts`.
