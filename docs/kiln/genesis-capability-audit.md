# Genesis Capability Audit

## Scope

This document audits the local capabilities of an L&L kiln using a Bartlett Genesis controller, using primary documentation first and separating:

- `Documented`: explicitly stated in a primary source
- `Observed`: directly seen in owner-controlled hardware or authenticated UI
- `Inferred`: reasonable conclusion from documented or observed evidence
- `Speculative`: plausible, but not yet supported enough to trust

Current state:

- `Track A partial`: primary-source corpus started and first-pass extraction completed
- `Track B pending live session`: no owner-live menu walk yet in this thread
- `Track D pending LAN capture`: no passive capture yet in this thread

## Primary Sources Reviewed

1. L&L Kilns Genesis manual PDF:
   `artifacts/kiln/docs-rag/raw/ll-genesis-operation-manual-2024-04-10.pdf`
   Search text: `artifacts/kiln/docs-rag/text/ll-genesis-operation-manual-2024-04-10.txt`
   Source URL: <https://hotkilns.com/support/pdfs/genesis-instructions>
2. L&L Genesis operation page:
   `artifacts/kiln/docs-rag/html/ll-genesis-control.html`
   Source URL: <https://hotkilns.com/support/operation/genesis-control>
3. L&L Genesis export logs page:
   `artifacts/kiln/docs-rag/html/ll-genesis-export-logs.html`
   Source URL: <https://hotkilns.com/genesis/export-logs>
4. Bartlett KilnAid page:
   `artifacts/kiln/docs-rag/html/bartlett-kilnaid.html`
   Source URL: <https://www.bartlettinstrument.com/kilnaid>
5. Bartlett network issues page:
   `artifacts/kiln/docs-rag/html/bartlett-network-issues.html`
   Source URL: <https://www.bartlettinstrument.com/kiln/network-issues>
6. Bartlett error codes page:
   `artifacts/kiln/docs-rag/html/bartlett-error-codes.html`
   Source URL: <https://www.bartlettinstrument.com/kiln/error-codes>

## Hypothesis Check

| Hypothesis | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Genesis supports touchscreen control | `Verified documented` | manual p.2 table of contents + operation pages | Genesis is explicitly a touchscreen controller. |
| Genesis supports Wi-Fi | `Verified documented` | manual p.2, p.20 | Wi-Fi is used for firmware download and monitoring/export features. |
| Genesis supports up to 30 custom programs | `Verified documented` | manual p.10 lines 557-563 | 30 custom user programs. |
| Genesis supports up to 32 segments per program | `Partially verified` | manual p.10 lines 559-561 | Programs 1-12 have 32 segments each; programs 13-30 have 8 segments each. |
| Genesis supports live adjustments during firing | `Verified documented` | manual p.15-16 lines 788-850 | Stop, skip step, add time, add temperature, alarm temp, mid-firing diagnostics, TC offsets. |
| Genesis has diagnostics and error codes | `Verified documented` | manual p.18, appendix A; Bartlett error-code page | Includes manual diagnostics, element diagnostics, board temperature, error codes. |
| Genesis has maintenance logging | `Verified documented` | manual p.2 lines 115-116; p.18 lines 949-963 | New-element diagnostics and relay cycle tracking are explicitly documented. |
| Genesis includes a Start Code | `Verified documented` | manual p.5 lines 295-300; p.21 lines 1215-1218 | Configurable; default shown as `1`. |
| L&L docs mention Output 4 behavior | `Verified documented` | manual p.20-21 lines 1177-1208 | Vent, alarm, atmospheric control, or extra element behavior. |
| KilnAid supports remote monitoring | `Verified documented` | Bartlett KilnAid page and Apple App Store description | Monitoring is explicitly marketed and described. |
| KilnAid supports authoritative remote start/stop/program editing | `Not verified` | no supporting KilnAid source found yet | Needs authenticated observation or vendor confirmation. |
| Genesis supports a remote-start path through KISS after local arming | `Verified documented` | manual p.13 lines 707-715 | Separate from KilnAid; still requires local preparation and Start Code entry. |

## Verified Local Controller Capabilities

### Control and Programming

- `Documented`: Genesis has 30 custom programs; programs `1-12` allow `32 segments` each and programs `13-30` allow `8 segments` each.
  Evidence:
  `artifacts/kiln/docs-rag/text/ll-genesis-operation-manual-2024-04-10.txt:557-563`
