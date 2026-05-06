# Mission Control Watcher Management

This note documents the safe lifecycle for the laptop-side Mission Control gateway and Codex watcher. It is intentionally conservative: observe first, preserve logs, and do not auto-kill processes.

## Known Components

| Component | Current role | Evidence source |
| --- | --- | --- |
| `Studio Brain Mission Control Gateway` | Windows scheduled task that starts the local gateway supervisor at logon. | Mission Control `scripts/windows/install-mission-control-gateway-startup.ps1` |
| `start-mission-control-gateway.ps1` | Supervises the SSH tunnel and the laptop Codex watcher. | Mission Control `scripts/windows/start-mission-control-gateway.ps1` |
| SSH tunnel | Exposes `.226` Mission Control locally as `http://127.0.0.1:14100`. | Gateway script and Mission Control docs |
| `mission:codex-laptop-watch` | Tails local Codex session JSONL and sends read-only activity to Mission Control ingest. | Mission Control `package.json` and `server/scripts/watchCodexLaptop.ts` |
| `.mission-control` runtime dir | Stores PID files, logs, watcher state, and local bridge env. | Gateway script |

## Read-Only Status Checks

Run from the Windows laptop in the Mission Control checkout:

```powershell
Get-ScheduledTask -TaskName "Studio Brain Mission Control Gateway" | Get-ScheduledTaskInfo
Get-Content .\.mission-control\mission-control-gateway.out.log -Tail 80
Get-Content .\.mission-control\codex-laptop-watch.err.log -Tail 80
Get-NetTCPConnection -LocalPort 14100 -State Listen -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:14100/api/mission-control/health
```

List matching processes without stopping anything:

```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "mission:codex-laptop-watch" -or
    $_.CommandLine -match "watchCodexLaptop\.ts" -or
    $_.CommandLine -match "start-mission-control-gateway"
  } |
  Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine
```

## Incident Classification

| Observation | Likely meaning | Safe next step |
| --- | --- | --- |
| One supervisor, one tunnel, one watcher | Expected steady state. | Keep observing; no action. |
| Multiple watcher processes | Possible duplicate launch or stale shell. | Capture process list and logs; ask for approval before stopping duplicates. |
| Tunnel not listening on `14100` | Gateway cannot reach host or SSH tunnel failed. | Capture gateway logs and SSH stderr; verify `studiobrain` SSH access before restart. |
| Mission Control health reachable but `codexIngest.rateLimitedRequests` rising | Ingest governor is protecting the host. | Keep the governor enabled; look for noisy watcher inputs. |
| Mission Control health unreachable through tunnel but host health is OK | Laptop gateway issue, not necessarily host outage. | Restart/pause only the gateway after approval. |
| Host Node CPU high and watcher ingest active | Possible ingest storm. | Use `docs/ops/06-runbooks.md` Mission Control CPU response before any kill/restart. |

## Approval-Gated Actions

These actions are reversible, but still change operational behavior and should be approved during an incident or service window:

```powershell
Stop-ScheduledTask -TaskName "Studio Brain Mission Control Gateway"
Start-ScheduledTask -TaskName "Studio Brain Mission Control Gateway"
Disable-ScheduledTask -TaskName "Studio Brain Mission Control Gateway"
Enable-ScheduledTask -TaskName "Studio Brain Mission Control Gateway"
```

Only stop a specific process after capturing its PID, command line, parent process, logs, and the reason it is unsafe to leave running. Prefer stopping the scheduled task first so it does not immediately respawn a noisy watcher.

## Rollback

1. Re-enable the scheduled task if it was disabled.
2. Start the scheduled task.
3. Verify tunnel health:
   - `Invoke-RestMethod http://127.0.0.1:14100/api/mission-control/health`
4. Verify Mission Control UI:
   - `http://127.0.0.1:14100/mission-control`
5. Confirm no duplicate watcher processes remain.
6. Attach before/after health and process evidence to the incident note.

## Future Improvement Candidates

- Add a read-only `mission:gateway-status` command in the Mission Control repo.
- Add a dashboard panel for watcher heartbeat, tunnel status, and last ingest timestamp.
- Add an approval queue item when duplicate watcher processes are detected.
- Keep process stop/restart as an explicit human-approved action, not an automatic cleanup.
