# Agentic Real Estate Research Run

- generatedAtUtc: 2026-02-17T19:49:42.3831405Z
- totalQueries: 124
- rawItems: 8
- uniqueLeads: 8
- leadsAboveThreshold: 8
- distressOpportunities: 1
- governmentDistressSignals: 0
- publicSignalLeads: 8
- configuredSources: 15
- sourcesWithHits: 8
- fallbackUsed: False

## Top Leads

| Score | Distress | Govt | Class | Source | City | Title | Domain | URL |
| ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| 84 | 20 | 0 | distress_opportunity | Maricopa Civil Court Foreclosure and Receivership |  | foreclosure |  |  |
| 76 | 12 | 0 | high_priority | CMBS Delinquency and Maturity Signals |  | cmbs_delinquency |  |  |
| 64 | 0 | 0 | medium_priority | Maricopa Recorder Trustee and Legal Notices |  | trustee_sale |  |  |
| 60 | 0 | 0 | medium_priority | Arizona Bankruptcy Filings |  | bankruptcy |  |  |
| 54 | 0 | 0 | medium_priority | Arizona UCC Filings |  | ucc_distress |  |  |
| 52 | 0 | 0 | medium_priority | Maricopa Assessor Ownership History |  | ownership_transfer | parcel 101-01-001C |  |  |
| 40 | 0 | 0 | low_priority | APS/SRP Utility Capacity Constraints |  | utility_constraint |  |  |
| 34 | 0 | 0 | low_priority | Lease Comps and Vacancy Feeds |  | rent_comp_signal |  |  |

## Source Coverage

| Source | Type | Queries | Raw Items | Unique Leads | Ranked Leads |
| --- | --- | ---: | ---: | ---: | ---: |
| aps_srp_utility_constraints | unknown | 0 | 1 | 1 | 1 |
| arizona_bankruptcy_filings | unknown | 0 | 1 | 1 | 1 |
| arizona_ucc_filings | unknown | 0 | 1 | 1 | 1 |
| maricopa_recorder_document_feed | unknown | 0 | 1 | 1 | 1 |
| maricopa_civil_court | unknown | 0 | 1 | 1 | 1 |
| maricopa_assessor_ownership_history | unknown | 0 | 1 | 1 | 1 |
| cmbs_distress_signals | unknown | 0 | 1 | 1 | 1 |
| lease_comps_vacancy_feeds | unknown | 0 | 1 | 1 | 1 |
| City Planning and Permitting Signals | government_planning | 38 | 0 | 0 | 0 |
| CREXi Listings | listing_marketplace | 16 | 0 | 0 | 0 |
| LoopNet Listings | listing_marketplace | 16 | 0 | 0 | 0 |
| Maricopa Assessor Parcel Signals | government_data | 11 | 0 | 0 | 0 |
| Auction.com Distressed Inventory | auction_marketplace | 11 | 0 | 0 | 0 |
| CommercialCafe Listings | listing_marketplace | 11 | 0 | 0 | 0 |
| Maricopa County Auctions and Leases | government_auction | 3 | 0 | 0 | 0 |
| Maricopa Recorder Trustee Notices | government_legal | 3 | 0 | 0 | 0 |
| Maricopa Treasurer Tax Lien | government_tax | 3 | 0 | 0 | 0 |
| Colliers Market Reports | broker_research | 2 | 0 | 0 | 0 |
| NAIOP Market Reports | industry_research | 2 | 0 | 0 | 0 |
| CBRE Market Reports | broker_research | 2 | 0 | 0 | 0 |
| Avison Young Market Reports | broker_research | 2 | 0 | 0 | 0 |
| Maricopa Tax Deeded Land Sales | government_tax | 2 | 0 | 0 | 0 |
| MCSO Sheriff Sales | government_auction | 2 | 0 | 0 | 0 |

## Suggested Swarm Actions

- Validate listing status and current ask against broker or listing portal.
- Prioritize leads with classification=distress_opportunity for immediate outreach.
- Cross-check top leads against Maricopa Treasurer tax-lien and tax-deed sources before outreach.
- Use parcel-centric public signal context (tax, legal, code, utility, permit, CMBS) to prioritize negotiation order.
- Pull recorder notice + MCSO auction context for leads carrying foreclosure or trustee-sale signals.
- Pull assessor parcel-level history for leads carrying governmentDistressScore > 0.
- Review Phoenix and West Valley permitting/planning feeds for zoning or code signals near shortlisted assets.
- Request rent roll and concessions where price-reduced or vacancy language appears.
- Compare each shortlisted lead against latest quarterly medians before LOI strategy.
- Use macro context (rates + CRE index trend) to bias outreach timing and offer aggressiveness.
- Refresh broker and NAIOP reports monthly to detect vacancy/rent inflections before they hit listing portals.

