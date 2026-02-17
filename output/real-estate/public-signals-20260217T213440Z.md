# Real Estate Public Signals Run

- generatedAtUtc: 2026-02-17T21:34:40.7228549Z
- configuredSources: 21
- enabledSources: 21
- stagingDir: D:\monsoonfire-portal\output\real-estate\staging\public-signals
- manualDropDir: D:\monsoonfire-portal\output\real-estate\manual-drops
- loadedSources: 19
- failedSources: 0
- totalSignals: 620
- highPrioritySignals: 21
- mediumPrioritySignals: 354
- promptInjectionScanned: 620
- promptInjectionFlagged: 0
- promptInjectionBlocked: 0

## Source Status

| Source | Type | Status | Loaded From | Rows | PI Flagged | PI Blocked |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Reddit Local Commercial Signals | community_signal | ok | local | 44 | 0 | 0 |
| Meta Marketplace Community Signals | community_signal | ok | local | 1 | 0 | 0 |
| Grants.gov Opportunities | grant_program | ok | local | 12 | 0 | 0 |
| Arizona Commerce Grants and Incentives | grant_program | ok | local | 1 | 0 | 0 |
| City of Phoenix Business Grants Programs | grant_program | ok | local | 1 | 0 | 0 |
| SBA Grants and Funding Programs | grant_program | ok | local | 2 | 0 | 0 |
| Arizona State Surplus Property Auctions | government_auction | ok | local | 2 | 0 | 0 |
| Maricopa Local Surplus Property Auctions | government_auction | ok | local | 1 | 0 | 0 |
| Federal Real Property Disposals and Auctions | government_auction | ok | local | 16 | 0 | 0 |
| Maricopa Treasurer Delinquent Roll | government_tax | ok | local | 31 | 0 | 0 |
| Maricopa Recorder Trustee and Legal Notices | government_legal | ok | local | 2 | 0 | 0 |
| Arizona UCC Filings | government_legal | ok | local | 1 | 0 | 0 |
| Arizona Bankruptcy Filings | government_legal | ok | local | 1 | 0 | 0 |
| Maricopa Civil Court Foreclosure and Receivership | government_legal | ok | local | 1 | 0 | 0 |
| Maricopa Assessor Ownership History | government_data | ok | local | 500 | 0 | 0 |
| APS/SRP Utility Capacity Constraints | utility_data | ok | local | 1 | 0 | 0 |
| West Valley Code Enforcement | government_planning | skipped_missing_input | none | 0 | 0 | 0 |
| Phoenix and West Valley Permitting Pipeline | government_planning | skipped_missing_input | none | 0 | 0 | 0 |
| Lease Comps and Vacancy Feeds | market_data | ok | local | 1 | 0 | 0 |
| CMBS Delinquency and Maturity Signals | finance_data | ok | local | 1 | 0 | 0 |
| Environmental and Land-Use Constraints | regulatory_data | ok | local | 1 | 0 | 0 |

## Top Signals

| Score | Priority | Signal Type | Stage | City | Parcel | Owner | Source |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 64 | high | government_auction_opportunity | auction_scheduled | Maricopa County |  | Maricopa County | Maricopa Local Surplus Property Auctions |
| 64 | high | government_auction_opportunity | auction_scheduled | Arizona |  | Arizona Surplus Listings | Arizona State Surplus Property Auctions |
| 64 | high | government_auction_opportunity | auction_scheduled | Arizona |  | Arizona Department of Administration | Arizona State Surplus Property Auctions |
| 63 | high | trustee_sale | notice_filed | Maricopa County |  | Maricopa County Recorder | Maricopa Recorder Trustee and Legal Notices |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 60 | high | government_auction_opportunity | auction_scheduled |  |  |  | Federal Real Property Disposals and Auctions |
| 55 | high | trustee_sale | monitoring | Maricopa County |  | Maricopa County Recorder | Maricopa Recorder Trustee and Legal Notices |
| 52 | medium | ownership_transfer | monitoring | TOLLESON | 101-14-162 | AMEZCUA DENNY MATA/CASTILLO MARAY | Maricopa Assessor Ownership History |
| 52 | medium | ownership_transfer | monitoring | AVONDALE | 101-01-289 | ADKINS JAMES PETER/KAYLA VICTORIA | Maricopa Assessor Ownership History |
| 50 | medium | grant_opportunity | funding_open | Phoenix |  | City of Phoenix EED | City of Phoenix Business Grants Programs |
| 50 | medium | grant_opportunity | funding_open | Phoenix |  | Arizona Commerce Authority | Arizona Commerce Grants and Incentives |
| 48 | medium | ownership_transfer | monitoring | AVONDALE | 101-01-471 | LOPEZ FRYDA MENDOZA/CARDENAS ANDREW | Maricopa Assessor Ownership History |
| 48 | medium | ownership_transfer | monitoring | AVONDALE | 101-01-043 | GASTELUM IRAM D CHAVARIN | Maricopa Assessor Ownership History |
| 48 | medium | ownership_transfer | monitoring | AVONDALE | 101-01-310 | MALMROSE CARA | Maricopa Assessor Ownership History |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |
| 47 | medium | tax_delinquent | monitoring | Maricopa County |  |  | Maricopa Treasurer Delinquent Roll |

