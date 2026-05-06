#!/usr/bin/env bash
set -u

# Read-only npm dependency and audit posture inventory.
# This script does not install packages, run npm audit fix, update lockfiles, or
# print environment variables. It only reads package manifests/locks and asks
# npm for audit metadata when a package-lock.json is present.

SCRIPT_NAME="$(basename "$0")"

section() {
  printf '\n## %s\n' "$1"
}

warn() {
  printf 'warning: %s\n' "$1"
}

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [package-dir ...]

Read-only npm audit inventory for package directories. When no directories are
provided, package.json files are discovered below the current working directory,
excluding node_modules.

Safety:
- no npm install
- no npm update
- no npm audit fix
- no package or lockfile writes
- no environment dumps
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

section "Safety"
printf 'mode: read_only\n'
printf 'mutations: none\n'
printf 'requires: node and npm for audit details\n'
printf 'secret_handling: does_not_print_environment_values\n'

section "Command Versions"
if command -v node >/dev/null 2>&1; then
  printf 'node: %s\n' "$(node --version 2>&1 | head -n 1)"
else
  printf 'node: not installed\n'
fi

if command -v npm >/dev/null 2>&1; then
  printf 'npm: %s\n' "$(npm --version 2>&1 | head -n 1)"
else
  printf 'npm: not installed\n'
fi

discover_dirs() {
  if [ "$#" -gt 0 ]; then
    for dir in "$@"; do
      printf '%s\n' "${dir%/}"
    done
    return
  fi

  find . \
    -path '*/node_modules' -prune -o \
    -path '*/.git' -prune -o \
    -name package.json -type f -print |
    sed 's#/package.json$##' |
    sort
}

json_package_summary() {
  node - "$1" "$2" <<'NODE'
const fs = require("fs");
const [pkgPath, displayPath] = process.argv.slice(2);

function countKeys(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const fields = {
    path: displayPath,
    name: pkg.name || "(unnamed)",
    private: pkg.private === true ? "true" : "false",
    packageManager: pkg.packageManager || "(not declared)",
    dependencies: countKeys(pkg.dependencies),
    devDependencies: countKeys(pkg.devDependencies),
    optionalDependencies: countKeys(pkg.optionalDependencies),
    peerDependencies: countKeys(pkg.peerDependencies),
    overrides: countKeys(pkg.overrides),
    scripts: countKeys(pkg.scripts),
    enginesNode: pkg.engines && pkg.engines.node ? pkg.engines.node : "(not declared)",
  };

  for (const [key, value] of Object.entries(fields)) {
    console.log(`${key}: ${value}`);
  }
} catch (error) {
  console.log(`path: ${displayPath}`);
  console.log("manifest_status: unreadable");
  console.log(`manifest_error: ${error.message}`);
}
NODE
}

audit_summary() {
  node - "$1" "$2" "$3" <<'NODE'
const fs = require("fs");
const [auditPath, errorPath, exitCode] = process.argv.slice(2);

function readText(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function normalizeCounts(metadata = {}) {
  const counts = metadata.vulnerabilities || {};
  return {
    info: counts.info || 0,
    low: counts.low || 0,
    moderate: counts.moderate || 0,
    high: counts.high || 0,
    critical: counts.critical || 0,
    total: counts.total || 0,
  };
}

const raw = readText(auditPath);
const stderr = readText(errorPath)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((line) => !/npm notice/i.test(line));

try {
  const audit = JSON.parse(raw || "{}");
  const counts = normalizeCounts(audit.metadata || {});
  const vulnerabilityNames = Object.keys(audit.vulnerabilities || {}).sort();
  const status = counts.total > 0 ? "vulnerabilities_found" : "clean";
  console.log(`npm_audit_status: ${status}`);
  console.log(`npm_audit_exit_code: ${exitCode}`);
  console.log(
    `vulnerabilities: info=${counts.info} low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical} total=${counts.total}`,
  );

  if (vulnerabilityNames.length > 0) {
    console.log(`affected_packages_count: ${vulnerabilityNames.length}`);
    console.log(`affected_packages_sample: ${vulnerabilityNames.slice(0, 20).join(", ")}`);
  } else {
    console.log("affected_packages_count: 0");
  }

  if (stderr.length > 0) {
    console.log(`npm_stderr_summary: ${stderr.slice(0, 3).join(" | ")}`);
  }
} catch (error) {
  console.log("npm_audit_status: unparseable");
  console.log(`npm_audit_exit_code: ${exitCode}`);
  console.log(`npm_audit_parse_error: ${error.message}`);
  if (stderr.length > 0) {
    console.log(`npm_stderr_summary: ${stderr.slice(0, 3).join(" | ")}`);
  }
}
NODE
}

section "Package Workspaces"

mapfile -t package_dirs < <(discover_dirs "$@")

if [ "${#package_dirs[@]}" -eq 0 ]; then
  printf 'status: no_package_json_found\n'
  exit 0
fi

for dir in "${package_dirs[@]}"; do
  [ -n "${dir}" ] || continue

  display_path="${dir#./}"
  if [ "${display_path}" = "." ]; then
    display_path="."
  fi

  printf '\n### %s\n' "${display_path}"

  pkg_json="${dir}/package.json"
  lock_json="${dir}/package-lock.json"

  if [ ! -f "${pkg_json}" ]; then
    printf 'manifest_status: missing_package_json\n'
    continue
  fi

  if command -v node >/dev/null 2>&1; then
    json_package_summary "${pkg_json}" "${display_path}"
  else
    printf 'path: %s\n' "${display_path}"
    printf 'manifest_status: skipped_node_unavailable\n'
  fi

  if [ -f "${lock_json}" ]; then
    printf 'package_lock: present\n'
  else
    printf 'package_lock: missing\n'
    printf 'npm_audit_status: skipped_missing_lockfile\n'
    continue
  fi

  if ! command -v npm >/dev/null 2>&1; then
    printf 'npm_audit_status: skipped_npm_unavailable\n'
    continue
  fi

  audit_file="$(mktemp)"
  audit_err="$(mktemp)"
  (
    cd "${dir}" &&
      npm audit --package-lock-only --json
  ) >"${audit_file}" 2>"${audit_err}"
  audit_exit="$?"

  if command -v node >/dev/null 2>&1; then
    audit_summary "${audit_file}" "${audit_err}" "${audit_exit}"
  else
    printf 'npm_audit_status: ran_but_summary_skipped_node_unavailable\n'
    printf 'npm_audit_exit_code: %s\n' "${audit_exit}"
  fi

  rm -f "${audit_file}" "${audit_err}"
done

section "Safe Next Steps"
cat <<'EOF'
- Treat any non-clean audit result as evidence for a small dependency PR, not as approval to run npm audit fix.
- Re-run package-specific tests after dependency changes.
- If a workspace has no package-lock.json, decide whether it is intentionally unmanaged before adding one.
- Do not paste environment variables or registry tokens into follow-up tickets.
EOF
