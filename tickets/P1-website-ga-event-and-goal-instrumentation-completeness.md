# Website GA event and goal instrumentation completeness

Status: Proposed
Priority: P1
Severity: Sev2
Component: website
Impact: high
Tags: website, analytics, instrumentation, conversions

## Problem statement
Without a validated event and goal map, conversion reporting can be inconsistent across device classes and marketing pages.

## Proposed solution
Audit all key pages and interactions against a single analytics event contract so GA can reliably answer:
- how users arrive
- what actions they take
- where they abandon
- where conversion starts and completes

## Tasks
1. Extract current GA property ID, stream, and view filters for the website.
1. Build a canonical event taxonomy for key website intents:
   - primary CTA clicks
   - quote/contact starts
   - membership/inquiry attempts
   - contact attempts with completed forms
   - phone/email/WhatsApp clicks
1. Map each event to a GA goal/funnel path and document field schema (`source`, `campaign`, `page`, `step`, `device`, `locale`).
1. Validate current implementation on desktop + mobile using either GA real-time or GA debugger snapshots.
1. Create a remediation list for missing or duplicate tracking and estimate implementation effort.

## Acceptance criteria
- Canonical event list is versioned and reviewed by product + marketing.
- At least one explicit conversion goal exists for each critical path.
- Duplicate event names are eliminated where one semantic action is represented by many variants.
- A weekly validation checklist is created and assigned to runbook owner.

## Dependencies
- Access to website source or analytics configuration for instrumentation checks.
- GA admin or editor access with event/goal management permission.

## Manual test checklist
1. Click each mapped CTA in staging and confirm events/funnel entries match expected names.
1. Submit one full inquiry flow and one partial flow to validate end-to-end event sequence.
1. Confirm no JavaScript runtime warning surfaces when event tags are disabled.