- `Documented`: Custom programs can be edited when Novice Mode is off.
  Evidence:
  `...txt:560-563`
- `Documented`: During a firing, the operator can:
  - stop the firing
  - skip to a desired segment
  - add time during a hold
  - add temperature during a hold
  - adjust alarm temperature
  - run mid-firing diagnostics
  - change thermocouple offsets
  Evidence:
  `...txt:788-850`
- `Documented`: When firing a custom program with Novice Mode off, the controller supports `edit-on-the-fly` for unfired segments.
  Evidence:
  `...txt:830-834`
- `Documented`: Start screen includes `Start Now`, `Start Later`, and `Remote Start`. The `Remote Start` path arms the kiln for starting from the `KISS` program after local Start Code entry.
  Evidence:
  `...txt:707-715`

### Wi-Fi, Firmware, and Export

- `Documented`: Genesis supports Wi-Fi setup, manual Wi-Fi setup, advanced Wi-Fi settings, Wi-Fi diagnostics, and firmware download.
  Evidence:
  `...txt:1072-1146`
- `Documented`: Wi-Fi modes include `Off`, `On When Firing`, and `Always On`.
  Evidence:
  `...txt:1080-1082`
- `Documented`: `Export Log File` starts a local server mode, shows an IP address and code, and lets a device on the same access point download the last 10 firings.
  Evidence:
  `...txt:1112-1130`
- `Documented`: Each exported firing has two files:
  - temperature data every 30 seconds
  - event data when an event occurs such as a hold or error
  Evidence:
  `...txt:1124-1129`

### Diagnostics and Maintenance

- `Documented`: Data menu includes past-firing graphs for the last 10 firings.
  Evidence:
  `...txt:918-925`
- `Documented`: Kiln info includes firmware version, serial number, and MAC address used for registration and KilnAid.
  Evidence:
  `...txt:927-930`
- `Documented`: Manual diagnostics read amperage and voltage by section.
  Evidence:
  `...txt:943-947`
- `Documented`: New-element diagnostics store baseline amperage and voltage after an element change.
  Evidence:
  `...txt:949-953`
- `Documented`: Relay health tracks on/off relay cycles and supports per-zone reset after replacement.
  Evidence:
  `...txt:955-964`
- `Documented`: Factory diagnostics and last-manual-diagnostics store line voltage, board output, and section information.
  Evidence:
  `...txt:897-916`

### Zones, Thermocouples, and Output Behavior

- `Documented`: Genesis 2.0 can be configured for `1`, `2`, or `3` zones; Genesis Mini is limited to `1`.
  Evidence:
  `...txt:1168-1172`
- `Documented`: Three-zone mode allows separate control of three zones and can continue firing if one or two thermocouples fail during a firing.
  Evidence:
  `...txt:1877-1884`
  `...txt:1925-1936`
- `Documented`: Output 4 supports factory-set modes for:
  - vent control option A
  - vent control option B
  - vent/alarm/atmosphere option C
  - alarm
  - percent-follow output for lid/floor elements
  Evidence:
  `...txt:1177-1208`

### Security and Safety-Relevant Controls

- `Documented`: Start Code is configurable and can be any 4-number combination; default listed as `1`.
  Evidence:
  `...txt:1215-1218`
- `Documented`: Manual warns the controller is not a safety device and says the kiln should always be supervised during firing.
  Evidence:
  manual p.2 introduction/precautions
- `Documented`: L&L recommends placing controllers on a separate logical network or VLAN.
  Evidence:
  `...txt:1089-1093`

## Capability Matrix

