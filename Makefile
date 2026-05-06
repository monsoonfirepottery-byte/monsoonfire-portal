SHELL := /bin/bash

PG_CONTAINER ?= studiobrain_postgres
PGDATABASE ?= monsoonfire_studio_os

.PHONY: ops-check ops-inventory ops-postgres-review ops-docker-review ops-capacity ops-backup-evidence ops-backlog ops-report

ops-check: ops-inventory ops-docker-review ops-capacity ops-backup-evidence

ops-inventory:
	bash scripts/ops/system_inventory.sh

ops-postgres-review:
	@if command -v psql >/dev/null 2>&1; then \
		psql -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_readonly_review.sql; \
	elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx '$(PG_CONTAINER)'; then \
		docker exec -i -u postgres $(PG_CONTAINER) psql -d $(PGDATABASE) -X -v ON_ERROR_STOP=1 < scripts/ops/postgres_readonly_review.sql; \
	else \
		echo "No local psql connection or $(PG_CONTAINER) container found. Set PG* env vars or run on the Studio Brain host."; \
	fi

ops-docker-review:
	bash scripts/ops/docker_inventory.sh

ops-capacity:
	bash scripts/ops/disk_pressure.sh
	bash scripts/ops/log_pressure.sh

ops-backup-evidence:
	bash scripts/ops/backup_evidence.sh

ops-backlog:
	@sed -n '1,260p' docs/ops/02-kanban-backlog.md

ops-report:
	bash scripts/ops/generate_ops_report.sh
