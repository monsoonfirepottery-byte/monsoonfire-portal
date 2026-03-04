# Docs Hygiene Runbook

Last reviewed: 2026-03-01

This runbook keeps Markdown guidance aligned with live scripts, paths, and generated artifacts.

## What It Checks

`npm run docs:hygiene` scans selected Markdown surfaces and reports:

- broken local markdown links
- invalid `npm run` script references for the expected package
- typo guard for common deprecated-spelling mistakes

Default scan scope excludes high-churn and generated-heavy areas (`tickets/`, `output/`, `artifacts/`, `automation/`, `docs/library/`, dependency trees).

## Commands

- Advisory mode: `npm run docs:hygiene`
- PR gate mode: `npm run docs:hygiene:strict`
- Refresh generated docs + hygiene pass: `npm run docs:refresh`

## Authoring Rules

- Prefer explicit package scoping for commands: `npm --prefix <package> run <script>`.
- If commands are meant to run from repo root inside nested docs, state that context explicitly.
- Keep generated docs machine-owned (`docs/generated/*.generated.md`).

## Typical Cleanup Flow

1. Run `npm run docs:hygiene`.
2. Fix reported links or script names.
3. If contract docs changed, run `npm run docs:contract`.
4. Confirm clean gate with `npm run docs:hygiene:strict` and `npm run docs:contract:check`.
