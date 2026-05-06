#!/usr/bin/env bash
set -u

# Read-only dependency inventory for Studio Brain operations.

section() {
  printf '\n## %s\n' "$1"
}

version_of() {
  name="$1"
  shift
  if command -v "${name}" >/dev/null 2>&1; then
    printf '%s: ' "${name}"
    "$@" 2>&1 | head -n 1
  else
    printf '%s: not installed\n' "${name}"
  fi
}

section "Command Versions"
version_of git git --version
version_of node node --version
version_of npm npm --version
version_of python3 python3 --version
version_of docker docker --version
version_of psql psql --version
version_of tmux tmux -V
version_of mosh mosh --version
version_of ansible ansible --version
version_of curl curl --version
version_of systemctl systemctl --version

section "Repo Scripts"
if [ -f package.json ] && command -v node >/dev/null 2>&1; then
  node - <<'NODE'
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const name of Object.keys(pkg.scripts || {}).sort()) {
  if (/studio|ops|docker|backup|wiki|memory|doctor|status|deploy/i.test(name)) {
    console.log(`${name}: ${pkg.scripts[name]}`);
  }
}
NODE
else
  echo "package.json or node unavailable"
fi

section "Studio Brain Package Scripts"
if [ -f studio-brain/package.json ] && command -v node >/dev/null 2>&1; then
  node - <<'NODE'
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("studio-brain/package.json", "utf8"));
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  console.log(`${name}: ${command}`);
}
NODE
else
  echo "studio-brain/package.json or node unavailable"
fi
