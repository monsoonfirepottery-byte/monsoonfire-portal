# Studiobrain Host and URL Contract Matrix

## Scope
Canonical host/port contract for local and LAN-aware development and cutover tooling.

| Area | Local default (profile: `local`) | LAN profile (`lan-dhcp` / `lan-static`) | Notes |
| --- | --- | --- | --- |
| Portal Vite dev host | `127.0.0.1` (`VITE_DEV_HOST`) | `0.0.0.0` when explicit remote/LAN access is required | Tune via `VITE_DEV_HOST` in `web/.env.local` and restart `npm run dev` (`web` package).
| Portal auth emulator host | `127.0.0.1` (`VITE_AUTH_EMULATOR_HOST`) | `studiobrain.local` when profile expects hostname-based access | Must match `VITE_USE_AUTH_EMULATOR=true` when using emulator path. |
| Portal auth emulator port | `9099` (`VITE_AUTH_EMULATOR_PORT`) | `9099` | |
| Portal firestore emulator host | `127.0.0.1` (`VITE_FIRESTORE_EMULATOR_HOST`) | `studiobrain.local` when profile expects hostname-based access | Used by `connectFirestoreEmulator(...)` in `web/src/firebase.ts` |
| Portal firestore emulator port | `8080` (`VITE_FIRESTORE_EMULATOR_PORT`) | `8080` | |
| Portal functions base URL | `http://127.0.0.1:5001/monsoonfire-portal/us-central1` | `http://studiobrain.local:5001/monsoonfire-portal/us-central1` (or host profile override) | Keep non-production and production URLs separated by `VITE_USE_*` + `VITE_FUNCTIONS_BASE_URL`.
| Studio Brain base URL | `http://127.0.0.1:8787` | `http://studiobrain.local:8787` (or static IP override) | Canonical source from `scripts/studio-network-profile.mjs` when env is unset.
| Website smoke/deploy target | `WEBSITE_DEPLOY_SERVER` unset (required) | `WEBSITE_DEPLOY_SERVER` set to studio target | `website/scripts/deploy.mjs` now requires explicit deploy server.
| Emulator bootstrap host | `npm run emulators:start -- --host 127.0.0.1` (default) | `npm run emulators:start -- --network-profile lan-dhcp` | `scripts/start-emulators.mjs` resolves host from profile.
| Network mode | `local` -> loopback-only contracts | `lan-dhcp` -> hostname-based contracts | `lan-static` for fixed host identity when static IP is managed |
| Host source precedence | explicit `STUDIO_BRAIN_HOST` | `STUDIO_BRAIN_LAN_HOST` or profile default `studiobrain.local` | fallback to static IP when `STUDIO_BRAIN_STATIC_IP` is set under `lan-static` |
| Host drift artifact | not used for loopback-only profiles | `.studiobrain-host-state.json` updated by `npm run studio:network:check:write-state` | drift checks block PR gate in strict mode |

## Enforcement points

- `scripts/studio-network-profile.mjs` resolves profile/host defaults.
- `studio-brain/.env.network.profile` documents host policy and static-IP ownership.
- `scripts/studiobrain-network-check.mjs` emits host-source/profile-source/network-target-mode metadata and persists lease evidence with `--write-state`.
- In beta rollout, the host state file should contain stable lease metadata (`state file`) including `static-ip` and `networkTargetMode`.
- `studio-brain/.env.example` defines policy override env vars used by onboarding.
- beta-pilot profile (`beta-pilot`) is the intermediate rollout lane for phased pilots and uses the same LAN-aware host contract with explicit smoke gates before production cutover.
- `scripts/studiobrain-status.mjs` and `scripts/pr-gate.mjs` validate host alignment.
- `scripts/validate-emulator-contract.mjs` validates portal emulator host/port toggles before cutover.
- `docs/EMULATOR_RUNBOOK.md` publishes the canonical contract values.
