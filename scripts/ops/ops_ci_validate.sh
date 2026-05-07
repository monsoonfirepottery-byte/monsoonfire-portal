#!/usr/bin/env bash
set -u

# CI/SRE validation for the Worker F ops scripts and docs.
# It is local and read-only: syntax checks, doc presence checks, and a redacted
# bundle smoke that skips expensive live/harness work.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/ci-validate}"
FAILURES=0
OPS_CI_MAX_PACKETS="${OPS_CI_MAX_PACKETS:-8}"

mkdir -p "${OUT_DIR}"

section() {
  printf '\n## %s\n' "$1"
}

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL: %s\n' "$1"
}

check_file() {
  local path="$1"
  if [ -f "${REPO_ROOT}/${path}" ]; then
    pass "found ${path}"
  else
    fail "missing ${path}"
  fi
}

section "Required Files"
check_file "scripts/ops/incident_bundle_v2.sh"
check_file "scripts/ops/ops_ci_validate.sh"
check_file "scripts/ops/post_deploy_verify.sh"
check_file "scripts/ops/artifact_registry.mjs"
check_file "scripts/ops/validate_ops_artifacts.mjs"
check_file "scripts/ops/swarm_lane_preflight.mjs"
check_file "scripts/ops/ops_wave_runner.mjs"
check_file "scripts/ops/slice_ledger.mjs"
check_file "scripts/ops/admin_effectivity_audit.mjs"
check_file "scripts/ops/admin_effectivity_trend.mjs"
check_file "scripts/ops/host_drift_manifest.mjs"
check_file "scripts/ops/work_packet_quality_lint.mjs"
check_file "scripts/ops/stale_backlog_packet_report.mjs"
check_file "scripts/ops/tooling_quality_report.mjs"
check_file "scripts/ops/tooling_findings_export.mjs"
check_file "scripts/ops/installed_tool_inventory.mjs"
check_file "scripts/ops/tool_install_recommendations.mjs"
check_file "scripts/studiobrain-ops-work-packet.mjs"
check_file "scripts/ops/pr_readiness_packet.mjs"
check_file "scripts/ops/post_merge_verification_packet.mjs"
check_file "scripts/ops/packet_outcome_report.mjs"
check_file "scripts/ops/pr_stack_audit.mjs"
check_file "schemas/ops/incident-bundle-v2-summary.v1.schema.json"
check_file "schemas/ops/pr-readiness-packet.v1.schema.json"
check_file "schemas/ops/post-merge-verification-packet.v1.schema.json"
check_file "docs/ops/17-pr-readiness-packet-template.md"
check_file "docs/ops/18-release-verification.md"

section "Shell Syntax"
for script in \
  "scripts/ops/incident_bundle_v2.sh" \
  "scripts/ops/ops_ci_validate.sh" \
  "scripts/ops/post_deploy_verify.sh"; do
  if [ -f "${REPO_ROOT}/${script}" ] && bash -n "${REPO_ROOT}/${script}"; then
    pass "bash -n ${script}"
  else
    fail "bash -n ${script}"
  fi
done

section "Node Syntax"
for script in \
  "scripts/ops/artifact_registry.mjs" \
  "scripts/ops/validate_ops_artifacts.mjs" \
  "scripts/ops/swarm_lane_preflight.mjs" \
  "scripts/ops/ops_wave_runner.mjs" \
  "scripts/ops/slice_ledger.mjs" \
  "scripts/ops/admin_effectivity_audit.mjs" \
  "scripts/ops/admin_effectivity_trend.mjs" \
  "scripts/ops/host_drift_manifest.mjs" \
  "scripts/ops/work_packet_quality_lint.mjs" \
  "scripts/ops/stale_backlog_packet_report.mjs" \
  "scripts/ops/tooling_quality_report.mjs" \
  "scripts/ops/tooling_findings_export.mjs" \
  "scripts/ops/installed_tool_inventory.mjs" \
  "scripts/ops/tool_install_recommendations.mjs" \
  "scripts/studiobrain-ops-work-packet.mjs" \
  "scripts/ops/pr_readiness_packet.mjs" \
  "scripts/ops/post_merge_verification_packet.mjs" \
  "scripts/ops/packet_outcome_report.mjs" \
  "scripts/ops/pr_stack_audit.mjs"; do
  if [ -f "${REPO_ROOT}/${script}" ] && node --check "${REPO_ROOT}/${script}" >/dev/null; then
    pass "node --check ${script}"
  else
    fail "node --check ${script}"
  fi
