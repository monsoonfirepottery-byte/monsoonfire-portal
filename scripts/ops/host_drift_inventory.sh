#!/usr/bin/env bash
set -u

# Read-only live checkout drift inventory for Studio Brain.
# This script does not reset, clean, checkout, stash, delete, or modify files.
# It prints paths and Git metadata only; it never prints file contents or environment values.

TARGET_REPO="${1:-${TARGET_REPO:-/home/wuff/monsoonfire-portal}}"

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

git_in_repo() {
  local command_text="$1"
  printf '\n$ git -C %s %s\n' "${TARGET_REPO}" "${command_text}"
  git -C "${TARGET_REPO}" ${command_text} 2>&1 || printf 'WARN: git command failed: git -C %s %s\n' "${TARGET_REPO}" "${command_text}"
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'target_repo: %s\n' "${TARGET_REPO}"
printf 'scope: read_only_live_checkout_drift_inventory\n'
printf 'safety: no_reset_no_clean_no_checkout_no_stash_no_delete_no_file_contents\n'

if ! git -C "${TARGET_REPO}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'Target repo does not look like a Git checkout: %s\n' "${TARGET_REPO}"
  printf 'Set TARGET_REPO or pass a repo path as the first argument.\n'
  exit 0
fi

section "Repository Identity"
git_in_repo "rev-parse --show-toplevel"
git_in_repo "rev-parse --short HEAD"
git_in_repo "branch --show-current"
run_shell "git -C '${TARGET_REPO}' remote -v | sed -E 's#(https?://)([^/@]+@)#\\1REDACTED@#g'"
run_shell "git -C '${TARGET_REPO}' status --short --branch | sed -n '1,220p'; total=\$(git -C '${TARGET_REPO}' status --porcelain=v1 --untracked-files=all | wc -l | awk '{print \$1}'); if [ \"\${total:-0}\" -gt 219 ]; then echo \"... status output truncated; dirty_or_untracked_paths=\${total}\"; fi"

section "Upstream And Branch State"
run_shell "branch_ref=\$(git -C '${TARGET_REPO}' symbolic-ref -q HEAD 2>/dev/null || true); upstream=\$(git -C '${TARGET_REPO}' for-each-ref --format='%(upstream:short)' \"\$branch_ref\" 2>/dev/null || true); if [ -n \"\$upstream\" ]; then if git -C '${TARGET_REPO}' show-ref --verify --quiet \"refs/remotes/\$upstream\"; then echo \"\$upstream\"; else echo \"\$upstream (gone_or_not_fetched)\"; fi; else echo 'upstream_unavailable_or_gone'; fi"
run_shell "git -C '${TARGET_REPO}' branch -vv | sed -n '1,120p'"
run_shell "branch_ref=\$(git -C '${TARGET_REPO}' symbolic-ref -q HEAD 2>/dev/null || true); upstream=\$(git -C '${TARGET_REPO}' for-each-ref --format='%(upstream:short)' \"\$branch_ref\" 2>/dev/null || true); if [ -n \"\$upstream\" ] && git -C '${TARGET_REPO}' show-ref --verify --quiet \"refs/remotes/\$upstream\"; then git -C '${TARGET_REPO}' rev-list --left-right --count HEAD...\"\$upstream\"; else echo 'ahead_behind_unavailable_or_upstream_gone'; fi"
run_shell "git -C '${TARGET_REPO}' log --oneline --decorate -n 12 2>/dev/null || true"

section "Dirty Counts"
run_shell "git -C '${TARGET_REPO}' status --porcelain=v1 --untracked-files=all | awk '{code=substr(\$0,1,2); counts[code]++} END {if (length(counts)==0) print \"clean\"; else for (code in counts) print counts[code], code}' | sort"
run_shell "git -C '${TARGET_REPO}' status --porcelain=v1 --untracked-files=all | wc -l | awk '{print \"dirty_or_untracked_paths=\" \$1}'"

section "Dirty Path Classification"
run_shell "git -C '${TARGET_REPO}' status --porcelain=v1 --untracked-files=all | awk 'function classify(path) { low=tolower(path); if (low ~ /(^|\\/)(\\.env|\\.env\\.|id_rsa|id_ed25519|secrets?|credentials?|firebase|service-account|private-key)/ || low ~ /\\.(pem|key|p12|pfx|kdbx)$/) return \"sensitive_path_name\"; if (low ~ /^(output|dist|build|coverage|\\.next|node_modules|tmp|logs|\\.turbo|\\.cache)\\// || low ~ /\\.(log|tmp|cache|tgz|zip|gz)$/) return \"generated_or_artifact\"; if (low ~ /(^|\\/)(\\.gitignore|makefile|dockerfile|caddyfile(\\..*)?)$/ || low ~ /(^|\\/)(compose|docker-compose)\\./ || low ~ /\\.(md|ts|tsx|js|jsx|mjs|cjs|json|sql|sh|ps1|yml|yaml|toml|css|html|py|service|timer|conf)$/) return \"source_or_config\"; return \"unknown\" } {code=substr(\$0,1,2); path=substr(\$0,4); class=classify(path); counts[class]++; rows++; if (rows <= 240) print code \"\\t\" class \"\\t\" path} END {if (rows > 240) print \"... path classification truncated; total_paths=\" rows; print \"--- classification_counts ---\"; for (class in counts) print counts[class], class}'"

section "Potential Large Generated Directories"
run_shell "cd '${TARGET_REPO}' && du -sh output dist build coverage .next node_modules .turbo .cache logs tmp 2>/dev/null | sort -h || true"

section "Recent Git Context"
run_shell "git -C '${TARGET_REPO}' show --stat --oneline --decorate --no-renames --max-count=1 HEAD 2>/dev/null || true"
run_shell "git -C '${TARGET_REPO}' diff --name-status --stat 2>/dev/null | sed -n '1,180p'"
run_shell "git -C '${TARGET_REPO}' diff --cached --name-status --stat 2>/dev/null | sed -n '1,180p'"

section "Cleanup Candidate Classification"
cat <<'EOF'
Use this table to decide what can happen next. Do not act from this report alone.

| Candidate | Classification | Why | Approval gate |
| --- | --- | --- | --- |
| Generated build/test/report outputs | safe with backup | Usually reproducible, but may contain useful evidence | human review of manifest first |
| Dirty source/config/docs | requires human approval | May be live hotfixes, generated edits, or uncommitted operator work | inspect diff and preserve branch before cleanup |
| Sensitive path names | do not touch automatically | May be env files, private keys, credentials, or service accounts | security review only |
| Gone upstream branch | requires human approval | Reset/rebase can discard live-only work | create backup branch or patch bundle first |
| Unknown/unclassified files | requires human approval | Intent and reproducibility are unknown | owner classification first |
EOF

section "Safe Next Steps"
cat <<'EOF'
1. Save this report with restricted permissions.
2. Create a backup branch or patch bundle before any cleanup.
3. Review dirty source/config diffs locally; do not paste secrets or env values into tickets.
4. Classify generated artifacts separately from operator-authored source changes.
5. Only after approval, remove or archive generated artifacts in a small PR or maintenance window.
EOF
