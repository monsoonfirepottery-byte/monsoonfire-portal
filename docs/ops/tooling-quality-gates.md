# Studio Brain Ops Tooling Quality Gates

This packet turns the research swarm recommendations into read-only, auditable tooling checks. The goal is not to block every style issue immediately; the goal is to measure which tools actually prevent broken administrator infrastructure.

## Command

```bash
node scripts/ops/tooling_quality_report.mjs --mode all --json --write
node scripts/ops/installed_tool_inventory.mjs --json --write
node scripts/ops/tool_install_recommendations.mjs --json --write
```

The report writes ignored artifacts under `output/ops/tooling-quality/`.
The inventory and install recommendation reports write ignored artifacts under `output/ops/effectivity/`.
Optional validators can be exercised explicitly after a tool usefulness audit:

```bash
node scripts/ops/tooling_quality_report.mjs --mode all --allow-install --json --write
```

The Makefile wrapper keeps installs off by default. Use `make ops-tooling-quality OPS_TOOLING_QUALITY_FLAGS=--allow-install` when the operator wants ephemeral `npx`/`uv` validators included in the report.

## Modes

- `shell-lf`: scans tracked `.sh` files for CRLF bytes. This is the first gate to promote because Ubuntu scripts should be LF-only.
- `shellcheck`: runs `shellcheck -f json -S warning` when installed. With `--allow-install`, it can use `npx --yes shellcheck` and stores structured file/line/code findings.
- `powershell`: parses tracked `.ps1` files with `pwsh` or Windows PowerShell.
- `sqlfluff`: runs PostgreSQL parser checks when `sqlfluff` is installed. With `--allow-install`, it can use `uv tool run --from sqlfluff`.
- `actionlint`: validates tracked GitHub Actions workflow YAML when `actionlint` is installed. With `--allow-install`, it can use `go run github.com/rhysd/actionlint/cmd/actionlint@latest` if Go is available.
- `compose-config`: renders tracked Docker Compose files with `docker compose config --quiet` when Docker is installed. This validates configuration only; it does not pull images, start services, restart containers, prune artifacts, or contact the Docker daemon for lifecycle changes.

## Promotion Rule

Keep new validators report-only until they prove useful over about five slices:

1. Count actionable findings fixed.
2. Count false positives or style-only noise.
3. Count coverage gaps separately when a validator is missing; a missing tool is useful evidence, but it is not a caught defect and should not claim minutes saved.
4. Record whether the check prevented a broken script, failed CI run, unsafe recommendation, or operator confusion.
5. Promote to required only after it catches real defects with tolerable noise.

## Current Expected Findings

The first local inventory found required tools present, but optional Docker, make, ShellCheck, gitleaks, sqlfluff, actionlint, and shfmt were missing. The tooling quality report should therefore treat missing Docker/Compose, ShellCheck, SQLFluff, or actionlint as `skipped` unless a useful local install path is explicit.

The first useful signal from this gate was not theoretical: ShellCheck and the LF guard both surfaced CRLF bytes in Ubuntu-targeted shell scripts. Treat that as a follow-up cleanup slice with reviewable line-ending policy, not as an automatic broad rewrite.

Use `tool-install-recommendations-latest.json` as the install decision surface. It can recommend ephemeral report-only runs for tools such as ShellCheck or SQLFluff, while classifying Docker as a host/remote-lane gap and unmodeled tools such as gitleaks or shfmt as not yet justified.

The tooling quality summary uses `findings`/`actionableFindings` for defect-like rows and `coverageGaps` for missing validators. `rawFindings` remains available for row accounting, but it should not be used as the defect count.
