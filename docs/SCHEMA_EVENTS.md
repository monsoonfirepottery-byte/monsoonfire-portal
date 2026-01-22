# SCHEMA_EVENTS.md

This schema defines Events, waitlist, check-ins, and attendance-based payments.

## Collection: eventTemplates

Purpose
- Define reusable event copy, add-ons, and policy strings.
- Events copy these values at publish time for stability.

Fields
- title: string (required)
- summary: string (required)
- description: string (required)
- location: string (required)
- timezone: string (required)
- basePriceCents: number (required)
- currency: string (required, e.g. "USD")
- includesFiring: boolean (required)
- firingDetails: string | null (optional)
- policyCopy: string (required; low-stress payment policy)
- addOns: array (optional)
  - id: string (required)
  - title: string (required)
  - priceCents: number (required)
  - isActive: boolean (required)
- defaultCapacity: number (optional)
- waitlistEnabled: boolean (required; default true)
- offerClaimWindowHours: number (required; set to 12)
- cancelCutoffHours: number (required; set to 3)
- isActive: boolean (required)
- createdAt: timestamp (required)
- updatedAt: timestamp (required)

Notes
- Keep add-on IDs stable within a template.
- Add-ons are selectable only at check-in.

## Collection: events

Purpose
- Published instances of an event.

Fields
- templateId: string | null (optional)
- title: string (required)
- summary: string (required)
- description: string (required)
- location: string (required)
- timezone: string (required)
- startAt: timestamp (required)
- endAt: timestamp (required)
- capacity: number (required)
- priceCents: number (required)
- currency: string (required)
- includesFiring: boolean (required)
- firingDetails: string | null (optional)
- policyCopy: string (required)
- addOns: array (optional)
  - id: string (required)
  - title: string (required)
  - priceCents: number (required)
  - isActive: boolean (required)
- waitlistEnabled: boolean (required)
- offerClaimWindowHours: number (required, 12)
- cancelCutoffHours: number (required, 3)
- status: "draft" | "published" | "cancelled" (required)
- ticketedCount: number (required, default 0)
- offeredCount: number (required, default 0)
- checkedInCount: number (required, default 0)
- waitlistCount: number (required, default 0)
- createdAt: timestamp (required)
- updatedAt: timestamp (required)
- publishedAt: timestamp | null (optional)

Notes
- Copy template fields into events when publishing.
- Never write undefined; omit or use null.

## Collection: eventSignups

Purpose
- Represents both ticketed and waitlist entries for attendees.

Fields
- eventId: string (required)
- uid: string (required)
- status: "ticketed" | "waitlisted" | "offered" | "checked_in" | "cancelled" | "expired" (required)
- offerExpiresAt: timestamp | null (optional; set on waitlist offer)
- offeredAt: timestamp | null (optional)
- checkedInAt: timestamp | null (optional)
- checkedInByUid: string | null (optional)
- checkInMethod: "staff" | "self" | null (optional)
- paymentStatus: "unpaid" | "paid" | "checkout_pending" | "waived" (required; default "unpaid")
- displayName: string | null (optional)
- email: string | null (optional)
- createdAt: timestamp (required)
- updatedAt: timestamp (required)

Indexes (likely)
- eventId + status + createdAt
- eventId + createdAt

Notes
- Attendee cancellation allowed until event.startAt minus cancelCutoffHours.
- Waitlist promotion sets status to "offered" with offerExpiresAt = now + offerClaimWindowHours.
- Offer claim sets status to "ticketed" and clears offerExpiresAt.
- Staff check-in sets status to "checked_in" without requiring payment first.

## Collection: eventCharges (optional)

Purpose
- Store receipt records tied to check-in-based payments.

Fields
- eventId: string (required)
- signupId: string (required)
- uid: string (required)
- lineItems: array (required)
  - id: string (required)
  - title: string (required)
  - priceCents: number (required)
  - quantity: number (required)
- totalCents: number (required)
- currency: string (required)
- paymentStatus: "checkout_pending" | "paid" | "failed" (required)
- stripeCheckoutSessionId: string | null (optional)
- stripePaymentIntentId: string | null (optional)
- paidAt: timestamp | null (optional)
- createdAt: timestamp (required)
- updatedAt: timestamp (required)

## Local seeding

Use the seed script for local testing (emulator-friendly):
- `functions/scripts/seedEvents.js`
- Run from repo root:
  - `node functions/scripts/seedEvents.js`

The script writes two published events with add-ons and the low-stress policy copy.

## Security Notes
- Attendees read published events and their own eventSignups.
- Staff can read/manage signups and check-ins.
- Server-side enforcement for capacity, waitlist offer expiry, and cancellation cutoff.

## Copy Reference
Policy copy recommended:
- "You won't be charged unless you attend. If plans change, no worries - cancel anytime up to 3 hours before the event."
- "A spot opened up. Claim within 12 hours to secure your ticket."
