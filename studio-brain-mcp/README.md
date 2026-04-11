# Studio Brain MCP

Standalone MCP bridge for the existing Studio Brain HTTP memory and loop endpoints.

This package is intentionally isolated from the main `studio-brain/` app so it can ship as a low-conflict PR while other work continues in the service itself.

## What it exposes

- `studio_brain_health`
- `studio_brain_memory_search`
- `studio_brain_memory_recent`
- `studio_brain_memory_stats`
- `studio_brain_memory_context`
- `studio_brain_loop_incidents`
- `studio_brain_loop_action_plan`

## Environment

- `STUDIO_BRAIN_MCP_BASE_URL`
  - default: `http://192.168.1.226:8787`
- `STUDIO_BRAIN_MCP_ID_TOKEN`
  - Firebase ID token for Studio Brain staff auth
- `STUDIO_BRAIN_MCP_AUTH_HEADER`
  - optional full `Authorization` header value (for example `Bearer <token>`); falls back to the ID token variables when unset
- `STUDIO_BRAIN_MCP_ADMIN_TOKEN`
  - optional extra admin token for local/dev setups
- `STUDIO_BRAIN_MCP_TIMEOUT_MS`
  - default: `10000`

## Secrets merge

The recommended local setup is to keep runtime secrets in:

`D:\monsoonfire-portal\secrets\studio-brain\studio-brain-mcp.env`

Use the launcher to merge that file into the process environment before the MCP server starts:

```bash
node D:\monsoonfire-portal\studio-brain-mcp\launch.mjs
```

The launcher also checks these optional auth sources at startup:

- `D:\monsoonfire-portal\secrets\studio-brain\studio-brain-automation.env`
- `D:\monsoonfire-portal\secrets\portal\portal-automation.env`
- `D:\monsoonfire-portal\secrets\portal\portal-agent-staff.json`
- `~/.ssh/portal-agent-staff.json`

If `STUDIO_BRAIN_MCP_ID_TOKEN` is missing, the launcher will try to mint a fresh Firebase staff ID token from the portal automation credentials and inject it into the MCP process for that session. The server will also retry once with a freshly minted token if Studio Brain reports an expired or missing bearer token mid-session.

## Local run

```bash
npm --prefix studio-brain-mcp install
npm --prefix studio-brain-mcp run smoke
```

```bash
npm --prefix studio-brain-mcp start
```

## Codex config example

Add a local MCP entry like this:

```toml
[mcp_servers.studio-brain-memory]
command = "node"
args = ["D:\\monsoonfire-portal\\studio-brain-mcp\\launch.mjs"]
startup_timeout_sec = 60
```

The launcher reads `secrets/studio-brain/studio-brain-mcp.env` and merges it with the ambient process environment.