done

section "Node Tests"
if node --test "${REPO_ROOT}/scripts/ops/artifact_registry.test.mjs" >"${OUT_DIR}/artifact-registry.test.out" 2>&1; then
  pass "node --test scripts/ops/artifact_registry.test.mjs"
else
  fail "node --test scripts/ops/artifact_registry.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/swarm_lane_preflight.test.mjs" >"${OUT_DIR}/swarm-lane-preflight.test.out" 2>&1; then
  pass "node --test scripts/ops/swarm_lane_preflight.test.mjs"
else
  fail "node --test scripts/ops/swarm_lane_preflight.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/validate_ops_artifacts.test.mjs" >"${OUT_DIR}/validate-ops-artifacts.test.out" 2>&1; then
  pass "node --test scripts/ops/validate_ops_artifacts.test.mjs"
else
  fail "node --test scripts/ops/validate_ops_artifacts.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/ops_wave_runner.test.mjs" >"${OUT_DIR}/ops-wave-runner.test.out" 2>&1; then
  pass "node --test scripts/ops/ops_wave_runner.test.mjs"
else
  fail "node --test scripts/ops/ops_wave_runner.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/slice_ledger.test.mjs" >"${OUT_DIR}/slice-ledger.test.out" 2>&1; then
  pass "node --test scripts/ops/slice_ledger.test.mjs"
else
  fail "node --test scripts/ops/slice_ledger.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/admin_effectivity_audit.test.mjs" >"${OUT_DIR}/admin-effectivity-audit.test.out" 2>&1; then
  pass "node --test scripts/ops/admin_effectivity_audit.test.mjs"
else
  fail "node --test scripts/ops/admin_effectivity_audit.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/admin_effectivity_trend.test.mjs" >"${OUT_DIR}/admin-effectivity-trend.test.out" 2>&1; then
  pass "node --test scripts/ops/admin_effectivity_trend.test.mjs"
else
  fail "node --test scripts/ops/admin_effectivity_trend.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/host_drift_manifest.test.mjs" >"${OUT_DIR}/host-drift-manifest.test.out" 2>&1; then
  pass "node --test scripts/ops/host_drift_manifest.test.mjs"
else
  fail "node --test scripts/ops/host_drift_manifest.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/work_packet_quality_lint.test.mjs" >"${OUT_DIR}/work-packet-quality-lint.test.out" 2>&1; then
  pass "node --test scripts/ops/work_packet_quality_lint.test.mjs"
else
  fail "node --test scripts/ops/work_packet_quality_lint.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/stale_backlog_packet_report.test.mjs" >"${OUT_DIR}/stale-backlog-packet-report.test.out" 2>&1; then
  pass "node --test scripts/ops/stale_backlog_packet_report.test.mjs"
else
  fail "node --test scripts/ops/stale_backlog_packet_report.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/tooling_quality_report.test.mjs" >"${OUT_DIR}/tooling-quality-report.test.out" 2>&1; then
  pass "node --test scripts/ops/tooling_quality_report.test.mjs"
else
  fail "node --test scripts/ops/tooling_quality_report.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/tooling_findings_export.test.mjs" >"${OUT_DIR}/tooling-findings-export.test.out" 2>&1; then
  pass "node --test scripts/ops/tooling_findings_export.test.mjs"
else
  fail "node --test scripts/ops/tooling_findings_export.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/installed_tool_inventory.test.mjs" >"${OUT_DIR}/installed-tool-inventory.test.out" 2>&1; then
  pass "node --test scripts/ops/installed_tool_inventory.test.mjs"
else
  fail "node --test scripts/ops/installed_tool_inventory.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/tool_install_recommendations.test.mjs" >"${OUT_DIR}/tool-install-recommendations.test.out" 2>&1; then
  pass "node --test scripts/ops/tool_install_recommendations.test.mjs"
else
  fail "node --test scripts/ops/tool_install_recommendations.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/studiobrain-ops-work-packet.test.mjs" >"${OUT_DIR}/studiobrain-ops-work-packet.test.out" 2>&1; then
  pass "node --test scripts/studiobrain-ops-work-packet.test.mjs"
