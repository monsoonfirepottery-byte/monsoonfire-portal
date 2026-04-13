# Studio Brain Thermal Printer Precheck (Ubuntu Server)

## Scope

Validate support for the two in-hand receipt printers before physically connecting them to the Studio Brain Ubuntu host:

- SNBC **BTP-R880NP** (USB + Ethernet)
- Star Micronics **TSP143IIIU** (USB)

This runbook is intentionally **native Linux/CUPS first** (no heavy wrapper dependencies).

## Compatibility snapshot (as of 2026-04-11)

### 1) Star Micronics TSP143IIIU

- Star's official Linux CUPS driver page explicitly lists:
  - Ubuntu support up to **24.04 LTS (64-bit)**
  - model support including **TSP100IIIU / TSP143IIIU series**
  - current package metadata (version and update date)
- This is the cleanest path for Ubuntu Server with native CUPS queues.

Primary source:
- https://starmicronics.com/support/download/cups-driver-for-linux/

### 2) SNBC BTP-R880NP

- SNBC official user manual for BTP-R880NP states Linux support and ESC/POS compatibility.
- An SNBC support listing surfaced by search references a Linux CUPS driver package (`cupsdrv_pos_linux_v2.0.4.3`) and includes `BTP-R880NP` in the supported model list.

Primary sources:
- https://www.snbc.com.cn/upload/portal/download/1531982353937.pdf
- https://www.snbc.cn/index.php/news/70886.html (page intermittently unavailable from remote crawlers)

## Studio Brain host readiness status (repo-managed)

Current Studio Brain host provisioning **does not install print stack packages** by default.
The tracked Ansible baseline installs access/ops packages (`ansible`, `curl`, `mosh`, `tmux`, etc.) but no `cups`/`cups-client`/`printer-driver-*` packages.

Impact:
- Printing is **not currently turnkey** on a freshly reconciled Studio Brain host.
- Add a print preflight/install step before device cutover.

## Native Ubuntu preflight (no device attached)

Run on the Studio Brain host:

```bash
sudo apt-get update
sudo apt-get install -y cups cups-client cups-filters printer-driver-escpr
sudo systemctl enable --now cups
sudo lpstat -r
sudo lpinfo -v
```

Expected outcomes:
- `lpstat -r` reports scheduler running.
- `lpinfo -v` shows discovery backends (usb, socket, ipp, etc.) even before hardware is attached.

## Driver strategy (native, low-wrapper)

### Star TSP143IIIU

Preferred:
1. Install Star official Linux CUPS package.
2. Confirm Star PPD/filter availability:
   - `lpinfo -m | grep -i 'tsp143\|tsp100\|star'`
3. Create queue with `lpadmin` once connected:
   - USB: use discovered `usb://...`
   - LAN (if using LAN models): use `socket://<ip>:9100` or `ipp://...`

### SNBC BTP-R880NP

Preferred:
1. Start with generic ESC/POS text/raw queue for baseline printing.
2. If formatting/cutter control needs model filters, install SNBC Linux CUPS driver package.
3. Confirm model/PPD availability:
   - `lpinfo -m | grep -i 'snbc\|btp-r880\|escpos'`

## Minimal command set for intelligent integration

No custom daemon required. Keep Studio Brain print integration at command/API level:

- Queue enumeration: `lpstat -p -d`
- Capability lookup: `lpoptions -p <queue> -l`
- Job submit (text/pdf): `lp -d <queue> file.txt`
- Raw ESC/POS (for thermal control bytes):
  - `lp -d <queue> -o raw receipt.bin`
- Job state: `lpstat -W not-completed`

These can be called from Studio Brain services safely via bounded subprocess execution.

## Pre-connection acceptance checklist

- [ ] CUPS service active and persistent across reboot.
- [ ] At least one Star-supported model appears in `lpinfo -m` after driver install.
- [ ] SNBC path decided:
  - [ ] generic ESC/POS-only, or
  - [ ] vendor SNBC CUPS package staged.
- [ ] Print service account has permission to submit jobs (`lp` group if needed).
- [ ] Firewall policy allows local print transport where applicable (USB local queue usually no inbound changes).

## Risks / caveats

- SNBC support portal availability can be intermittent from some networks; mirror driver artifacts internally once retrieved.
- Vendor CUPS filters may lag newest distros; keep a fallback queue profile using raw ESC/POS.
- Avoid adding heavy print wrappers until native CUPS path is proven with your real receipt payload.
