#!/usr/bin/env bash
set -u

# Read-only Docker inventory. Intentionally avoids printing container env vars.

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not available"
  exit 0
fi

section "Docker Version"
run_shell "docker version --format json 2>/dev/null || docker version"
run_shell "docker compose version 2>/dev/null || true"

section "Compose Projects"
run_shell "docker compose ls 2>/dev/null || true"

section "Running Containers"
run_shell "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'"

section "All Containers"
run_shell "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"

section "Container Policies"
ids="$(docker ps -aq 2>/dev/null || true)"
if [ -n "${ids}" ]; then
  docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} log={{.HostConfig.LogConfig.Type}} user={{.Config.User}} mounts={{len .Mounts}}' ${ids} 2>&1 || true
else
  echo "no containers"
fi

section "Docker Space"
run_shell "docker system df"

section "Dangling Images"
run_shell "docker images -f dangling=true --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}'"

section "Exited Containers"
run_shell "docker ps -a -f status=exited --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"

section "Volumes"
run_shell "docker volume ls"

section "Networks"
run_shell "docker network ls"
