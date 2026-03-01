# Website GA Event + Goal Map (Canonical)

Version: 2026-02-28
Owner: web + marketing
Scope: `website/` + `website/ncsitebuilder/` public surfaces

## Event contract
| event_name | goal_name | funnel_step | trigger_surface | required_params | status |
|---|---|---|---|---|---|
| `cta_primary_click` | `quote_start` | `landing_cta` | primary CTA links | `source,campaign,page,device,locale` | implemented |
| `quote_form_open` | `quote_start` | `form_open` | contact intake form | `source,campaign,page,device,locale` | implemented |
| `quote_form_submit` | `quote_complete` | `form_submit` | contact intake form | `source,campaign,page,device,locale` | implemented |
| `contact_phone_click` | `contact_intent` | `alt_contact` | phone links | `source,campaign,page,device,locale` | implemented |
| `contact_email_click` | `contact_intent` | `alt_contact` | mailto links | `source,campaign,page,device,locale` | implemented |
| `whatsapp_click` | `contact_intent` | `alt_contact` | WhatsApp links | `source,campaign,page,device,locale` | implemented |

## Runtime notes
- Outbound campaign links to known partner hosts are auto-tagged with missing `utm_source`, `utm_medium`, and `utm_campaign`.
- `cta_click` remains as a broad interaction signal; canonical events above are the stable conversion contract.

## Weekly validation checklist
1. Run `npm run website:ga:event-goal:check` and confirm all checks pass.
1. Run `npm run website:ga:campaign:audit -- --strict` and confirm effective UTM coverage is `>= 80%`.
1. Validate one desktop and one mobile contact flow:
   - `quote_form_open` fires on first form interaction.
   - `quote_form_submit` fires on successful submit.
1. Record any GA property-side goal mismatches in `tickets/P1-website-ga-event-and-goal-instrumentation-completeness.md`.
1. Attach latest JSON artifacts from `artifacts/ga/reports/`.

