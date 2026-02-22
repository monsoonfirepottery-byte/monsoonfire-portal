# Skill Security Model (ClawHub-style Bundles)

This project treats external skill bundles as untrusted supply-chain inputs.
The runtime is intentionally conservative and defaults to safe behavior.

## Threat model

- Registry can serve malicious packages.
- A skill package can include arbitrary code.
- Network egress from a skill can exfiltrate secrets or reach untrusted hosts.
- Dependencies in a registry can be updated silently (mutable tags).
- Runtime compromise can tamper with other agent behavior.

## Risk controls in this scaffold

1. **Pinned references are required by default**
   - `name@version` references must be provided.
   - Floating tags such as `latest`, `main`, `head`, etc are rejected by the parser.

2. **Allowlist / denylist policy before install**
   - Configure with `STUDIO_BRAIN_SKILL_ALLOWLIST` and `STUDIO_BRAIN_SKILL_DENYLIST`.
   - Denylist has precedence.

3. **Integrity verification at install time**
   - `installSkill` computes checksum over package tree.
   - `manifest.json` must include a matching checksum when `STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM=true`.
   - A checksum audit record is persisted as `installed/<name>/<version>/.install-audit.jsonl`.

4. **Trust-anchor signature verification**
   - `STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE=true` enforces deny-default signature checks at install time.
   - Trust anchors are provided via `STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS` (`keyId=secret` CSV or JSON map).
   - Manifest signatures must provide `signatureAlgorithm`, `signatureKeyId`, and `signature`.
   - Unsupported algorithms, unknown key ids, and missing signature metadata are rejected.

5. **Isolated install location**
   - Skills install under `STUDIO_BRAIN_SKILL_INSTALL_ROOT` (default `/var/lib/studiobrain/skills`).
   - Installed tree is separate from code/runtime directories.

6. **Runtime sandboxing boundary**
   - Skills execute in separate Node process (`sandboxWorker.js`), not in main process.
   - Communication is narrow JSON-RPC over stdio.
   - Healthcheck + execute methods are isolated.

7. **Egress control (default deny)**
   - `STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY=true` blocks outbound HTTP(S) by default.
   - `STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST` controls explicit host allowlist.

8. **Command and egress policy is enforced inside worker**
   - `STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST` limits which `command` values a skill can execute through RPC.
   - If the allowlist is empty, all commands are allowed; once set, only listed commands are accepted.

## Operational runbook

1. Keep `STUDIO_BRAIN_SKILL_REQUIRE_PINNING=true`.
1. Keep `STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM=true`.
1. Keep `STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE=true` with non-placeholder `STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS`.
1. Keep allowlists explicit for production pilots.
1. Rotate trust anchor keys on a scheduled cadence and retire stale key ids.
1. Run with strict OS/container restrictions (network namespace/user sandboxing) before production rollout.

## Implementation map

1. Registry and ingress policy is in `src/skills/registry.ts`.
1. Installation pipeline is in `src/skills/ingestion.ts`.
1. Process boundary is in `src/skills/sandbox.ts` and `src/skills/sandboxWorker.ts`.
1. Security-related tests are in `src/skills/ingestion.test.ts` and `src/skills/sandbox.test.ts`.

## Improvement backlog

1. Add immutable trust-anchor distribution for multi-operator key rotation workflows.
1. Add immutable artifact URL checks and reject redirect-based remote registry responses.
1. Pin manifests to signed hash and store audit lines in the immutable operation log pipeline.
1. Add per-skill execution allowlist by package identity and version, not only `command`.
1. Enforce process hardening in sandbox worker (non-root user, read-only filesystem, syscall policy).
1. Add explicit actor/task correlation fields to audit records at install time.

## Quick incident checks

1. If untrusted installs happen, verify `STUDIO_BRAIN_SKILL_REQUIRE_PINNING`, checksum policy, and allow/deny logic in `installSkill`.
1. If signature failures occur, verify `STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS`, `signatureKeyId`, and `signatureAlgorithm`.
1. If a skill reaches network egress, verify worker env flags and host allowlist in the sandbox launch path.
1. If command usage escapes bounds, verify `STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST` and worker command checks.
1. If artifacts are suspect, compare `.install-audit.jsonl` entries against expected install manifests.
