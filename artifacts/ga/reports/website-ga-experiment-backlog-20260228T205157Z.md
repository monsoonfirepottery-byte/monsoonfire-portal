# Website GA Experiment Backlog

- generatedAtUtc: 2026-02-28T20:51:57.146Z
- totalExperiments: 7
- maxConcurrentRecommended: 2

## Ranked Experiments

| Rank | Experiment | Impact | Confidence | Effort | Risk | Score | Owner |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Add concise 'What to expect' trust block under top CTA | 3 | 4 | 1 | 1 | 6 | web-content |
| 2 | Standardize campaign UTM fields and retire unstructured outbound links | 5 | 4 | 2 | 2 | 5 | marketing-ops |
| 3 | Clarify primary CTA label and placement on top service pages | 4 | 4 | 2 | 2 | 4 | web-content |
| 4 | Simplify contact-start field sequence to reduce friction | 5 | 3 | 3 | 2 | 3 | web-product |
| 5 | Add mobile trust panel above fold with contact options | 4 | 3 | 2 | 2 | 3 | web-product |
| 6 | Align low-intent high-volume channel landing pages to stronger intent match | 4 | 3 | 2 | 2 | 3 | marketing-web |
| 7 | Refresh FAQ snippets for highest-traffic inquiry pages | 3 | 3 | 3 | 1 | 2.25 | web-content |

## Top 3 Traceability

- Add concise 'What to expect' trust block under top CTA
  signal: /faq/ -> /contact/ friction remediation
  hypothesis: Expectation-setting content improves progression into contact flow.
  successMetric: services->contact step progression +8%
  rollbackCondition: Engagement time drops >10% with no conversion gain
- Standardize campaign UTM fields and retire unstructured outbound links
  signal: campaign coverage 100%
  hypothesis: Consistent attribution increases decision quality and channel optimization speed.
  successMetric: effective campaign coverage >= 95%
  rollbackCondition: Coverage remains <80% after one release cycle
- Clarify primary CTA label and placement on top service pages
  signal: /faq/ -> /contact/ :: community
  hypothesis: CTA clarity will increase progression from services to contact intent.
  successMetric: cta_primary_click +12% on services pages
  rollbackCondition: No uplift after 14 days or conversion drop >3%

