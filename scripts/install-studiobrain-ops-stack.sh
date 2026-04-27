#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAYBOOK_PATH="${REPO_ROOT}/config/studiobrain/ansible/studio-brain-host-stack.yml"

export DEBIAN_FRONTEND=noninteractive
export STUDIO_BRAIN_REMOTE_PARENT="${STUDIO_BRAIN_REMOTE_PARENT:-${REPO_ROOT}}"

if [[ ! -f "${PLAYBOOK_PATH}" ]]; then
  echo "Missing Ansible playbook: ${PLAYBOOK_PATH}" >&2
  exit 1
fi

if ! command -v ansible-playbook >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ansible
fi

ansible-playbook -i localhost, -c local "${PLAYBOOK_PATH}"
bash "${REPO_ROOT}/scripts/install-studiobrain-healthcheck.sh"
bash "${REPO_ROOT}/scripts/install-studiobrain-monitoring.sh"
bash "${REPO_ROOT}/scripts/install-studiobrain-memory-ops.sh"