| Capability | Local panel | KilnAid docs | Confidence | Status |
| --- | --- | --- | --- | --- |
| Start firing | Yes, documented | Not yet documented | High local / low remote | `Local yes, remote unknown` |
| Arm kiln for KISS remote start | Yes, documented | No KilnAid evidence | Medium | `Documented via KISS, not via KilnAid` |
| Stop firing | Yes, documented | Not yet documented | High local / low remote | `Local yes, remote unknown` |
| Skip segment | Yes, documented | Not yet documented | High local / low remote | `Local yes, remote unknown` |
| Add hold time | Yes, documented | Not yet documented | High local / low remote | `Local yes, remote unknown` |
| Add temperature | Yes, documented | Not yet documented | High local / low remote | `Local yes, remote unknown` |
| Edit future custom-program segments mid-fire | Yes, documented | Not yet documented | Medium | `Local yes, remote unknown` |
| View current temperature | Yes, documented | Yes, documented | High | `Supported` |
| View current program | Yes, documented | Yes, documented | High | `Supported` |
| View past graphs/logs | Yes, documented | Partially indicated | Medium | `Likely supported at least locally` |
| Export logs | Yes, documented locally | App claims still need observation | High local / low remote | `Local yes, remote pending` |
| Diagnostics | Yes, documented | App mention pending observation | Medium | `Local yes, remote partial` |
| Firmware update | Yes, documented | Not reviewed remotely | High | `Local documented` |
| Register via MAC + serial | Indirectly documented | Yes, app-store description | Medium | `Documented` |

## Interesting Clues

- `Interesting`: Genesis log export is not cloud-only in the manual. It explicitly describes a same-access-point local browser workflow using a controller-shown IP address and code.
- `Interesting`: Genesis has a documented `Remote Start` mode through `KISS`, which means remote write capability exists somewhere in the controller ecosystem even though it is not yet documented for KilnAid.
- `Interesting`: L&L explicitly recommends controller network isolation by VLAN or separate logical network, which is useful for any owner-safe observation design.
- `Interesting`: Kiln info exposes firmware version, serial number, and MAC address on-panel, which means asset identity can be inventoried without packet tampering.
- `Interesting`: Output 4 is broader than simple vent control; docs also describe alarm and extra-element use cases.
- `Interesting`: Relay-cycle tracking and new-element diagnostics suggest real predictive-maintenance value even without any remote control path.

## Contradictions and Tensions

1. `Marketing vs safety reality`
   Bartlett markets remote monitoring, while the Genesis manual still says the kiln should always be supervised during a firing.
2. `Cloud framing vs local export`
   KilnAid branding suggests cloud convenience, but Genesis log export is explicitly described as a same-LAN server-mode workflow.
3. `“32 segments” shorthand`
   Prior shorthand said “up to 32 segments per program,” but the manual is more nuanced: only custom programs `1-12` have `32` segments and `13-30` have `8`.

## Verified Non-Capabilities

None yet that meet a strict standard of proof.

Current disciplined position:

- No primary source reviewed so far documents a supported remote start, stop, or remote program-write path through KilnAid.
- The reviewed Genesis manual does document a separate remote-start path through `KISS` after local arming.
- That is not the same as proving it does not exist.
- Until observed in authenticated UI or confirmed by vendor, Studio Brain should treat remote write authority as `unverified / do not depend on`.

## Unknowns Requiring Live Observation or Vendor Confirmation

- Exact on-panel menu tree on the owner’s specific firmware
- Whether the owner’s kiln exposes 1, 2, or 3 zones in practice
- Whether KilnAid browser/mobile UI exposes remote acknowledge, stop, alarm, or schedule actions
- Whether exported log files are CSV, JSON, proprietary text, or another format
- Whether the controller’s local server export uses plain HTTP, HTTPS, or a one-shot ephemeral endpoint
- Whether the Start Code gate applies only to local starts or to any remote initiation path if one exists
- Whether `KISS` is still a supported product path for current Genesis deployments, or legacy carryover in documentation
- Whether KilnAid and KISS share any backend, protocol, or capability surface
- Whether firmware version materially changes KilnAid capabilities

## Track B Ready Checklist

When physically with the kiln, capture:

1. Home screen with firmware version and Wi-Fi icon state.
2. `Menu -> Data Menu`
3. `Menu -> Diagnostics`
4. `Menu -> Adjustments`
5. `Menu -> Configuration`
6. `Menu -> Communications / Wi-Fi`
7. `Factory Config / Hidden Menu` only if normally owner-visible without bypass
8. `Kiln Info` screen showing firmware, serial, MAC
9. `Output 4` configuration screen if present
10. `Start Code` screen

## Interim Conclusion

Genesis is already more capable locally than the current KilnAid marketing copy suggests. The strongest verified local capabilities are:

- firing control from the panel
- live in-process adjustments
- diagnostics and maintenance baselines
- local log export
- zone-aware control and output mapping

The cleanest next move is not remote control experimentation. It is:

1. live controller menu capture
2. authenticated KilnAid feature audit
3. passive LAN observation during normal workflows
