# Real Estate Public Signals Run

- generatedAtUtc: 2026-02-17T19:49:16.6440158Z
- configuredSources: 19
- enabledSources: 19
- stagingDir: D:\monsoonfire-portal\output\real-estate\staging\public-signals
- manualDropDir: D:\monsoonfire-portal\output\real-estate\manual-drops
- loadedSources: 7
- failedSources: 6
- totalSignals: 8
- highPrioritySignals: 0
- mediumPrioritySignals: 4

## Source Status

| Source | Type | Status | Loaded From | Rows |
| --- | --- | --- | --- | ---: |
| Grants.gov Opportunities | grant_program | error | none | 0 |
| Arizona Commerce Grants and Incentives | grant_program | ok | local | 0 |
| City of Phoenix Business Grants Programs | grant_program | ok | local | 0 |
| SBA Grants and Funding Programs | grant_program | error | none | 0 |
| Arizona State Surplus Property Auctions | government_auction | ok | local | 0 |
| Maricopa Local Surplus Property Auctions | government_auction | ok | local | 0 |
| Federal Real Property Disposals and Auctions | government_auction | error | none | 0 |
| Maricopa Treasurer Delinquent Roll | government_tax | error | none | 0 |
| Maricopa Recorder Trustee and Legal Notices | government_legal | ok | local | 1 |
| Arizona UCC Filings | government_legal | ok | local | 1 |
| Arizona Bankruptcy Filings | government_legal | ok | local | 1 |
| Maricopa Civil Court Foreclosure and Receivership | government_legal | ok | local | 1 |
| Maricopa Assessor Ownership History | government_data | error | none | 0 |
| APS/SRP Utility Capacity Constraints | utility_data | ok | local | 1 |
| West Valley Code Enforcement | government_planning | ok | local | 0 |
| Phoenix and West Valley Permitting Pipeline | government_planning | ok | local | 0 |
| Lease Comps and Vacancy Feeds | market_data | ok | local | 1 |
| CMBS Delinquency and Maturity Signals | finance_data | ok | local | 1 |
| Environmental and Land-Use Constraints | regulatory_data | error | none | 0 |

## Top Signals

| Score | Priority | Signal Type | Stage | City | Parcel | Owner | Source |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 44 | medium | trustee_sale | notice_filed |  |  |  | Maricopa Recorder Trustee and Legal Notices |
| 44 | medium | foreclosure | active_case |  |  |  | Maricopa Civil Court Foreclosure and Receivership |
| 44 | medium | cmbs_delinquency | active_case |  |  |  | CMBS Delinquency and Maturity Signals |
| 40 | medium | bankruptcy | active_case |  |  |  | Arizona Bankruptcy Filings |
| 34 | low | ucc_distress | active_case |  |  |  | Arizona UCC Filings |
| 32 | low | ownership_transfer | monitoring |  | 101-01-001C | EL PASO NATURAL GAS COMPANY | Maricopa Assessor Ownership History |
| 20 | low | utility_constraint | monitoring |  |  |  | APS/SRP Utility Capacity Constraints |
| 14 | low | rent_comp_signal | monitoring |  |  |  | Lease Comps and Vacancy Feeds |

