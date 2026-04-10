# Studio Brain ↔ Roborock Connector Setup (via Home Assistant)

This runbook connects Studio Brain's Roborock capabilities to Home Assistant so you can read telemetry/alerts and trigger cleaning jobs (whole floor or room-targeted).

## Why this path

- Studio Brain keeps telemetry reads and cleaning writes behind explicit capability policy controls.
- Home Assistant already has mature Roborock integrations and avoids embedding Roborock account passwords directly in Studio Brain.
- Secrets stay in 1Password and are pulled into local/host env files only at runtime.


## Capability coverage

- `roborock.devices.read` → device telemetry + vital stats + derived alerts
- `roborock.clean.start_full` → start whole-floor cleaning run
- `roborock.clean.start_rooms` → start targeted room cleaning (`roomIds[]`)

## Preconditions

- Home Assistant has a working Roborock integration and you can see entities like `vacuum.<name>`.
- You have a Home Assistant long-lived access token stored in 1Password.
- Studio Brain host can reach Home Assistant base URL (LAN or VPN).

## 1) Add/verify 1Password items

Use your existing Studio Brain automation vault and add (or verify) these fields:

- `STUDIO_BRAIN_ROBOROCK_PROVIDER` = `home_assistant`
- `STUDIO_BRAIN_ROBOROCK_BASE_URL` = e.g. `http://homeassistant.local:8123`
- `STUDIO_BRAIN_ROBOROCK_ACCESS_TOKEN` = Home Assistant long-lived token
- `STUDIO_BRAIN_ROBOROCK_ENTITY_IDS` = comma-separated list (optional), e.g. `vacuum.studio_s7`
- `STUDIO_BRAIN_ROBOROCK_TIMEOUT_MS` = `10000` (optional)
- `STUDIO_BRAIN_ROBOROCK_HA_ENTITY_ID` = `vacuum.<your_entity_id>`
- `STUDIO_BRAIN_ROBOROCK_HA_SERVICE_START_FULL` = `start` (optional override)
- `STUDIO_BRAIN_ROBOROCK_HA_SERVICE_START_ROOM` = `vacuum_clean_segment` (optional override)
- `STUDIO_BRAIN_ROBOROCK_HA_ROOM_IDS_PARAM` = `segments` (optional override)

## 2) Mirror secrets from 1Password into local env

If you use `op` CLI, export only the connector keys into your local ignored env file:

```bash
op item get "studio-brain-automation-env" \
  --vault "Monsoon Fire Studio Brain" \
  --fields notesPlain > secrets/studio-brain/studio-brain-automation.env
```

Then verify these keys exist in `secrets/studio-brain/studio-brain-automation.env`.

> Do not commit env files or paste secret values into chat/logs.

## 3) Load env and run Studio Brain

```bash
set -a
source ./secrets/studio-brain/studio-brain-automation.env
set +a
npm --prefix studio-brain run preflight
npm --prefix studio-brain start
```

## 4) Validate connector health + read telemetry

In another shell:

```bash
npm run studio-brain:auth-probe:json
```

Then call capability execution endpoint with your usual auth/admin headers and capability id `roborock.devices.read`.

Expected result:

- connector health includes `roborock`
- returned `devices[]` includes your `vacuum.*` entities with battery, maintenance stats, and derived alerts
- alerts include stopped jobs (`job_stopped`) and low filter life (`filter_maintenance_due`) when present in telemetry

## 5) Trigger clean jobs

Create and approve capability proposals, then execute:

- `roborock.clean.start_full` with `{}` input for whole-floor run
- `roborock.clean.start_rooms` with `{ "roomIds": [16, 17] }` for room-targeted run

## 6) Troubleshooting

- `AUTH` errors: token expired/invalid; issue a new Home Assistant long-lived token and update 1Password.
- `UNAVAILABLE` errors: Studio Brain host cannot reach `STUDIO_BRAIN_ROBOROCK_BASE_URL`.
- Empty `devices`: verify `vacuum.*` entities in Home Assistant and remove/adjust `STUDIO_BRAIN_ROBOROCK_ENTITY_IDS` allowlist.

## 7) Security notes

- Keep provider as `stub` unless intentionally enabling live telemetry.
- Cleaning writes remain approval-gated via capability policy and audit logs.
- Use short-lived host sessions and rotate Home Assistant tokens regularly.
