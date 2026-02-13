# Studio Brain Chaos Scripts (Staging Only)

Guards:
- Require `CHAOS_MODE=true`
- Refuse to run if `NODE_ENV=production`
- Require `STUDIO_BRAIN_BASE_URL` and `STUDIO_BRAIN_ADMIN_TOKEN`

Scripts:
- `kill_switch_toggle.mjs`: flip kill-switch on/off and verify safe refusal.
- `connector_timeout_storm.mjs`: repeatedly probe connector health with short timeouts to simulate outage pressure.
- `delegation_revocation_race.mjs`: attempt proposal creation with invalid delegation payloads to validate denial.

Usage:
```bash
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=devtoken node studio-brain/scripts/chaos/kill_switch_toggle.mjs
```
