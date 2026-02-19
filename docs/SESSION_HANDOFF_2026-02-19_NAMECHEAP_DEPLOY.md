# Session Handoff - 2026-02-19 (Namecheap Portal Deploy Automation)

## Scope
- Completed and stabilized Namecheap portal deployment automation for `portal.monsoonfire.com`.
- Validated full build/deploy/verify flow end-to-end from the repo root.

## What was completed
- Added a no-typo live deploy wrapper:
  - `scripts/deploy-namecheap-portal-live.sh`
- Wired it into npm scripts:
  - `deploy:namecheap:portal:live` in `package.json`
- Updated deployment docs:
  - `web/deploy/namecheap/README.md`
- Confirmed command-line help/error behavior and executable mode for wrapper.
- Ran an end-to-end deployment with verification.

## End-to-end command used
```bash
npm run deploy:namecheap:portal:live -- --server monsggbd@66.29.137.142 --port 21098 --key ~/.ssh/namecheap-portal --verify
```

## Verification evidence
- Verifier output in command run:
  - `Verifier PASS for https://portal.monsoonfire.com`
  - Checks passed:
    - `rootRoute`
    - `deepRoute`
    - `wellKnownRoute`
    - `rootCache`
    - `deepCache`
- Latest report written:
  - `docs/cutover-verify.json`
  - Includes `ok: true` and no failures.
- Remote deploy target confirmed populated:
  - `portal/` directory under `monsggbd@66.29.137.142` via ssh (files incl. `.htaccess`, `index.html`, `assets/...`, `.well-known/*`, `well-known/*`)
- Universal links payload validated in both directories:
  - `portal/.well-known/apple-app-site-association`
  - `portal/well-known/apple-app-site-association`

## Recommended handoff command set
- Standard deploy (build + verify):
```bash
npm run deploy:namecheap:portal:live -- --server monsggbd@66.29.137.142 --port 21098 --key ~/.ssh/namecheap-portal --verify
```
- Fast redeploy (existing `web/dist`, skip build):
```bash
npm run deploy:namecheap:portal:live -- --server monsggbd@66.29.137.142 --port 21098 --key ~/.ssh/namecheap-portal --no-build --verify
```
- Legacy alternative remains available:
  - `npm run deploy:namecheap`
  - `npm run deploy:namecheap:portal`
  - `npm run deploy:namecheap:portal:quick`

## Known residual
- `docs/cutover-verify.json` includes non-fatal cache header warnings for some JS assets (`index-BaDpIcsu.js`, `vendor-DuPUYBON.js`, `vendor-firebase-core...`, etc.).
- Warning currently does not fail the gate but can be hardened if strict cache validation is required.

## Current branch state relevant to handoff
- Modified files:
  - `scripts/deploy-namecheap-portal-live.sh` (new)
  - `package.json`
  - `web/deploy/namecheap/README.md`
- There are many unrelated in-progress repo changes outside this deployment task.
