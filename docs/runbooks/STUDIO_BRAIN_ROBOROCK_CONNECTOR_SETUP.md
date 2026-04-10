# Studio Brain ↔ Roborock Connector Setup (via Home Assistant)

This runbook connects Studio Brain's existing `roborock.devices.read` capability to your Roborock vacuum telemetry using a Home Assistant bridge.

## Why this path

- The Studio Brain Roborock connector is **read-only**.
- Home Assistant already has mature Roborock integrations and avoids embedding Roborock account passwords directly in Studio Brain.
- Secrets stay in 1Password and are pulled into local/host env files only at runtime.

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
- returned `devices[]` includes your `vacuum.*` entities with battery and online/state data

## 5) Troubleshooting

- `AUTH` errors: token expired/invalid; issue a new Home Assistant long-lived token and update 1Password.
- `UNAVAILABLE` errors: Studio Brain host cannot reach `STUDIO_BRAIN_ROBOROCK_BASE_URL`.
- Empty `devices`: verify `vacuum.*` entities in Home Assistant and remove/adjust `STUDIO_BRAIN_ROBOROCK_ENTITY_IDS` allowlist.

## Security notes

- Keep provider as `stub` unless intentionally enabling live telemetry.
- Connector is read-only; write intents remain blocked.
- Use short-lived host sessions and rotate Home Assistant tokens regularly.
