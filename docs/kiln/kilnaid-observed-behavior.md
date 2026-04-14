# KilnAid Observed Behavior

## Status

This is a first-pass KilnAid audit from documented and publicly visible sources only.

- `Documented`: official Bartlett KilnAid page
- `Documented`: public Apple App Store description
- `Pending observed`: authenticated owner walkthrough in browser and mobile app

No third-party traffic tampering, TLS interception, or credential bypass is included or recommended.

## Primary Sources

1. Bartlett KilnAid page
   Local copy: `artifacts/kiln/docs-rag/html/bartlett-kilnaid.html`
   URL: <https://www.bartlettinstrument.com/kilnaid>
2. Apple App Store page for Bartlett KilnAid
   URL: <https://apps.apple.com/us/app/bartlett-kilnaid/id1336294986>

## Documented Feature Matrix

| Feature | Source | Classification | Notes |
| --- | --- | --- | --- |
| Remote monitoring of Bartlett Genesis controller | Bartlett KilnAid page | `Documented` | Explicit feature bullet. |
| Claim and view multiple kilns | Bartlett KilnAid page | `Documented` | Explicit feature bullet. |
| List view with limited status for all kilns | Bartlett KilnAid page | `Documented` | Suggests summary dashboard. |
| Status page with details of selected kiln current program | Bartlett KilnAid page | `Documented` | Suggests program visibility. |
| Alarm notifications | Bartlett KilnAid page | `Documented` | Premium / subscription language. |
| Advanced monitoring | Bartlett KilnAid page | `Documented` | Premium / subscription language; specifics still need observation. |
| Free tier exists | Bartlett KilnAid page | `Documented` | App is free. |
| Premium pricing | Bartlett KilnAid page | `Documented` | `$1.99/month` or `$19.99/year`, with 30-day trial on the reviewed page. |
| Controller must be connected to Wi-Fi | Bartlett KilnAid page | `Documented` | Strong cloud/network dependency signal. |
| Current temperature and kiln status | Apple App Store page | `Documented` | Public description explicitly says this. |
| Kiln claiming via MAC address and serial number | Apple App Store page | `Documented` | Important identity/ownership workflow clue. |

## Current Evidence

### Bartlett Site

The Bartlett product page states:

- remote monitoring
- claim and view multiple kilns
- list view with limited status
- status page with current-program details
- premium alarm notifications and advanced monitoring

Evidence:

- `artifacts/kiln/docs-rag/html/bartlett-kilnaid.html`
- Bartlett URL: <https://www.bartlettinstrument.com/kilnaid>

### App Store Description

The Apple page public description says:

- the latest controllers communicate with Bartlett’s website
- customers create a free account
- customers claim a kiln through MAC address and serial number
- after setup, KilnAid allows viewing current temperature and status

Evidence:

- public app page URL: <https://apps.apple.com/us/app/bartlett-kilnaid/id1336294986>

## What Is Verified Today

### Verified Capabilities

- `Documented`: KilnAid is a remote monitoring product, not just a setup utility.
- `Documented`: Kiln identity and claim flow likely depends on controller MAC address and serial number.
- `Documented`: At minimum, KilnAid exposes:
  - current temperature
  - current status
  - multi-kiln list view
  - a selected-kiln details/program view
- `Documented`: Some monitoring features are subscription-gated.

### Verified Non-Capabilities

None yet at strict proof level.

### Not Yet Verified

- remote start
- remote stop
- remote skip segment
- remote program editing
- remote Start Code handling
- historical log download from the app or browser
- diagnostics detail level in the app
- whether browser and mobile app feature sets differ materially

## Working Read/Write Assessment

Based on current evidence only:

- `Documented`: read path exists
- `Documented`: claim/account relationship exists
- `Inferred`: product is intentionally monitoring-first
- `Not yet verified`: any supported remote write path

This is the disciplined position until authenticated observation proves more.

## Browser/App Audit Checklist

Run this only through the owner’s normal authenticated sessions.

### Browser

Capture:

1. Home/dashboard
2. Kiln list view
3. Kiln details / status page
4. Program details
5. Diagnostics page if present
6. History/logs page if present
7. Download/export controls if present
8. Claim / unclaim / add kiln flow
9. Account/subscription/settings surfaces

Record for each screen:

- URL path
- visible controls
- visible data fields
- disabled controls
- whether a page is read-only or editable
- whether any button appears gated by subscription

### Mobile App

Capture the same matrix, plus:

- push notification settings
- local notification permissions
- any offline behavior
- background refresh behavior

## Discrepancies To Test

1. Bartlett page says “current program details”; does that mean full segment table or only a summary?
2. “Advanced monitoring” is vague; determine whether it means richer alerts, richer history, or diagnostics.
3. App-store description says “current temperature and status”; compare that to Bartlett’s more feature-rich marketing bullets.
4. Determine whether browser and mobile are equal, or whether one is intentionally limited.

## Interim Conclusion

KilnAid is clearly documented as a legitimate monitoring plane. What is still missing is proof of any supported write authority. Until live observation says otherwise, Studio Brain should assume:

- KilnAid can help supervise
- KilnAid may help notify
- KilnAid should not yet be treated as a trustworthy control authority

