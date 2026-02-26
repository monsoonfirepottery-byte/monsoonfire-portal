# Website GA Event + Goal Map Template

Use this as the canonical Sprint 1 map for website events and conversion goals.

| event_name | goal_name | funnel_step | trigger_surface | required_params | device_scope | owner | status |
|---|---|---|---|---|---|---|---|
| cta_primary_click | quote_start | landing_cta | home hero CTA | source,campaign,page,device,locale | desktop+mobile | web | planned |
| quote_form_open | quote_start | form_open | quote/contact page | source,campaign,page,device,locale | desktop+mobile | web | planned |
| quote_form_submit | quote_complete | form_submit | quote/contact page | source,campaign,page,device,locale | desktop+mobile | web | planned |
| contact_phone_click | contact_intent | alt_contact | phone link | source,campaign,page,device,locale | desktop+mobile | web | planned |
| contact_email_click | contact_intent | alt_contact | email link | source,campaign,page,device,locale | desktop+mobile | web | planned |
| whatsapp_click | contact_intent | alt_contact | WhatsApp link | source,campaign,page,device,locale | desktop+mobile | web | planned |

## Validation checklist
1. Each critical path has at least one start + completion event.
2. Event names are unique and stable across pages.
3. Required params are emitted on desktop and mobile.
4. Goal mapping matches GA property configuration names.