else
  fail "node --test scripts/studiobrain-ops-work-packet.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/pr_readiness_packet.test.mjs" >"${OUT_DIR}/pr-readiness-packet.test.out" 2>&1; then
  pass "node --test scripts/ops/pr_readiness_packet.test.mjs"
else
  fail "node --test scripts/ops/pr_readiness_packet.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/post_merge_verification_packet.test.mjs" >"${OUT_DIR}/post-merge-verification-packet.test.out" 2>&1; then
  pass "node --test scripts/ops/post_merge_verification_packet.test.mjs"
else
  fail "node --test scripts/ops/post_merge_verification_packet.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/packet_outcome_report.test.mjs" >"${OUT_DIR}/packet-outcome-report.test.out" 2>&1; then
  pass "node --test scripts/ops/packet_outcome_report.test.mjs"
else
  fail "node --test scripts/ops/packet_outcome_report.test.mjs"
fi

if node --test "${REPO_ROOT}/scripts/ops/pr_stack_audit.test.mjs" >"${OUT_DIR}/pr-stack-audit.test.out" 2>&1; then
  pass "node --test scripts/ops/pr_stack_audit.test.mjs"
else
  fail "node --test scripts/ops/pr_stack_audit.test.mjs"
fi

section "Swarm Lane Preflight Smoke"
if node "${REPO_ROOT}/scripts/ops/swarm_lane_preflight.mjs" --lane tooling --base origin/main --json --write >"${OUT_DIR}/swarm-lane-preflight.json"; then
  pass "swarm_lane_preflight tooling smoke"
else
  fail "swarm_lane_preflight tooling smoke"
fi

section "Ops Wave Runner Dry Run"
if node "${REPO_ROOT}/scripts/ops/ops_wave_runner.mjs" --dry-run --json --steps swarm-preflight,host-drift-manifest,pr-stack-audit,work-packet,artifact-validation >"${OUT_DIR}/ops-wave-runner-dry-run.json"; then
  pass "ops_wave_runner dry-run smoke"
else
  fail "ops_wave_runner dry-run smoke"
fi

section "Tooling Quality Smoke"
if node "${REPO_ROOT}/scripts/ops/tooling_quality_report.mjs" --mode all --json --write >"${OUT_DIR}/tooling-quality-report.json"; then
  pass "tooling_quality_report smoke"
else
  fail "tooling_quality_report smoke"
fi

section "Tool Install Recommendation Smoke"
if node "${REPO_ROOT}/scripts/ops/installed_tool_inventory.mjs" --json --write >"${OUT_DIR}/installed-tool-inventory.json"; then
  pass "installed_tool_inventory smoke"
else
  fail "installed_tool_inventory smoke"
fi

if node "${REPO_ROOT}/scripts/ops/tool_install_recommendations.mjs" --json --write >"${OUT_DIR}/tool-install-recommendations.json"; then
  pass "tool_install_recommendations smoke"
else
  fail "tool_install_recommendations smoke"
fi

section "Tooling Findings Export Smoke"
if node "${REPO_ROOT}/scripts/ops/tooling_findings_export.mjs" --json --write >"${OUT_DIR}/tooling-findings-export.json"; then
  pass "tooling_findings_export smoke"
else
  fail "tooling_findings_export smoke"
fi

section "Host Drift Manifest Smoke"
if node "${REPO_ROOT}/scripts/ops/host_drift_manifest.mjs" --json --write >"${OUT_DIR}/host-drift-manifest.json"; then
  pass "host_drift_manifest smoke"
else
  fail "host_drift_manifest smoke"
fi

section "Redacted Bundle Smoke"
SMOKE_DIR="${OUT_DIR}/incident-bundle-v2-smoke.$(date -u +%Y%m%dT%H%M%SZ).$$"
INCIDENT_BUNDLE_V2_SMOKE=1 INCIDENT_INCLUDE_POST_DEPLOY=0 INCIDENT_INCLUDE_LOGS=0 bash "${REPO_ROOT}/scripts/ops/incident_bundle_v2.sh" "${SMOKE_DIR}" >"${OUT_DIR}/incident-bundle-v2-smoke.out" 2>&1
bundle_code="$?"
if [ "${bundle_code}" -eq 0 ] && [ -f "${SMOKE_DIR}/summary.json" ]; then
  pass "incident_bundle_v2 smoke wrote summary.json"
else
  fail "incident_bundle_v2 smoke failed with exit ${bundle_code}"
