# SCHEMA_SUPPORT.md

This document covers the Firestore schema for FAQ content and support submissions.

## Collection: faqItems

Used by the Support view to render live FAQ content.

Fields
- question: string (required)
- answer: string (required)
- category: "Account" | "Pieces" | "Kiln" | "Classes" | "Membership" | "Billing" | "Studio" | "Other" (required)
- tags: string[] (optional, lower-case keywords)
- rank: number (required, used for ordering)
- isActive: boolean (optional, defaults to true when omitted)
- policySlug: string (optional, canonical policy slug for linked answers)
- policyVersion: string (optional, canonical policy version used for the answer)
- sourceType: "canonical_summary" | "announcement_summary" | "operational_faq" (optional)
- createdAt: timestamp (optional)
- updatedAt: timestamp (optional)

Query
- Support view subscribes to `faqItems` ordered by `rank` ascending.
- Items with `isActive == false` are ignored.

### Seed data (recommended)
Create documents with the following IDs and fields:

```json
[
  {
    "id": "faq-ready-pickup",
    "question": "When will my pieces be ready for pickup?",
    "answer": "We post updates as each firing completes. Check My Pieces for the latest status and timeline. Pickup-ready notices start the pickup timeline, and if you have a deadline, include the date in a support request so staff can review it.",
    "category": "Pieces",
    "tags": ["pickup", "ready", "turnaround", "timeline", "firing"],
    "rank": 1,
    "policySlug": "firing-scheduling",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "isActive": true
  },
  {
    "id": "faq-track-pieces",
    "question": "Where do I track my pieces and firing status?",
    "answer": "Open My Pieces to see active work, current stages, and archived pieces. Tap a piece to view its timeline updates and any notes from the studio.",
    "category": "Pieces",
    "tags": ["pieces", "status", "timeline", "tracking"],
    "rank": 2,
    "isActive": true
  },
  {
    "id": "faq-kiln-schedule",
    "question": "How do kiln firings get scheduled?",
    "answer": "Firings are batched by clay body and kiln availability. The Kiln Schedule view shows estimate bands rather than guarantees, and timing can shift. If you need a deadline reviewed, send the date and request details so staff can advise.",
    "category": "Kiln",
    "policySlug": "firing-scheduling",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "tags": ["kiln", "schedule", "firing", "batch"],
    "rank": 3,
    "isActive": true
  },
  {
    "id": "faq-class-booking",
    "question": "How do I book, reschedule, or join a class waitlist?",
    "answer": "Classes are listed in the Classes tab. Full sessions show waitlist status. If you need to reschedule, send the class name and your preferred dates.",
    "category": "Classes",
    "tags": ["classes", "waitlist", "reschedule", "booking"],
    "rank": 4,
    "isActive": true
  },
  {
    "id": "faq-billing-receipt",
    "question": "I need billing help or a receipt. What should I do?",
    "answer": "Submit a support request with the date, amount, and what you need (receipt, refund question, or charge review). We will follow up with the details.",
    "category": "Billing",
    "policySlug": "payments-refunds",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "tags": ["billing", "receipt", "invoice", "payment"],
    "rank": 5,
    "isActive": true
  },
  {
    "id": "faq-membership",
    "question": "How do I change, pause, or cancel my membership?",
    "answer": "Membership changes are being streamlined. For now, send a request with your current plan and the change you want, and we will handle it for you.",
    "category": "Membership",
    "policySlug": "payments-refunds",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "tags": ["membership", "plan", "pause", "cancel"],
    "rank": 6,
    "isActive": true
  },
  {
    "id": "faq-kiln-reservations",
    "question": "Can I reserve kiln time from the portal?",
    "answer": "Kiln reservations are in progress. Use this form to request a booking or change, and include your clay body, size, preferred window, and any deadline you need reviewed.",
    "category": "Kiln",
    "policySlug": "firing-scheduling",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "tags": ["kiln", "reservation", "schedule"],
    "rank": 7,
    "isActive": true
  },
  {
    "id": "faq-missed-class",
    "question": "What happens if I miss a class?",
    "answer": "If you cannot attend, let us know as soon as possible. We will work with you on a make-up option or the next available session.",
    "category": "Classes",
    "tags": ["classes", "missed", "late", "reschedule"],
    "rank": 8,
    "isActive": true
  },
  {
    "id": "faq-account-update",
    "question": "How do I update my account email or profile name?",
    "answer": "Account changes are tied to your Google sign-in. If you need to switch emails or update your display name, send a request and we can update your studio profile.",
    "category": "Account",
    "tags": ["account", "email", "profile", "signin"],
    "rank": 9,
    "isActive": true
  },
  {
    "id": "faq-announcements",
    "question": "Where do I find studio announcements?",
    "answer": "Go to Messages to view announcements and direct messages. Unread items show a badge in the navigation and the top bar.",
    "category": "Studio",
    "tags": ["announcements", "messages", "updates"],
    "rank": 10,
    "isActive": true
  },
  {
    "id": "faq-storage",
    "question": "What is the shelf-space and storage policy?",
    "answer": "Finished work enters the pickup-ready storage timeline as soon as it is marked ready. If you need an extended hold, ask about prepaid storage before billed storage begins.",
    "category": "Studio",
    "policySlug": "storage-abandoned-work",
    "policyVersion": "2026-04-02",
    "sourceType": "operational_faq",
    "tags": ["storage", "shelf", "pickup", "policy"],
    "rank": 11,
    "isActive": true
  },
  {
    "id": "faq-urgent",
    "question": "What counts as urgent support?",
    "answer": "Anything time-sensitive, same-day pickup change requests, or safety issues should go directly to the studio. Same-day pickup is not guaranteed, but urgent timing requests should still be reviewed quickly.",
    "category": "Studio",
    "tags": ["urgent", "safety", "contact"],
    "rank": 12,
    "isActive": true
  }
]
```

Notes
- Keep `rank` unique for deterministic ordering.
- Keep `tags` lower-case to improve search matching.

## Collection: supportRequests

Created by the Support form for non-urgent questions.

Fields
- uid: string (required)
- subject: string (required)
- body: string (required)
- category: SupportRequestCategory (required)
- status: string (required, current: "new")
- urgency: string (required, current: "non-urgent")
- channel: string (required, current: "portal")
- createdAt: timestamp (required)
- displayName: string | null (optional)
- email: string | null (optional)
- policyResolution.resolvedPolicySlug: string | null (optional)
- policyResolution.resolvedPolicyVersion: string | null (optional)
- policyResolution.discrepancyFlag: boolean | null (optional)
- policyResolution.escalationReason: string | null (optional)

Notes
- Do not write undefined; omit fields or use null when unknown.
