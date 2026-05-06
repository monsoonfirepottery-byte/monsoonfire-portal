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

section "Healthcheck Coverage"
if [ -n "${ids}" ]; then
  docker inspect -f '{{.Name}} healthcheck={{if .Config.Healthcheck}}configured{{else}}missing{{end}} state_health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} status={{.State.Status}} image={{.Config.Image}}' ${ids} 2>&1 || true
else
  echo "no containers"
fi

section "Restart Policy Coverage"
if [ -n "${ids}" ]; then
  docker inspect -f '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} maximum_retry={{.HostConfig.RestartPolicy.MaximumRetryCount}} status={{.State.Status}} started_at={{.State.StartedAt}} finished_at={{.State.FinishedAt}}' ${ids} 2>&1 || true
else
  echo "no containers"
fi

section "Resource Visibility"
if [ -n "${ids}" ]; then
  docker inspect -f '{{.Name}} cpus_nano={{.HostConfig.NanoCpus}} memory_bytes={{.HostConfig.Memory}} memory_reservation_bytes={{.HostConfig.MemoryReservation}} pids_limit={{.HostConfig.PidsLimit}} oom_kill_disable={{.HostConfig.OomKillDisable}}' ${ids} 2>&1 || true
else
  echo "no containers"
fi

section "Docker Space"
run_shell "docker system df"
run_shell "docker system df -v 2>/dev/null | sed -n '1,220p' || true"

section "Dangling Images"
run_shell "docker images -f dangling=true --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}'"

section "Exited Containers"
run_shell "docker ps -a -f status=exited --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"

section "Volumes"
run_shell "docker volume ls"

section "Volume Ownership Map"
if [ -n "${ids}" ]; then
  run_shell "for id in \$(docker ps -aq); do docker inspect -f '{{.Name}} {{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}' \"\$id\"; done"
else
  echo "no containers"
fi

section "Volume Details"
volumes="$(docker volume ls -q 2>/dev/null || true)"
if [ -n "${volumes}" ]; then
  docker volume inspect -f '{{.Name}} driver={{.Driver}} mountpoint={{.Mountpoint}} labels={{json .Labels}}' ${volumes} 2>&1 || true
else
  echo "no volumes"
fi

section "Docker Log Size Hints"
run_shell "if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then sudo -n find /var/lib/docker/containers -name '*-json.log' -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 40; else echo 'docker log paths require sudo or are unavailable'; fi"

section "Networks"
run_shell "docker network ls"