fi

if grep -RIEq 'Authorization:[[:space:]]*Bearer[[:space:]]+[^[]|password[=:][^[]|secret[=:][^[]|api[_-]?key[=:][^[]' "${SMOKE_DIR}" 2>/dev/null; then
  fail "redaction smoke found a likely unredacted secret pattern"
else
  pass "redaction smoke found no obvious secret patterns"
fi

section "PR Stack Audit Smoke"
if node "${REPO_ROOT}/scripts/ops/pr_stack_audit.mjs" --json --write >"${OUT_DIR}/pr-stack-audit.json"; then
  pass "pr_stack_audit smoke"
else
  fail "pr_stack_audit smoke"
fi

section "Work Packet Generation Smoke"
if node "${REPO_ROOT}/scripts/studiobrain-ops-work-packet.mjs" --json --write --max-packets "${OPS_CI_MAX_PACKETS}" >"${OUT_DIR}/studiobrain-ops-work-packet.json"; then
  pass "studiobrain-ops-work-packet smoke"
else
  fail "studiobrain-ops-work-packet smoke"
fi

section "Packet Outcome Report Smoke"
if node "${REPO_ROOT}/scripts/ops/packet_outcome_report.mjs" --json --write >"${OUT_DIR}/packet-outcome-report.json"; then
  pass "packet_outcome_report smoke"
else
  fail "packet_outcome_report smoke"
fi

section "Work Packet Quality Lint Smoke"
if node "${REPO_ROOT}/scripts/ops/work_packet_quality_lint.mjs" --json --write >"${OUT_DIR}/work-packet-quality-lint.json"; then
  pass "work_packet_quality_lint smoke"
else
  fail "work_packet_quality_lint smoke"
fi

section "Stale Backlog Packet Report Smoke"
if node "${REPO_ROOT}/scripts/ops/stale_backlog_packet_report.mjs" --json --write >"${OUT_DIR}/stale-backlog-packet-report.json"; then
  pass "stale_backlog_packet_report smoke"
else
  fail "stale_backlog_packet_report smoke"
fi

section "Post-Merge Verification Packet Smoke"
if node "${REPO_ROOT}/scripts/ops/post_merge_verification_packet.mjs" --json --write >"${OUT_DIR}/post-merge-verification-packet.json"; then
  pass "post_merge_verification_packet smoke"
else
  fail "post_merge_verification_packet smoke"
fi

section "PR Readiness Packet Smoke"
if node "${REPO_ROOT}/scripts/ops/pr_readiness_packet.mjs" --json --write >"${OUT_DIR}/pr-readiness-packet.json"; then
  pass "pr_readiness_packet smoke"
else
  fail "pr_readiness_packet smoke"
fi

section "Admin Effectivity Trend Smoke"
if node "${REPO_ROOT}/scripts/ops/admin_effectivity_trend.mjs" --json --write >"${OUT_DIR}/admin-effectivity-trend.json"; then
  pass "admin_effectivity_trend smoke"
else
  fail "admin_effectivity_trend smoke"
fi

section "Artifact Schema Smoke"
if node "${REPO_ROOT}/scripts/ops/validate_ops_artifacts.mjs" --json --write >"${OUT_DIR}/artifact-schema-validation.json"; then
  pass "validate_ops_artifacts schema smoke"
else
  fail "validate_ops_artifacts schema smoke"
fi

section "Docs Contract"
for needle in \
  "incident bundle v2" \
  "post-deploy verification" \
  "Studio Brain health" \
  "Mission Control" \
  "idle-worker"; do
  if grep -Riq "${needle}" "${REPO_ROOT}/docs/ops/17-pr-readiness-packet-template.md" "${REPO_ROOT}/docs/ops/18-release-verification.md" 2>/dev/null; then
    pass "docs mention ${needle}"
  else
    fail "docs missing ${needle}"
  fi
done

section "Post-Deploy Help Smoke"
if bash "${REPO_ROOT}/scripts/ops/post_deploy_verify.sh" --help >/dev/null 2>&1; then
  pass "post_deploy_verify --help"
else
  fail "post_deploy_verify --help"
fi

section "Summary"
printf 'failures: %s\n' "${FAILURES}"
printf 'output_dir: %s\n' "${OUT_DIR}"

if [ "${FAILURES}" -gt 0 ]; then
  exit 1
fi

exit 0
