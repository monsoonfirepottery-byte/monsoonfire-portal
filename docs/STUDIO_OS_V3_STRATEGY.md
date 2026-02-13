# Studio OS v3 Strategy

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Why v3 now
- v2 already has strong cloud primitives (delegations, integration tokens, staff ops, rate limits, audit surfaces).
- The missing layer is local orchestration: proposal generation, monitoring, and controlled connector abstraction.
- v3 captures this without introducing a second source of truth.

## Strategic Positioning
- **Product**: Studio OS is an operator cockpit, not just a member portal.
- **Architecture**: Hybrid local+cloud where cloud is authoritative and local is intelligence/orchestration.
- **Safety**: Approval-first writes and immutable audit are core product features, not add-ons.

## Operating Principles
1. Cloud truth wins for identity, payment state, and user-facing records.
2. Local state must be disposable/rebuildable.
3. Capability scopes are mandatory for external interactions.
4. Physical connectors start read-only and stay tightly constrained.
5. Human override always exists for risky operations.

## 3-Phase Plan

### Phase P0 (Foundation)
- Ship local runtime + Postgres stores + snapshot compute + local dashboard.
- Success metric: staff can inspect daily StudioState locally with zero cloud behavior regression.
- Exit gate:
  - Runtime health/readiness + structured observability in place.
  - Config/secrets contract validated at startup.
  - Snapshot + diff quality validated by staff spot checks.

### Phase P1 (Safety Core + First Value)
- Add capability/proposal/approval flow.
- Add read-only physical connectors (Hubitat + Roborock).
- Add draft-only Ops + Marketing swarms.
- Success metric: high-signal drafts with explicit approvals and full audit traceability.
- Exit gate:
  - Approval UI used for all candidate writes.
  - Connector harness passing on all registered connectors.
  - Kill switch and policy exemptions tested end-to-end.

### Phase P2 (Operational Scale)
- Finance reconciliation swarm.
- Assistive trust/safety triage.
- Consolidated OS cockpit.
- Success metric: measurable reduction in response and coordination overhead.
- Exit gate:
  - Narrow write pilot completed with rollback drill.
  - DR/rebuild playbook tested in tabletop and technical drill.
  - KPI scorecard reporting is stable and actionable.

## Governance Model
- RFC-lite for new high-risk capabilities.
- Required metadata for each capability: owner, risk tier, failure mode, rollback, test coverage.
- Quarterly policy review for exemptions and connector write permissions.

## SLO / KPI Seed Set
- Snapshot freshness SLA: 95% of snapshots generated within schedule window.
- Proposal review SLA: median approval/reject decision under target (configurable).
- Audit completeness: 100% of external write attempts linked to capability + approval state.
- Local failure tolerance: cloud core workflows unaffected by Studio Brain downtime.

## Immediate Next Moves
1. Keep P0 runtime stable and observable.
2. Implement capability registry before any connector write logic.
3. Keep all department swarms in draft-only mode until P1 approval/audit gates are proven.
4. Add identity bridge + delegation checks before enabling any agent-scoped execution.
5. Add cloud-truth drift detection before scale-up.

## Execution Order (Recommended)
1. `P0-v3-studio-brain-scaffold.md`
2. `P0-v3-config-and-secrets-contract.md`
3. `P0-v3-observability-baseline.md`
4. `P0-v3-studio-state-readonly-computation.md`
5. `P0-v3-dashboard-studio-state-diffs.md`
6. `P1-v3-capability-registry-proposal-approval-audit.md`
7. `P1-v3-approval-ui-in-staff-console.md`
8. `P1-v3-policy-exemptions-and-kill-switch.md`
9. `P1-v3-connector-framework-hubitat-readonly.md`
10. `P1-v3-connector-framework-roborock-readonly.md`
11. `P1-v3-connector-test-harness.md`
12. `P1-v3-ops-anomaly-detector-draft-recommendations.md`
13. `P1-v3-marketing-swarm-draft-only.md`
14. `P2-v3-os-cockpit-consolidation.md`
15. `P2-v3-finance-reconciliation-draft-flags.md`
16. `P2-v3-trust-safety-assistive-triage.md`
17. `P2-v3-write-path-pilot-firestore-approved-actions.md`
18. `P2-v3-dr-recovery-and-rebuild-playbook.md`
19. `P2-v3-kpi-scorecard-and-slo-alerting.md`
20. `P2-v3-spec-governance-and-policy-lint.md`

## Required Control Threads
- Identity thread: every proposal/execution must resolve to actor type (`human`, `staff`, `agent`) and delegated owner scope.
- Drift thread: local snapshots must carry source timestamps + hash provenance and fail closed when stale past threshold.
- Rate thread: enforce per-agent, per-owner, per-capability quotas with reason-coded denials.
- Retention thread: define TTL and export paths for local audit/state artifacts without mutating cloud authority.
- Compliance thread: classify and route potentially illegal, unsafe, or infringing requests to mandatory human review.
- Resilience thread: rehearse degraded-mode and incident response paths via scheduled chaos/tabletop drills.

## Top Risks + Countermeasures
- Local runtime begins to be treated as system of record.
  - Countermeasure: all UI labels and docs mark local data as derived; rebuild command exercised regularly.
- Approval fatigue slows operations.
  - Countermeasure: risk tiers + narrow exemptions with expiry and audit.
- Connectors break silently.
  - Countermeasure: health checks, contract harness, cockpit degraded-state indicators.
- Audit completeness drifts over time.
  - Countermeasure: deny-on-missing-audit hooks and CI checks on privileged flows.
- Physical connector misuse.
  - Countermeasure: read-only default, separate high-risk capability class, manual approval requirement.
