# Website GA UTM Taxonomy

## Required params
- `utm_source`
- `utm_medium`
- `utm_campaign`

Optional:
- `utm_content`
- `utm_term`

## Naming rules
1. Lowercase only.
2. Use `snake_case`.
3. Avoid spaces and punctuation besides underscores.
4. Campaign names should encode intent + period (example: `spring_open_studio_2026q1`).

## Canonical mediums
- `email`
- `organic`
- `paid_search`
- `paid_social`
- `referral`
- `sms`
- `partner`

## Canonical source examples
- `instagram`
- `facebook`
- `google`
- `newsletter`
- `yelp`
- `partner_directory`

## QA sampling checklist
1. Open three links per major channel in private browsing.
2. Confirm query string contains required UTM keys.
3. Confirm GA acquisition rows classify source/medium as expected.
4. Document mismatches for remediation in campaign quality ticket.
