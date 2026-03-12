.PHONY: dev-up dev-down dev-logs dev-reset healthcheck infra-validate infra-healthcheck ops-up ops-down ops-status ops-reset proxy-up proxy-down proxy-status security-up security-down security-status security-scan security-host-audit security-root-print secret-rotate

COMPOSE := docker compose
ENV_FILE ?= $(if $(wildcard .env),.env,.env.example)

# Start local backend dependencies (postgres/redis/minio). Use `make dev-up` then `npm run dev`.
dev-up:
	$(COMPOSE) --env-file $(ENV_FILE) up -d

# Stop and remove containers.
dev-down:
	$(COMPOSE) --env-file $(ENV_FILE) down

# Tail container logs while developing.
dev-logs:
	$(COMPOSE) --env-file $(ENV_FILE) logs -f

# Reset local stack storage and network state. This is destructive and asks for confirmation.
dev-reset:
	@read -r -p "Reset will remove all postgres/redis/minio data and container state. Continue? [y/N] " confirm; \
	if [ "$$confirm" != "y" ] && [ "$$confirm" != "Y" ]; then \
		echo "reset cancelled"; exit 1; \
	fi
	$(COMPOSE) --env-file $(ENV_FILE) down -v --remove-orphans

# Validate compose syntax and required services.
infra-validate:
	$(COMPOSE) --env-file $(ENV_FILE) -f docker-compose.yml config

# Run full dependency healthcheck in table or JSON mode.
healthcheck:
	npm run healthcheck

# Alias kept for parity with task naming.
infra-healthcheck:
	npm run healthcheck -- --output json

# Start optional observability profile + one-shot heartbeat capture.
ops-up:
	node ../scripts/studiobrain-observability-bundle.mjs up

# Stop optional observability profile.
ops-down:
	node ../scripts/studiobrain-observability-bundle.mjs down

# Print observability profile status.
ops-status:
	node ../scripts/studiobrain-observability-bundle.mjs status

# Reset local observability artifacts (output/stability, output/incidents, output/ops-cockpit, output/otel).
ops-reset:
	node ../scripts/studiobrain-observability-bundle.mjs reset --yes-i-know --reason make-ops-reset

# Start optional reverse proxy profile.
proxy-up:
	node ../scripts/studiobrain-proxy-bundle.mjs up

# Stop optional reverse proxy profile.
proxy-down:
	node ../scripts/studiobrain-proxy-bundle.mjs down

# Print optional reverse proxy profile status.
proxy-status:
	node ../scripts/studiobrain-proxy-bundle.mjs status

# Start optional security profile.
security-up:
	node ../scripts/studiobrain-security-bundle.mjs up

# Stop optional security profile.
security-down:
	node ../scripts/studiobrain-security-bundle.mjs down

# Print optional security profile status.
security-status:
	node ../scripts/studiobrain-security-bundle.mjs status

# Run one-shot security scan bundle.
security-scan:
	node ../scripts/studiobrain-security-bundle.mjs scan

# Print root-required host hardening gaps without applying them.
security-host-audit:
	node ../scripts/studiobrain-host-hardening-audit.mjs

# Print the root-run hardening command and resolved defaults.
security-root-print:
	node ../scripts/studiobrain-root-hardening.mjs --print

# Rotate Postgres / Redis / MinIO credentials for the local env.
secret-rotate:
	node ../scripts/studiobrain-secret-rotate.mjs --apply
