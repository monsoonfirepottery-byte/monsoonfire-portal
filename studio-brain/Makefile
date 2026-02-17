.PHONY: dev-up dev-down dev-logs dev-reset healthcheck infra-validate infra-healthcheck

COMPOSE := docker compose
ENV_FILE ?= .env

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
