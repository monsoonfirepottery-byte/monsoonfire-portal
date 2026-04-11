#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${STUDIO_BRAIN_TMUX_SESSION_NAME:-studiobrain}"
REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-/home/wuff/monsoonfire-portal}"
STUDIO_BRAIN_DIR="${REPO_ROOT}/studio-brain"
SCRIPTS_DIR="${REPO_ROOT}/scripts"
CONTROL_TOWER_URL="${STUDIO_BRAIN_CONTROL_TOWER_URL:-https://portal.monsoonfire.com/staff/cockpit/control-tower}"

shell_wrap() {
  local inner="$1"
  local wrapped
  printf -v wrapped 'bash -lc %q' "${inner}"
  printf '%s' "${wrapped}"
}

shell_prompt_cmd() {
  local cwd="$1"
  shell_wrap "cd \"${cwd}\" && exec bash"
}

control_recovery_cmd() {
  shell_wrap "cd \"${REPO_ROOT}\" && node ./scripts/studiobrain-cockpit.mjs recovery --url \"${CONTROL_TOWER_URL}\" || true; printf '\nRecovery shell ready. Browser Control Tower stays primary.\n'; exec bash"
}

log_recovery_cmd() {
  shell_wrap "cd \"${REPO_ROOT}\" && printf 'Studio Brain browser-first recovery shell.\nHelpful paths:\n- output/ops-cockpit/operator-state.json\n- output/overseer/latest.json\n- output/overseer/discord/acks.jsonl\n\n'; exec bash"
}

create_session() {
  tmux new-session -d -s "${SESSION_NAME}" -n control -c "${REPO_ROOT}" "$(control_recovery_cmd)"
}

window_exists() {
  tmux list-windows -t "${SESSION_NAME}" -F "#{window_name}" 2>/dev/null | grep -Fxq "$1"
}

ensure_shell_window() {
  local window_name="$1"
  local cwd="$2"
  if ! window_exists "${window_name}"; then
    tmux new-window -t "${SESSION_NAME}" -n "${window_name}" -c "${cwd}" "$(shell_prompt_cmd "${cwd}")"
  fi
}

ensure_log_window() {
  local window_name="$1"
  if ! window_exists "${window_name}"; then
    tmux new-window -t "${SESSION_NAME}" -n "${window_name}" -c "${REPO_ROOT}" "$(log_recovery_cmd)"
  fi
  local first_pane
  first_pane="$(tmux list-panes -t "${SESSION_NAME}:${window_name}" -F "#{pane_id}" | head -n 1)"
  local pane_id
  while IFS= read -r pane_id; do
    if [[ -n "${pane_id}" && "${pane_id}" != "${first_pane}" ]]; then
      tmux kill-pane -t "${pane_id}"
    fi
  done < <(tmux list-panes -t "${SESSION_NAME}:${window_name}" -F "#{pane_id}")
  tmux respawn-pane -k -t "${first_pane}" "$(log_recovery_cmd)"
  tmux clear-history -t "${first_pane}" >/dev/null 2>&1 || true
}

ensure_control_window() {
  if ! window_exists "control"; then
    tmux new-window -t "${SESSION_NAME}" -n control -c "${REPO_ROOT}" "$(control_recovery_cmd)"
  fi

  local first_pane pane_id
  first_pane="$(tmux list-panes -t "${SESSION_NAME}:control" -F "#{pane_id}" | sed -n '1p')"

  while IFS= read -r pane_id; do
    if [[ -n "${pane_id}" && "${pane_id}" != "${first_pane}" ]]; then
      tmux kill-pane -t "${pane_id}"
    fi
  done < <(tmux list-panes -t "${SESSION_NAME}:control" -F "#{pane_id}")

  tmux respawn-pane -k -t "${first_pane}" "$(control_recovery_cmd)"
  tmux clear-history -t "${first_pane}" >/dev/null 2>&1 || true
}

ensure_layout() {
  if ! tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
    create_session
  fi
  ensure_control_window
  ensure_shell_window "brain" "${STUDIO_BRAIN_DIR}"
  ensure_shell_window "scripts" "${SCRIPTS_DIR}"
  ensure_log_window "logs"
  tmux select-window -t "${SESSION_NAME}:control"
}

case "${1:-ensure}" in
  ensure)
    ensure_layout
    echo "present:${SESSION_NAME}"
    ;;
  status)
    if ! tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
      echo "missing:${SESSION_NAME}"
      exit 0
    fi
    tmux list-windows -t "${SESSION_NAME}" -F "#{session_name}:#{window_index}:#{window_name}:#{window_active}:#{window_panes}"
    ;;
  attach)
    ensure_layout
    if [[ -n "${2:-}" ]]; then
      exec tmux attach -t "${2}"
    fi
    exec tmux attach -t "${SESSION_NAME}"
    ;;
  *)
    echo "usage: $0 [ensure|status|attach [session]]" >&2
    exit 1
    ;;
esac
