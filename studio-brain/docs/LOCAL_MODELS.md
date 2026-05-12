# Studio Brain Local Models

Studio Brain runs local LLMs through the `studiobrain_ollama` Docker Compose profile. The service is isolated from any stale host `~/.ollama` state and binds only to `127.0.0.1:11434`.

## Lanes

- `openai.responses`: primary path for normal hosted drafting and production support flows.
- `ollama.chat`: local fallback for missing key, quota, rate limit, timeout, and 5xx failures.
- `local.expression`: private expression sandbox. This lane may draft candid or sensitive private text, but it has no tools, secrets, approvals, external writes, or publish authority.

## Models

- Default orchestrator: `gemma4:e4b`
- Heavy fallback: `qwen3.6:27b`
- Private expression sandbox: `fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M`
- Optional structured fallback for later benchmarking: `ibm/granite4.1:8b`

## Start Fresh

From `studio-brain/` on the Studio Brain host:

```bash
./scripts/local-models-clean-start.sh
```

The script backs up and removes `~/.ollama/config.json`, starts the Compose profile, pulls the selected models, runs smoke prompts, and checks that port `11434` is not listening on LAN interfaces.

Manual start:

```bash
docker compose --profile local-models up -d studiobrain_ollama
docker compose --profile local-models exec -T studiobrain_ollama ollama pull gemma4:e4b
docker compose --profile local-models exec -T studiobrain_ollama ollama pull qwen3.6:27b
docker compose --profile local-models exec -T studiobrain_ollama ollama pull fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M
curl http://127.0.0.1:11434/api/version
```

Do not delete the stale host `ollama` user/group during this first rollout. On the current host, UID/GID `999` can map live Docker Postgres processes to that name.

## Environment

Set these in the Studio Brain runtime environment when enabling local models:

```dotenv
STUDIO_BRAIN_OLLAMA_BASE_URL=http://127.0.0.1:11434
STUDIO_BRAIN_OLLAMA_DEFAULT_MODEL=gemma4:e4b
STUDIO_BRAIN_OLLAMA_HEAVY_MODEL=qwen3.6:27b
STUDIO_BRAIN_OLLAMA_EXPRESSION_MODEL=fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:IQ2_M
STUDIO_BRAIN_LLM_FALLBACK_ON=missing_key,quota,rate_limit,timeout,5xx
STUDIO_BRAIN_LOCAL_EXPRESSION_ENABLED=true
STUDIO_BRAIN_LOCAL_EXPRESSION_ALLOW_PUBLISH=false
```

The raw Hugging Face `hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ2_M` tag currently pulls but does not load under Ollama `0.23.2` on the Studio Brain host because the GGUF path hits `unknown model architecture: 'qwen35'`. The selected Ollama-library expression model is a bridge-patched Qwen3.6 uncensored variant and is the runtime default until raw HF GGUF support catches up.

`/health/dependencies` reports Ollama reachability, selected models, loaded models, and fallback readiness whenever Ollama is explicitly configured or local expression/orchestrator mode is enabled.
