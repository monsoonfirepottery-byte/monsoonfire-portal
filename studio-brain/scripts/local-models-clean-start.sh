#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_MODEL="${STUDIO_BRAIN_OLLAMA_DEFAULT_MODEL:-gemma4:e4b}"
HEAVY_MODEL="${STUDIO_BRAIN_OLLAMA_HEAVY_MODEL:-qwen3.6:27b}"
EXPRESSION_MODEL="${STUDIO_BRAIN_OLLAMA_EXPRESSION_MODEL:-fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M}"
OLLAMA_NUM_THREAD="${STUDIO_BRAIN_OLLAMA_NUM_THREAD:-2}"
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

smoke_model() {
  local model="$1"
  local expected="$2"
  local payload

  payload="$(printf '{"model":%s,"prompt":%s,"stream":false,"think":false,"options":{"num_predict":24,"num_ctx":256,"num_thread":%s,"temperature":0}}' \
    "$(printf '%s' "$model" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "Reply with exactly: $expected" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$OLLAMA_NUM_THREAD")"
  printf 'Smoke prompt for %s\n' "$model"
  response="$(printf '%s' "$payload" | curl -fsS --max-time 420 http://127.0.0.1:11434/api/generate \
    -H 'Content-Type: application/json' \
    -d @- \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("response", "").strip())')"
  if [[ "$response" != "$expected" ]]; then
    printf 'ERROR: smoke prompt for %s returned %q, expected %q\n' "$model" "$response" "$expected" >&2
    exit 1
  fi
}

smoke_model "$DEFAULT_MODEL" "studio brain local model ready"
smoke_model "$HEAVY_MODEL" "studio brain heavy fallback ready"
smoke_model "$EXPRESSION_MODEL" "studio brain private expression ready"

if command -v ss >/dev/null 2>&1; then
  if ss -ltn '( sport = :11434 )' | awk 'NR > 1 {print $4}' | grep -Ev '(^127\.0\.0\.1:11434$|^\[::1\]:11434$)' >/dev/null; then
    printf 'ERROR: port 11434 appears to be exposed beyond loopback.\n' >&2
    ss -ltn '( sport = :11434 )' >&2
    exit 1
  fi
fi

printf 'Studio Brain local models are ready on loopback-only Ollama.\n'
