# Studio OS v3 Epics

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Program Outcomes
- Studio can run day-to-day from existing cloud surfaces if local brain is unavailable.
- Staff gains a single control plane for insight + approvals without granting broad automation rights.
- Agent/surrounding automations stay capability-scoped and policy-governed.
- Physical connector actions are explicit, reviewable, and default read-only.

## Cross-Epic Decision Gates
- DG1 (end of P0): local runtime proves read-only value with zero cloud regressions.
- DG2 (start of P1): capability registry + approval/audit paths are in place before any write pilot.
- DG3 (start of P2): connector reliability + audit completeness pass threshold before scaling modules.
- DG4 (release): DR/rebuild runbook validated; staff can operate with local runtime disabled.

## E01 Studio Brain Control Plane (Local Runtime)
- Goal: local always-on orchestration runtime without becoming source-of-truth.
- Scope: package scaffold, jobs, config, Postgres stores, health.
- Primary tickets: `P0-v3-studio-brain-scaffold.md`
  - Supporting tickets: `P0-v3-config-and-secrets-contract.md`, `P0-v3-observability-baseline.md`
- Exit criteria:
  - Runtime boots cleanly with migrations.
  - Health endpoint + structured logs available.
  - No coupling required by cloud app paths.

## E02 StudioState Model (Read-only Intelligence Substrate)
- Goal: stable local daily snapshot + diff for operations intelligence.
- Scope: Firestore/Stripe read pipelines and snapshot schema versioning.
- Primary tickets: `P0-v3-studio-state-readonly-computation.md`, `P0-v3-dashboard-studio-state-diffs.md`
  - Supporting tickets: `P0-v3-cloud-truth-guardrails-and-drift-detection.md`
- Exit criteria:
  - Snapshot reproducible from cloud reads.
  - Diff noise low enough for operational use.
  - Data freshness and source timestamps visible.

## E03 Capability Gateway + Proposal/Approval Engine
- Goal: safe capability-driven execution path with explicit approvals.
- Scope: registry, proposals, approvals, immutable audit.
- Primary tickets: `P1-v3-capability-registry-proposal-approval-audit.md`
  - Supporting tickets: `P1-v3-approval-ui-in-staff-console.md`, `P1-v3-policy-exemptions-and-kill-switch.md`, `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`, `P1-v3-rate-limits-quotas-and-abuse-controls.md`
- Exit criteria:
  - External write path always references capability + approval state.
  - Complete audit chain for draft->approval->execution.

## E04 Connector Framework (Cloud + Local + Physical)
- Goal: standard connector abstraction with safety constraints and health checks.
- Scope: capability bindings, dry-run/read-first behavior.
- Primary tickets: `P1-v3-connector-framework-hubitat-readonly.md`, `P1-v3-connector-framework-roborock-readonly.md`
- Supporting tickets: `P1-v3-connector-test-harness.md`
- Future progression: `P3-v3-physical-connector-write-pilot.md` for capability-gated Hubitat/Roborock write pilots after existing approval plane is stable.
- Exit criteria:
  - Connector SDK supports consistent auth, retries, health, and audit semantics.
  - Hubitat/Roborock live in read-only mode first.
  - Read-only connector health and schema behavior is stable enough to support bounded write pilots.

## E05 Studio Ops Autopilot (Draft-only Recommendations)
- Goal: detect studio anomalies and propose operational fixes.
- Scope: draft recommendations only.
- Primary tickets: `P1-v3-ops-anomaly-detector-draft-recommendations.md`
- Exit criteria:
  - Recommendation quality and throttle controls are acceptable to staff.

## E06 Marketing Department Swarm (Draft-to-Publish)
- Goal: convert state/events into reviewable content drafts.
- Scope: draft queue, review controls, no auto-publish.
- Primary tickets: `P1-v3-marketing-swarm-draft-only.md`
- Exit criteria:
  - Draft quality is usable with human review overhead kept low.

## E07 Finance & Reconciliation Swarm
- Goal: detect payment/order mismatches early.
- Scope: read-only reconciliation + anomaly flagging.
- Primary tickets: `P2-v3-finance-reconciliation-draft-flags.md`
- Exit criteria:
  - Weekly discrepancy signal reduces manual reconciliation effort.

## E08 Trust & Safety Automation (Assistive)
- Goal: reduce moderator load with suggestions, not autonomous decisions.
- Scope: assistive triage.
- Primary tickets: `P2-v3-trust-safety-assistive-triage.md`
  - Supporting tickets: `P1-v3-illegal-or-infringing-work-intake-controls.md`, `P2-v3-security-chaos-and-tabletop-exercises.md`
- Exit criteria:
  - Suggestion quality improves triage speed without policy drift.

## E09 Self-Improving Specifications
- Goal: codify decisions, guardrails, and capability policy linting.
- Scope: ADR/spec templates + CI checks.
- Primary tickets: `P2-v3-spec-governance-and-policy-lint.md`
  - Supporting tickets: `P2-v3-data-retention-portability-and-audit-export.md`
- Exit criteria:
  - Any new capability/connector change must pass policy lint and docs update checks.

## E10 OS Surfaces UI Consolidation
- Goal: single cockpit across state/proposals/connectors/audit.
- Scope: staff-facing cockpit route/module.
- Primary tickets: `P2-v3-os-cockpit-consolidation.md`
  - Supporting tickets: `P2-v3-kpi-scorecard-and-slo-alerting.md`, `P2-v3-multi-studio-boundaries-readiness.md`
- Exit criteria:
  - Staff can run daily operations from one cockpit without losing existing fallback surfaces.

## Sequencing
- P0 foundation: E01 + E02
- P1 safety core: E03 + E04
- P1 value modules: E05 + E06
- P2 advanced controls: E07 + E08 + E10
- Continuous governance: E09

## Critical Path
1. E01 runtime + stores + config contract
2. E02 snapshot + diff reliability
3. E03 capability + approval + immutable audit
4. E04 connector framework (read-only) + harness
5. E10 cockpit consolidation with proposal queue + status views
6. P2 write pilot with narrow exemptions only

## Program Risks
- Shadow authority risk (local DB treated as truth) -> mitigate with hard guardrails + docs + read-only defaults.
- Approval bottlenecks -> mitigate with narrow, auditable exemptions only after baseline telemetry.
- Connector reliability drift -> mitigate with health checks/circuit breakers and explicit degraded mode UI.
- Safety bypass via manual connector shortcuts -> mitigate with connector abstraction as only allowed execution path.
- Quiet audit gaps -> mitigate with CI audit completeness checks and runtime deny-on-missing-audit hooks.
- Local secret sprawl -> mitigate with strict config contract and startup validation.
