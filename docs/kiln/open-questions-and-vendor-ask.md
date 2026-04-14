# Open Questions And Vendor Ask

## Highest-Value Unknowns

1. Does KilnAid support any remote write actions today for the Genesis family?
2. If yes, which actions are officially supported:
   - start
   - stop
   - skip segment
   - acknowledge alarm
   - edit program
3. Are all KilnAid features identical between browser and mobile?
4. What exact file formats are produced by Genesis log export?
5. Is Genesis log export always a same-LAN server-mode workflow, or can logs also be retrieved through KilnAid cloud surfaces?
6. Are diagnostics rich enough to expose relay health, thermocouple drift, and voltage history remotely?
7. Does firmware version materially change KilnAid capability or local menu structure?
8. Is there any documented API, webhook, export endpoint, or partner integration path for legitimate third-party supervision?
9. Is the `KISS` remote-start path in the Genesis manual still supported for current controllers and customers?

## Bartlett Questions

1. For `Genesis` and `Genesis Mini`, what remote actions are officially supported through KilnAid as of `2026-04-14`?
2. Does KilnAid expose any supported export or integration interface for:
   - current status
   - history
   - alerts
   - diagnostics
   - logs
3. What exact controller-side prerequisites for KilnAid are required:
   - firmware minimum
   - Wi-Fi mode
   - cloud registration state
4. Is the MAC + serial claim flow the only supported ownership binding method?
5. Can an owner export logs in a documented machine-readable format without using the app?
6. Is there any supported local API during `Export Log File`, or is it intentionally one-shot and manual only?
7. Are there published limits on polling, session concurrency, or browser access for KilnAid?
8. Does KilnAid expose, replace, or coexist with the older `KISS` remote-start workflow referenced in the Genesis manual?

## L&L Questions

1. On current L&L Genesis-equipped kilns, which menu items may vary by kiln model, zone count, or factory options?
2. Which `Output 4` modes are commonly factory-enabled on ceramic kilns versus optional?
3. Are relay-health counts and new-element diagnostics considered reliable enough for preventive maintenance planning?
4. Are exported log files stable in format across firmware revisions?
5. Does L&L support customer use of exported Genesis logs for external analytics systems?
6. Does enabling Wi-Fi or log export have any known operational or support caveats?
7. Is the `Remote Start via KISS` workflow still supported on current L&L Genesis-equipped kilns, and what safety expectations attach to it?

## Go / No-Go Criteria For Studio Brain Integration

### Go

- vendor confirms monitoring/export behavior
- no unsupported control injection required
- safety responsibility remains with operator and controller
- logs and diagnostics are stable enough to analyze

### No-Go

- remote control would require auth bypass, panel simulation, or electrical hacks
- vendor explicitly forbids the intended data-collection path
- workflow would compromise warranty, insurance, or safety policy
