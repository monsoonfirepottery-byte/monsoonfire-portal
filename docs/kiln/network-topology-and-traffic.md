# Network Topology And Traffic

## Scope And Boundaries

This track is limited to owner-authorized LAN observation and passive-first methods.

Allowed:

- IP, MAC, OUI, DHCP, DNS, NTP, SNI, protocol, port, timing
- packet capture during normal owner workflows
- gentle owned-network discovery

Forbidden:

- TLS interception
- certificate substitution
- packet injection or replay
- brute force
- credential harvesting
- firmware tampering

## Tool Reality On This Machine

Checked on `2026-04-14`:

- `tshark`: not installed
- `Wireshark`: not installed
- `nmap`: not installed

Recommended optional installs before live LAN work:

1. Wireshark with `tshark`
2. Nmap

The investigation does not block on these installs, but passive capture is materially better with them.

## Network Questions To Answer

1. Does the controller speak directly to KilnAid cloud endpoints, or only after local user action?
2. Is Genesis log export entirely local HTTP server mode, or are there cloud-linked alternatives?
3. Does KilnAid browser/mobile pull from cloud only, or sometimes from a local controller endpoint?
4. Are status updates pushed, polled, or mixed?
5. What LAN identity signals are exposed without any unauthorized action?

## Planned Evidence Table

| Event | Capture mode | Evidence to keep | Risk level |
| --- | --- | --- | --- |
| Controller idle, Wi-Fi connected | passive | DHCP, DNS, destinations, periodic traffic timing | Low |
| Open KilnAid app/site | passive | new DNS, TLS SNI, destination IPs, request cadence | Low |
| Refresh status | passive | poll cadence, burst size, cloud/local distinction | Low |
| Start firing from panel | passive | event-correlated network burst, destination changes | Low |
| Mid-fire monitoring | passive | poll interval, sustained connections | Low |
| Export logs locally | passive | local server behavior, LAN-only endpoint details | Low |

## Gentle Discovery Commands

Run only on the owner LAN, scoped to the local subnet, and prefer passive results first.

### Without Nmap

PowerShell options:

```powershell
arp -a
Get-NetNeighbor | Sort-Object IPAddress
Get-NetIPConfiguration
ipconfig /all
```

### With Nmap Installed

Use one careful ping sweep only, scoped to the local subnet:

```powershell
nmap -sn 192.168.1.0/24
```

Do not broaden scope beyond the owned LAN segment.

## Passive Capture Procedure

### Preferred

If `tshark` is available:

```powershell
tshark -i 1 -f "host <controller-ip> or host <observing-device-ip>" -w artifacts/kiln/pcaps/session-YYYYMMDD-HHMMSS.pcapng
```

### Minimum Metadata To Record

For each session, save:

- interface used
- controller IP
- capture start and stop time
- user action chronology
- destination hosts
- DNS names
- protocols and ports
- whether traffic appears local-only, cloud-mediated, or mixed

## Chronology Template

Use this table during real captures:

| Time | User action | Device | Expected effect | Observed network effect | Notes |
| --- | --- | --- | --- | --- | --- |
| 00:00 | Controller idle | Genesis | baseline traffic only | pending | |
| 02:00 | Open KilnAid browser | laptop | auth/session refresh | pending | |
| 04:00 | Open KilnAid mobile | phone | status fetch | pending | |
| 06:00 | Refresh kiln page | browser | poll or websocket activity | pending | |
| 08:00 | Start firing at panel | Genesis | state change | pending | |
| 12:00 | Export logs | local browser | local server mode or cloud fetch | pending | |

## Likely Signals To Watch

Documented hints from reviewed sources:

- Genesis can connect to Wi-Fi and download firmware from `www.bartinst.com`.
- Genesis has Wi-Fi diagnostics and local log-export server mode.
- KilnAid requires a controller connected to Wi-Fi.

This makes the following worth watching:

- DNS lookups for Bartlett/KilnAid domains
- controller DHCP lease behavior
- whether the controller exposes a temporary local web endpoint during log export
- whether KilnAid status traffic continues when no browser/app is open

## Current Assessment

- `Documented`: the controller has enough network capability to justify a proper passive LAN audit.
- `Documented`: at least one feature, log export, may intentionally expose a same-LAN endpoint.
- `Unknown`: the exact traffic graph until live capture is run.

