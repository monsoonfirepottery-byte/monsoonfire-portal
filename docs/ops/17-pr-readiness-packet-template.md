# Ops PR Readiness Packet Template

Use this packet before opening or merging ops PRs that touch Studio Brain evidence, runbooks, CI/SRE scripts, or release verification. It is a template, not proof by itself; paste the command outputs or artifact paths into the PR.

## Scope

- PR:
- Branch:
- Owner:
- Slice IDs:
- Changed files:
- Explicit non-scope:
  - no service restarts
  - no deploys
  - no package upgrades
  - no firewall, SSH, sudoers, systemd, Docker, PostgreSQL, or secret changes unless a separate approval packet says otherwise

## Required Evidence

| Check | Command | Expected result | Evidence |
| --- | --- | --- | --- |
| Shell syntax | `bash -n scripts/ops/incident_bundle_v2.sh scripts/ops/ops_ci_validate.sh scripts/ops/post_deploy_verify.sh` | passes | |
| Ops script validation | `bash scripts/ops/ops_ci_validate.sh` | passes and writes `output/ops/ci-validate` | |
| PR stack steering digest | `node scripts/ops/pr_stack_audit.mjs --json --write` | writes `output/ops/pr-stack/pr-stack-audit-latest.md`; capped open counts are labeled as lower bounds | |
| Stale backlog packet report | `node scripts/ops/stale_backlog_packet_report.mjs --json --write` | writes `output/ops/swarm/stale-backlog-packets-latest.md` with refresh/retire candidates | |
| Post-merge verification packet | `node scripts/ops/post_merge_verification_packet.mjs --json --write` | writes `output/ops/post-merge/post-merge-verification-latest.md` with approval gates and current artifact health | |
| Generated readiness packet | `node scripts/ops/pr_readiness_packet.mjs --json --write` | writes `output/ops/pr-readiness/pr-readiness-latest.md` and omits install commands | |
| Redacted incident bundle v2 | `INCIDENT_BUNDLE_V2_SMOKE=1 INCIDENT_INCLUDE_LOGS=0 INCIDENT_INCLUDE_POST_DEPLOY=0 bash scripts/ops/incident_bundle_v2.sh output/ops/incidents-v2/pr-smoke` | writes `summary.json`, redacted reports, and `output/ops/incidents-v2/incident-bundle-v2-latest.json` for PR readiness | |
| Post-deploy verification help | `bash scripts/ops/post_deploy_verify.sh --help` | documents safe flags and env vars | |
| Docs review | Review `docs/ops/18-release-verification.md` | release verifier covers Studio Brain health/ready, Mission Control health/admin DOM, harness, and idle-worker audit | |

## Release Readiness Questions

| Question | Answer |
| --- | --- |
| Does the change avoid printing secrets, env dumps, cookies, bearer tokens, and JWTs? | |
| Does the change degrade gracefully when `curl`, `node`, `npm`, Docker, PostgreSQL, or live endpoints are unavailable? | |
| Does the change avoid destructive actions by default? | |
| Are generated outputs confined to ignored `output/` paths? | |
| Are live checks clearly separated from syntax/doc validation? | |

## Reviewer Notes

- Treat healthy `/healthz` as liveness only; post-deploy verification must include `/readyz` and Mission Control checks.
- Review generated incident bundles before attaching them outside the ops team. A `smoke` mode latest summary is enough to prove the tooling path exists, but capture a full bundle before service-impacting incident response.
- If a harness script is missing in the current repo, `post_deploy_verify.sh` should report a warning or skipped check, not read secrets or mutate state to compensate.

## Handoff

- Merge recommendation:
- Known warnings:
- Follow-up tickets:
- Rollback or removal plan:
