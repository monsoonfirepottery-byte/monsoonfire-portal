# Firing ticket issuance bridge

Updated: 2026-07-13

## Outcome

Step 05 is one sanity check, not a delivery-mode chooser. The artist reviews the
estimate, supplies a name or nickname plus an email, and chooses `Let’s fire it`.
That one idempotent request creates the human-readable ticket, tells the studio
to expect the dropoff, and emails the artist the practical handoff packet. A
printable copy remains available after success, but printing is not a gate or a
required decision.

The ticket ID, such as `MF-0713-7K2P`, is the studio lookup and future billing
key. The ticket remains an intake request: it is not a final quote, payment,
pickup-ready claim, or guarantee that every material will survive firing.

Pickup and quick-help requests use the same safe submission bridge without
pretending they are new dropoffs. A pickup-detail resend is stored as
`pickup_details_requested` with `billingStatus: not_applicable`; an optional
question is stored as `support_requested` with `billingStatus: not_applicable`.
Neither audience email contains a price or estimate row.

## Prior art and reuse decision

- Firestore remains the online source of truth. The public intake path does not
  depend on PostgreSQL, Stripe, or a home-server tunnel.
- The installed Firebase Trigger Email extension remains the delivery path. Its
  documented contract is one trusted Firestore document per message with
  server-owned `to`, `replyTo`, `message.text`, and `message.html` fields:
  <https://firebase.google.com/docs/extensions/official/firestore-send-email>.
- The existing strict selection schema, idempotency key, honeypot, Zod
  validation, IP rate limiter, support request, and atomic ticket transaction
  are reused. No CAPTCHA is added without evidence that those controls are
  insufficient.
- The transaction now writes two different mail documents: a staff intake email
  and an artist-facing packet. That keeps each audience’s instructions private
  and legible while preserving all-or-nothing ticket issuance.
- Browser-native printing remains an optional post-success utility. No PDF or
  client mail dependency is added.
- Frozen v1/v2 requests and the former `print`, `email`, and `both` schema values
  remain accepted for deployed-client compatibility. The current browser always
  submits the email path and no longer exposes those modes.

## Delivery storyboard

1. The artist completes the task-first flow and reaches Step 05.
2. The page shows the firing range, estimated space, estimated price, and the
   same after-firing billing policy already explained in Step 04.
3. The page asks only for a name or nickname, a valid email, and an optional
   studio note. There is no print/email/both radio group and no separate consent
   checkbox; the button copy states that submitting requests transactional
   ticket and follow-up email.
4. `Let’s fire it` sends one canonical answer tuple with `deliveryMode: email`.
   Price, labels, recipient, policy copy, and HTML remain server-owned.
5. One Firestore transaction creates `firingTickets/{ticketId}`,
   `supportRequests/{id}`, the staff mail job, and the artist mail job. An exact
   retry returns the same ID and creates no second mail job. A changed payload
   with the same idempotency key is rejected.
6. The studio email contains the intake summary, reply address, billing note,
   and tray instruction.
7. The artist HTML/text packet contains the ticket, what happens next, the
   kiln-risk explanation, transport guidance, and a concise policy summary. It
   keeps the private-home-studio boundary: the private address/access details
   follow studio confirmation.
8. The success view shows the compact reference and offers `Print a copy` and
   `Copy ticket` as secondary utilities. Neither creates another ticket or mail.
9. Any server failure leaves the artist’s answers in place, issues no success
   state, and opens no print dialog.

## Browser contract

```json
{
  "clientRequestId": "fp_YYYYMMDD_<random id>",
  "name": "Artist nickname",
  "email": "artist@example.com",
  "note": "Optional context",
  "consentToContact": true,
  "deliveryMode": "email",
  "website": "",
  "pagePath": "/firing-services/pathfinder/",
  "selection": {
    "modelVersion": 3,
    "intentId": "dropoff",
    "workId": null,
    "heatId": "mid",
    "spaceId": "double"
  }
}
```

`consentToContact: true` records the explicit transactional-email action on the
submit button; it is not marketing consent. A v3 dropoff always sends
`workId: null`; inferring a clay body from the firing range is forbidden.

## Server-owned artifacts

| Artifact | Current Step 05 consequence |
| --- | --- |
| `firingTickets/{ticketId}` | `expected_dropoff`, `billingStatus: unbilled`, compact stable ID |
| `supportRequests/{id}` | staff intake queue record with canonical artifact and artist reply address |
| `mail/{support-id}` | formatted staff HTML/text ticket to `support@monsoonfire.com` |
| `mail/{artist-id}` | separate formatted artist HTML/text packet to the validated submitted email |
| Staff handoff | says the dropoff is expected and the ticket belongs in the firing intake tray |
| Artist handoff | ticket, access sequence, kiln-risk facts, safe-transport tips, and human policy summary |
| Optional print | same returned ticket ID; native print dialog only after an explicit success-view click |

For non-dropoff paths, the same collection names preserve one operational
bridge while the document semantics change:

- Pickup resend: `pickup_details_requested` / `not_applicable`; the artist gets
  the ready-note, self-serve access, and safe-trip reminder, and can reply if
  private details need to be resent.
- Quick-help question: `support_requested` / `not_applicable`; the artist gets
  a short confirmation and the studio gets the selected topic plus note.
- Price, estimated space, billing policy, and firing-intake-tray language are
  excluded from both paths.

The server reconstructs route, details, subjects, HTML, text fallbacks,
recipients,
timestamps, and document IDs. Artist-authored text is escaped before it reaches
HTML. Dropoff-only selections also reconstruct firing range, estimated kiln
space, price, and billing language. The public client cannot choose an arbitrary
mail recipient or body.

## Price and policy authority

- Pending release: low one/two/three half shelves are `$20` / `$40` / `$60`, with an `$80` per-client base cap.
- Mid one/two/three half shelves are `$35` / `$70` / `$105`, with a `$120` per-client base cap.
- Private firing adds `$20`; same-night rush adds `$20` only if fulfilled.
- Custom firing receives a separate staff quote. Newly created tickets carry the pricing version; existing tickets retain their recorded pricing.
- Unknown firing range or space produces no estimate.
- The estimate appears before submission. The final charge is set after firing
  from actual fitted space. A studio-caused loss has no firing charge; an
  artist material/glaze/construction problem remains chargeable.
- The artist packet summarizes the current authoritative policy page and links
  to <https://monsoonfire.com/policies/> instead of inventing a parallel policy.

## Proof and abort contract

Current local evidence:

- 56/56 Pathfinder component/model/submission tests pass, including six repeated
  Step 02 ↔ Step 03 cycles with all three example image sources preserved.
- The Firebase function builds and its focused suite passes 19/19, including
  strict tuples, idempotency, HTML escaping, fixed recipients, both mail jobs,
  the full artist packet, non-billable support questions, and the useful pickup
  reminder with no estimate language.
- The focused browser suite passes 11/11, including one-height 1265 x 720 pickup
  and quick-help screens plus the visually separate three-card help menu.
- The existing one-page print contract remains covered and printing does not
  occur during submit.

Do not promote if any frozen tuple regresses; if one click creates more than one
ticket, support request, staff mail, or artist mail; if arbitrary recipient/body
content becomes client-controlled; if the artist packet omits risk, transport,
or policy guidance; if private access details are exposed in the public bundle;
if print opens during submit; if a server failure clears the form; if the
compact ID changes on exact retry; or if PostgreSQL/Stripe availability can
block intake. Also abort if pickup or quick help inherits a price, estimate,
dropoff tray instruction, or billable ticket state.
