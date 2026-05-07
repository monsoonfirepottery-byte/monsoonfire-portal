# Studio Brain Ops Tooling Quality Gates

This packet turns the research swarm recommendations into read-only, auditable tooling checks. The goal is not to block every style issue immediately; the goal is to measure which tools actually prevent broken administrator infrastructure.

## Command

```bash
node scripts/ops/tooling_quality_report.mjs --mode all --json --write
```

Windows-friendly npm wrappers:

```bash
npm run ops:tooling-quality
npm run ops:tooling-quality:allow-install
npm run ops:ci-validate
```

The report writes ignored artifacts under `output/ops/tooling-quality/`.
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

## Workflow Validation

Use pinned `actionlint` release binaries for GitHub workflow checks. The npm package name is not the official rhysd actionlint distribution and should not be used as an install path.

- CI path: use the official `download-actionlint.bash` script pinned to an explicit version.
- Windows local no-install path: download the pinned release with `gh release download`, verify attestation with `gh attestation verify`, expand to `%TEMP%`, and run `actionlint.exe`.
- Persistent Windows path: `winget install --id rhysd.actionlint --exact`.
- Avoid for this repo: `npx actionlint`, `go install` without Go already present, or Docker-based actionlint when Docker is unavailable locally.

## Promotion Rule

Keep new validators report-only until they prove useful over about five slices:

1. Count actionable findings fixed.
2. Count false positives or style-only noise.
3. Record whether the check prevented a broken script, failed CI run, unsafe recommendation, or operator confusion.
4. Promote to required only after it catches real defects with tolerable noise.

## Current Expected Findings

The first local inventory found required tools present, but optional Docker, make, ShellCheck, gitleaks, sqlfluff, actionlint, and shfmt were missing. The tooling quality report should therefore treat missing ShellCheck or SQLFluff as `skipped` unless `--allow-install` is explicit.

The first useful signal from this gate was not theoretical: ShellCheck and the LF guard both surfaced CRLF bytes in Ubuntu-targeted shell scripts. Treat that as a follow-up cleanup slice with reviewable line-ending policy, not as an automatic broad rewrite.
