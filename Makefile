SHELL := /bin/bash

PG_CONTAINER ?= studiobrain_postgres
PGDATABASE ?= monsoonfire_studio_os

.PHONY: ops-check ops-inventory ops-postgres-review ops-postgres-sql ops-postgres-top-queries ops-postgres-query-tasks ops-postgres-growth-snapshot ops-postgres-autovacuum-stats ops-postgres-roles-extensions ops-docker-review ops-docker-posture ops-docker-tag-policy ops-capacity ops-import-pressure ops-cleanup-candidates ops-backup-evidence ops-postgres-backup-artifacts ops-restore-prereq ops-redis-minio-backup-evidence ops-db-docker-backup-rollup ops-command-surface-guard ops-command-manifest ops-output-retention ops-ubuntu-review ops-host-failed-unit-trends ops-package-posture ops-time-sync ops-network-review ops-host-drift ops-systemd-drift ops-portal-bridge-review ops-app-review ops-dependency-review ops-dependency-cadence ops-dependency-security-scout ops-dependency-remediation-packet ops-dependency-upstream-watch ops-dependency-zero-baseline ops-idle-worker-effectivity ops-effectivity-report ops-evidence-freshness ops-slice-ledger ops-tool-inventory ops-admin-effectivity-audit ops-proactive-radar ops-next-slice-selector ops-pr-stack-readiness ops-pr-conflict-packets ops-privileged-evidence-read ops-privileged-evidence-capture ops-privileged-evidence-capture-smoke ops-work-packet ops-incident-bundle ops-incident-bundle-v2 ops-ci-validate ops-post-deploy-verify ops-docs ops-backlog ops-report

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

ops-postgres-sql:
	@if [ -z "$(SQL)" ]; then \
		echo "Set SQL=scripts/ops/<review>.sql"; \
		exit 1; \
	elif command -v psql >/dev/null 2>&1; then \
		psql -X -v ON_ERROR_STOP=1 -f "$(SQL)"; \
	elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx '$(PG_CONTAINER)'; then \
		docker exec -i -u postgres $(PG_CONTAINER) psql -d $(PGDATABASE) -X -v ON_ERROR_STOP=1 < "$(SQL)"; \
	else \
		echo "No local psql connection or $(PG_CONTAINER) container found. Set PG* env vars or run on the Studio Brain host."; \
	fi

ops-postgres-top-queries:
	$(MAKE) ops-postgres-sql SQL=scripts/ops/postgres_pg_stat_statements_rollup.sql

ops-postgres-query-tasks:
	$(MAKE) ops-postgres-sql SQL=scripts/ops/postgres_query_hotspot_issue_generator.sql

ops-postgres-growth-snapshot:
	$(MAKE) ops-postgres-sql SQL=scripts/ops/postgres_db_growth_trend_snapshot.sql

ops-postgres-autovacuum-stats:
	$(MAKE) ops-postgres-sql SQL=scripts/ops/postgres_autovacuum_stale_stats_report.sql

ops-postgres-roles-extensions:
	$(MAKE) ops-postgres-sql SQL=scripts/ops/postgres_roles_extensions_security_packet.sql

ops-docker-review:
	bash scripts/ops/docker_inventory.sh

ops-docker-posture:
	bash scripts/ops/docker_posture_review.sh

ops-docker-tag-policy:
	node scripts/ops/docker_floating_tag_policy.mjs --write

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

ops-postgres-backup-artifacts:
	bash scripts/ops/backup_postgres_artifact_verifier.sh

ops-restore-prereq:
	bash scripts/ops/backup_restore_prerequisite_drill.sh

ops-redis-minio-backup-evidence:
	bash scripts/ops/redis_minio_evidence_verifier.sh

ops-db-docker-backup-rollup:
	node scripts/ops/db_docker_backup_rollup.mjs --write

ops-command-surface-guard:
	node scripts/ops/command_surface_guard.mjs --write

ops-command-manifest:
	node scripts/ops/ops_command_manifest.mjs --write

ops-output-retention:
	node scripts/ops/output_retention_scanner.mjs --write

ops-ubuntu-review:
	bash scripts/ops/ubuntu_failed_units.sh

ops-host-failed-unit-trends:
	bash scripts/ops/host_failed_unit_trends.sh

ops-package-posture:
	bash scripts/ops/host_package_posture.sh

ops-time-sync:
	bash scripts/ops/time_sync_posture.sh

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

ops-dependency-cadence:
	node scripts/ops/dependency_cadence_packet.mjs --refresh --write

ops-dependency-security-scout:
	node scripts/ops/dependency_security_scout.mjs --write

ops-dependency-remediation-packet:
	node scripts/ops/dependency_remediation_packet.mjs --write

ops-dependency-upstream-watch:
	node scripts/ops/dependency_upstream_watch.mjs --write

ops-dependency-zero-baseline:
	node scripts/ops/dependency_zero_baseline_guard.mjs --write

ops-idle-worker-effectivity:
	node ./scripts/studiobrain-idle-worker-effectivity-audit.mjs --json

ops-effectivity-report:
	bash scripts/ops/effectivity_report.sh

ops-evidence-freshness:
	node scripts/ops/evidence_freshness_guard.mjs --write

ops-slice-ledger:
	node scripts/ops/slice_ledger.mjs --summary --last 5

ops-tool-inventory:
	node scripts/ops/installed_tool_inventory.mjs --write

ops-admin-effectivity-audit:
	node scripts/ops/admin_effectivity_audit.mjs --write

ops-proactive-radar:
	node scripts/ops/proactive_issue_radar.mjs --write

ops-next-slice-selector:
	node scripts/ops/next_slice_selector.mjs --refresh --write

ops-pr-stack-readiness:
	node scripts/ops/pr_stack_readiness.mjs --write

ops-pr-conflict-packets:
	node scripts/ops/pr_conflict_packets.mjs --refresh --write

ops-privileged-evidence-read:
	bash scripts/ops/privileged_evidence_read.sh

ops-privileged-evidence-capture:
	bash scripts/ops/privileged_evidence_capture.sh --output-dir output/ops/privileged-evidence

ops-privileged-evidence-capture-smoke:
	bash scripts/ops/privileged_evidence_capture.sh --smoke --output-dir output/ops/privileged-evidence

ops-work-packet:
	node ./scripts/studiobrain-ops-work-packet.mjs --write

ops-incident-bundle:
	bash scripts/ops/incident_bundle.sh

ops-incident-bundle-v2:
	bash scripts/ops/incident_bundle_v2.sh

ops-ci-validate:
	bash scripts/ops/ops_ci_validate.sh

ops-post-deploy-verify:
	bash scripts/ops/post_deploy_verify.sh

ops-docs:
	@sed -n '1,220p' docs/ops/README.md

ops-backlog:
	@sed -n '1,260p' docs/ops/02-kanban-backlog.md

ops-report:
	bash scripts/ops/generate_ops_report.sh
