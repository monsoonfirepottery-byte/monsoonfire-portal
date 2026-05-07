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
check_file "scripts/ops/validate_ops_artifacts.mjs"
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
  "scripts/ops/validate_ops_artifacts.mjs"; do
  if [ -f "${REPO_ROOT}/${script}" ] && node --check "${REPO_ROOT}/${script}" >/dev/null; then
    pass "node --check ${script}"
  else
    fail "node --check ${script}"
  fi
done

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
