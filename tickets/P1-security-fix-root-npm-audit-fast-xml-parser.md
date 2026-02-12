# P1 — Security: Fix Root `npm audit` (fast-xml-parser DoS via @google-cloud/storage)

**Status:** Done

**Problem**
- Running `npm audit --omit=dev` at repo root reports **2 high severity vulnerabilities**:
  - `fast-xml-parser` RangeError DoS (Numeric Entities) via transitive dependency `@google-cloud/storage`.
- Root `package-lock.json` is present and root `node_modules/` exists, so this is part of the repo's supply chain.

**Why This Matters**
- Vulnerable transitive deps increase risk for any tooling/scripts that run in this workspace or CI.

**Tasks**
1. From repo root, run `npm audit fix` (prefer non-breaking updates; avoid `--force` unless required).
2. Re-run `npm audit --omit=dev` at repo root and confirm `0 vulnerabilities` (or document remaining + why).
3. If `npm audit fix` cannot resolve without `--force`, identify the top-level dependency pulling `@google-cloud/storage` and decide:
   - upgrade/replace that dependency, or
   - remove the unused root dependency that pulls it in.
4. Run portal CI smoke locally if feasible:
   - `npm --prefix web run build`
   - `npm --prefix functions run build`

**Acceptance**
- `npm audit --omit=dev` at repo root returns `found 0 vulnerabilities`, or remaining vulns are explicitly documented with mitigations and a follow-up ticket.
- No regressions in `web` build and `functions` build.

**Progress**
- `npm audit fix` run at repo root; `npm audit --omit=dev` now returns `found 0 vulnerabilities`.
