SHELL := /bin/bash

PG_CONTAINER ?= studiobrain_postgres
PGDATABASE ?= monsoonfire_studio_os

.PHONY: ops-check ops-inventory ops-postgres-review ops-docker-review ops-capacity ops-import-pressure ops-cleanup-candidates ops-backup-evidence ops-ubuntu-review ops-network-review ops-host-drift ops-systemd-drift ops-portal-bridge-review ops-app-review ops-dependency-review ops-incident-bundle ops-docs ops-backlog ops-report

ops-check: ops-inventory ops-docker-review ops-capacity ops-cleanup-candidates ops-backup-evidence ops-ubuntu-review ops-network-review ops-host-drift ops-systemd-drift ops-portal-bridge-review ops-app-review

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
	bash scripts/ops/import_pressure.sh

ops-import-pressure:
	bash scripts/ops/import_pressure.sh

ops-cleanup-candidates:
	bash scripts/ops/cleanup_candidates.sh

ops-backup-evidence:
	bash scripts/ops/backup_evidence.sh

ops-ubuntu-review:
	bash scripts/ops/ubuntu_failed_units.sh

ops-network-review:
	bash scripts/ops/network_exposure_review.sh

ops-host-drift:
	bash scripts/ops/host_drift_inventory.sh

ops-systemd-drift:
	bash scripts/ops/systemd_drift_review.sh

ops-portal-bridge-review:
	bash scripts/ops/portal_bridge_review.sh

ops-app-review:
	bash scripts/ops/app_status_review.sh

ops-dependency-review:
	bash scripts/ops/npm_audit_inventory.sh

ops-incident-bundle:
	bash scripts/ops/incident_bundle.sh

ops-docs:
	@sed -n '1,220p' docs/ops/README.md

ops-backlog:
	@sed -n '1,260p' docs/ops/02-kanban-backlog.md

ops-report:
	bash scripts/ops/generate_ops_report.sh
