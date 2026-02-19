# Host policy:
# local        = loopback host for workstation-only workflows
# lan-dhcp     = use hostname and DHCP/resolve path for remote LAN access
# lan-static   = use STUDIO_BRAIN_STATIC_IP for stable LAN addressing (recommended for production-like hosting)
# ci           = ephemeral CI profile; treat as local/loopback-safe mode

STUDIO_BRAIN_NETWORK_PROFILE=local

# Local/stable profile settings
STUDIO_BRAIN_LOCAL_HOST=127.0.0.1
STUDIO_BRAIN_HOST=
STUDIO_BRAIN_LAN_HOST=studiobrain.local
STUDIO_BRAIN_STATIC_IP=

# Optional helper for host drift visibility
STUDIO_BRAIN_HOST_STATE_FILE=.studiobrain-host-state.json

# Shared default and compatibility aliases
STUDIO_BRAIN_PORT=8787
STUDIO_BRAIN_BASE_URL=
STUDIO_BRAIN_ALLOWED_HOSTS=
