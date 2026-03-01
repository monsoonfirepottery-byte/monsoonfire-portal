# Website GA Alert Thresholds

Version: 2026-02-28

## Metric families and owners
- Acquisition + source/medium: `marketing-lead`
- Funnel conversion: `web-product`
- Landing engagement: `web-content`
- Assisted conversion value: `product-lead`

## Thresholds
1. `sessionsTotalTop10Sources`
   - breach when week-over-week delta <= `-15%`
   - escalation: `marketing-lead -> web-lead -> product-lead`
   - ticket priority: `P2`
2. `averageTopFunnelConversionPct`
   - breach when week-over-week delta <= `-12%`
   - escalation: `web-product -> web-content -> product-lead`
   - ticket priority: `P1`
3. `assistedRevenueTotal`
   - breach when week-over-week delta <= `-20%`
   - escalation: `marketing-lead -> product-lead`
   - ticket priority: `P2`

## Dry-run validation
1. Run `npm run website:ga:dashboard:weekly -- --simulate-breach --strict`.
2. Confirm one or more alert entries in:
   - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.json`
   - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.md`
3. Confirm escalation path and recommended ticket priority are present per alert.

