#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_MODEL="${STUDIO_BRAIN_OLLAMA_DEFAULT_MODEL:-gemma4:e4b}"
HEAVY_MODEL="${STUDIO_BRAIN_OLLAMA_HEAVY_MODEL:-qwen3.6:27b}"
EXPRESSION_MODEL="${STUDIO_BRAIN_OLLAMA_EXPRESSION_MODEL:-hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ2_M}"
CONFIG_PATH="$HOME/.ollama/config.json"

if [[ -f "$CONFIG_PATH" ]]; then
  backup_dir="$HOME/.ollama-backups"
  mkdir -p "$backup_dir"
  backup_path="$backup_dir/config.json.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$CONFIG_PATH" "$backup_path"
  printf 'Backed up stale host Ollama config to %s\n' "$backup_path"
fi

docker compose --profile local-models up -d studiobrain_ollama

for model in "$DEFAULT_MODEL" "$HEAVY_MODEL" "$EXPRESSION_MODEL"; do
  printf 'Pulling %s\n' "$model"
  docker compose --profile local-models exec -T studiobrain_ollama ollama pull "$model"
done

curl -fsS http://127.0.0.1:11434/api/version >/dev/null

for model in "$DEFAULT_MODEL" "$HEAVY_MODEL" "$EXPRESSION_MODEL"; do
  printf 'Smoke prompt for %s\n' "$model"
  docker compose --profile local-models exec -T studiobrain_ollama ollama run "$model" "Reply with exactly: studio brain local model ready" | head -n 5
done

if command -v ss >/dev/null 2>&1; then
  if ss -ltn '( sport = :11434 )' | awk 'NR > 1 {print $4}' | grep -Ev '(^127\.0\.0\.1:11434$|^\[::1\]:11434$)' >/dev/null; then
    printf 'ERROR: port 11434 appears to be exposed beyond loopback.\n' >&2
    ss -ltn '( sport = :11434 )' >&2
    exit 1
  fi
fi

printf 'Studio Brain local models are ready on loopback-only Ollama.\n'
