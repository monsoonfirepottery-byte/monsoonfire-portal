# Pathfinder intake, handoff, and print contract

This is the rejectable build contract for the firing-range and ticket-handoff slice.
It exists to keep the implementation tied to an artist-visible outcome, not to
create an approval checkpoint.

## Prior art and reuse decision

- Reuse the existing native radio inputs, form submission bridge, canonical
  server artifact builder, existing Playwright stack, and `pickup-shelf.webp`
  transport image.
- Keep single-click selection plus the visible Continue button as the baseline.
  W3C's radio pattern treats selection as a distinct, keyboard-operable action;
  double-click is therefore an optional pointer shortcut, never the sole path.
- Use the existing padded-crate image for readiness. It already shows the
  desired behavior and avoids a new asset-generation/review loop.
- Use the owner-approved observable intake rule instead of asking artists to
  diagnose dryness: if the work can be packed and make the trip from the
  artist to the kiln without flexing, denting, or breaking, it is safe to bring
  in. The studio can hold safely transported work until it is actually ready
  to fire.
- Preserve the frozen v1/v2 earthenware safety rules for old clients. The new
  flow does not ask the artist to classify a clay body, so v3 must store no
  invented clay-body answer and must leave final material verification to the
  studio at intake.
- W3C tooltip guidance requires cone help to work on hover and keyboard focus,
  remain hoverable, and dismiss with Escape.
- Reuse the task-first, progressive-disclosure guidance already cited in
  `CONTENT_VOICE.md`: ask what the artist is here to do before asking for
  pottery details, and reveal only the questions required by that path.
- Reuse the browser's native print pipeline. MDN documents `@media print`,
  `@page`, and `window.print()` for a print-specific layout; CSS Paged Media
  defines Letter sizing as a preferred page target but does not control printer
  duplex settings or prove that paper was actually printed.
- Reuse Playwright's Chromium PDF output as the deterministic one-page proof.
  Do not add jsPDF, html2canvas, or a server PDF service unless a later slice
  requires a downloadable or attached PDF.
- Reuse `agent-service-catalog.json` as the half-shelf price source and the
  three owner-selected kiln-space illustrations as one explanatory sequence.
  Skutt documents that round and multi-sided kiln shelves are commonly offered
  as half shelves, and Olympic describes its round-kiln shelf as half-round:
  <https://skutt.com/ceramic-kilns/kiln-accessories/furniture-kits/> and
  <https://www.olympickilns.com/product/28-raku-or-28-torchbearer-half-shelf/>.
  The retired split lifestyle illustration and abstract shelf-count glyphs are
  rejected for this pane: both made the explainer compete with the actual radio
  choices. The selected fit-test, sizing-board, and kiln-cutaway images now teach
  footprint, width/height, and the lost shelf layer before the plain radios.
- Reuse the existing Firebase function and Firestore transaction. Firestore's
  documented atomic-write behavior lets the ticket ledger, support request, and
  mail job succeed together or not at all. A home-hosted PostgreSQL tunnel is
  explicitly deferred; it must not be on the public ticket-issuance path.
- New browser requests carry their issue date in the idempotency key and receive
  a compact deterministic ticket ID such as `MF-0711-7K2P`. The date is
  relatable, the four-character code avoids ambiguous characters, and the ID is
  stable across exact retries. Legacy undated request IDs keep the existing long
  format so deployed clients are not broken.

New code is justified only for the missing constraints and interactions. A
version-3 selection schema is required because version 2 required a clay-body
answer and had no space estimate. Versions 1 and 2 remain accepted unchanged.
No new workflow engine, PDF renderer, database tunnel, media pipeline, or
Kilnfire adapter is needed.

## Whole-flow storyboard

1. **Choose the task.** The first screen contains only `Drop off work`, `Pick up
   finished work`, and `Ask something else`. A single click selects; double-click
   selects and advances. Keyboard and touch retain the radio plus Continue path.
2. **Dropoff range.** Dropoff asks Low / Mid / High-custom / Unsure. Cone
   references remain optional accessible help. No clay-body choice, inferred
   material label, or hidden correction pane remains in the artist flow.
3. **Visual space estimate.** A compact, non-interactive three-frame strip is
   explicitly labeled `examples, not choices`. The fit-test shows one complete
   D-shaped load; the physical sizing board shows both the curved width boundary
   and 10-inch bar; the kiln cutaway shows why tall work consumes the shelf layer
   above. Below it, plain native radios ask for `1 half shelf`, `2 half shelves`,
   `3 half shelves`, `4 or more half shelves`, or `I'm not sure`. The two compact
   notes preserve stackable-bisque capacity and Advancer-shelf glaze guidance
   without repeating the width and height lesson. No photo is requested.
4. **Earned guidance and billing.** Pending release: low fire calculates $20/$40/$60 for one,
   two, or three half shelves, with an $80 per-client base cap. Mid fire calculates
   $35/$70/$105, with a $120 per-client base cap. Private firing adds $20;
   same-night rush adds $20 only when fulfilled. Custom firing requires a separate quote. Unknown range or
   space shows no estimate. Stage 04 then explains the operational billing rule:
   estimate up front, payment after firing based on the final fitted load, no
   charge for a studio-caused loss, and a payable firing when the loss comes
   from artist-supplied clay, glaze, construction, or another artist-side
   condition. A normal successful firing is payable at the final fitted amount.
5. **Pickup.** Pickup assumes the artist arrived from a ready notice. It skips
   firing and price language, confirms that the work has finished its studio
   path and is waiting for pickup, and points to the access details in the ready
   notice. An artist who still has those details can leave without creating
   another request; an artist who needs them again can ask for a pickup-details
   email.
6. **Other questions.** This is a visibly separate help path, not a smaller
   firing estimator. It reveals readiness, unusual-work, and unsure-firing
   topics as direct help cards, then shows a plain answer and optional studio
   follow-up. It never renders the price/risk measure grid or a price row.
   Readiness asks only whether the work can make the trip safely. If it can, the
   studio can hold it until it is actually ready to fire.
7. **Useful guidance only.** Guidance names the route once. It does not repeat
   `Mid fire` in a badge, heading, sentence, and risk card. Every remaining line
   adds a price boundary, action, safety check, or detail to bring.
8. **Sanity check in Step 5.** The artist sees one compact summary of firing
   range, estimated space, and estimated price. The only required fields are a
   name or nickname and an email address; the note is optional. There is no
   print/email/both fork and no separate consent checkbox for the transactional
   ticket and pickup messages.
9. **Submit once.** `Let’s fire it` calls the Firebase function once. One atomic
   transaction creates `firingTickets/{ticketId}` with `billingStatus: unbilled`,
   the support request, a formatted studio mail job, and a separate formatted
   artist mail job. The same compact `MF-MMDD-XXXX` ID is returned on an exact
   retry and appears on screen, paper, and both emails. Existing IDs remain valid.
10. **Send the useful packet.** The studio email says the dropoff is expected
    and carries the intake facts. The artist email carries the firing plan,
    studio/dropoff sequence, short kiln-risk facts, transport guidance, and a
    human summary of current studio policies. Private address/access details
    still follow the studio's published confirmation boundary.
11. **Keep paper optional.** Nothing prints during submission. After success,
    the artist may explicitly open the native print dialog for the same issued
    ticket or copy the ticket text. The one-page Letter layout remains
    grayscale-safe. The UI says the dialog opened, never that paper printed.
12. **Billing reminder.** Stage 04, the final screen, optional printed sheet, copied
    ticket, and emailed dropoff ticket carry the same practical billing policy:
    estimate now, pay after firing, studio-caused loss is not charged,
    artist/material/construction-caused loss remains payable, and a normal
    firing is charged at the final fitted amount. The kiln-gods line may follow
    as personality, but it may not replace or blur the policy.
13. **Recover without duplicates.** Back preserves earlier selections. A
    Firebase failure issues no ID and performs no print or email; all fields
    remain for retry. Exact retries reuse the same ticket and mail identities.
    A print-dialog cancellation does not undo the issued ticket. Copy remains a
    fallback, and no Pathfinder control redirects to Kilnfire. Existing
    model-version-1 selection IDs, support IDs, and Firestore documents remain valid.

## Asset and object map

| Object | Source | Behavior / state | Durable consequence |
| --- | --- | --- | --- |
| Task choice | `entryChoices` + native radio | Dropoff, pickup, or other; double-click select-and-advance | reducer records `entryId` and a compatible `intentId` when known |
| Other-question choice | `questionChoices` | reveals readiness, unusual, or unsure-firing help | maps to existing v1 intent IDs |
| Readiness scene | `pickup-shelf.webp` | padded-crate visual and transport caption | bundled Pathfinder asset |
| Readiness guidance | `getGuidance` | safe-to-travel check plus studio-hold promise | receipt and email artifact |
| Firing-range choice | `heatChoices` | comes before material; plain label plus optional cone tooltip | reducer records `heatId` |
| Sizing reference | three selected WebP assets in one non-interactive strip | fit-test, sizing-board, and kiln-cutaway views; explicitly marked as examples, not choices | teaches footprint, width/height, and lost shelf layer without a fake selector |
| Space-estimate choice | `spaceChoices` + native radios | explicit cards for 1, 2, 3, 4+, or unsure; double-click may advance; selected-range hint stays visible | reducer records `half`, `double`, `triple`, `large`, or `unknown` |
| Space-rule strip | library icons for stack and glaze guidance | preserves the two remaining fit details without repeating the image lesson | artist sees stacking and Advancer-shelf notes before accepting price |
| Cone help | info button + tooltip | hover/focus; hoverable; Escape closes | no cone jargon in primary choice copy |
| v3 dropoff selection | reducer + Zod union | records `heatId`, `spaceId`, and `workId: null` | no fabricated clay-body claim; v1/v2 remain frozen |
| Pickup ticket | v3 `collection` tuple; frozen v2 remains valid | no live-status claim; records contact and reference | support request + HTML mail job |
| Final check | summary article + one submit form | review range, space, and estimate; no delivery fork | one intentional submit action for the prepared ticket |
| Contact details | final ticket form | name or nickname and email required; note optional; transactional email intent stated beside the action | artist identity, reply address, and pickup-notice route |
| Screen ticket | existing receipt article | live preview of route, price, details, and entered contact data | copy fallback and human verification before action |
| Print ticket sheet | dedicated always-rendered DOM + `@media print` | only printable node; Letter portrait; grayscale-safe; no controls or site chrome | one-page physical handoff with studio intake blanks |
| Native print action | `window.print()` | opens blocking browser dialog from an explicit click | no success claim because browser exposes no printed/cancelled result |
| Permanent ticket ID | dated browser idempotency key + server hash | new `MF-MMDD-XXXX` IDs; stable exact replay; legacy fallback retained | billing and studio lookup key |
| Ticket ledger | `firingTickets/{ticketId}` | atomic create; `issued` or `expected_dropoff`; starts `unbilled` | online Firebase source of truth |
| Future billing link | Stripe object metadata | deferred; store `firing_ticket_id` when charging | reconciles payment without coupling intake to Stripe |
| PostgreSQL mirror | Studio Brain host | deferred asynchronous consumer only | never blocks public ticket issuance and needs no public DB port |
| Canonical server schema | versioned Zod selection union | accepts frozen v1/v2 tuples plus v3 task-first tuples | old clients remain valid; v3 cannot manufacture a work classification |
| Rate limiter | shared limiter call | 12 attempts/hour/IP; retry minutes returned | bounded abuse control without demo lockout |
| Artist packet | separate formatted HTML/text mail job | plan, dropoff sequence, kiln risk, transport, and humanized policies | artist receives actionable intake material without copying the staff mail |
| Completion | one `Let’s fire it` action; optional print/copy after success | one network submission; no automatic print; retry; no Kilnfire link | ticket, support request, studio mail, and artist mail share one transaction |
| Guidance summary | `Guidance`, receipt, and server email rows | route appears once; equal range/route rows collapse | less repetition without losing facts |

## Proof cases and evidence matrix

| Outcome | Passing evidence | Reject when |
| --- | --- | --- |
| Legacy low-fire safety | frozen v1/v2 server-schema tests | an old earthenware tuple can submit mid/high/unknown |
| Clay-check removal | reducer, DOM, and payload assertions | a dropoff asks for, infers, displays, or emails a clay-body answer |
| Visual volume estimate | current-run source/implementation comparison, three decoded explanatory images, five plain radio cards, and two compact rule notes | the image strip looks selectable, any selected view is missing, 3 and 4+ collapse, or the user misses width/height/stack/glaze rules |
| Earned price | model/server/browser matrix across heat and space | Step 4 shows a price before `spaceId`, uses piece count, or prices tall work as one half shelf |
| Human labels | DOM assertions and visual check | cone appears as a primary label or instruction |
| Accessible help | focus/hover/Escape DOM tests and keyboard visual check | cone detail is pointer-only or traps focus |
| Task-first opening | DOM and browser tests | first screen asks pottery type or shows more than the three approved tasks |
| Range-only dropoff | reducer and browser tests | a material-choice pane appears before or after firing range |
| App-like shortcut | DOM tests for double-click at task and range panes | first click advances or touch/keyboard Continue path disappears |
| Readiness guidance | model/DOM assertions plus scene visual check | branch omits safe transport, asks the artist to diagnose dryness, or fails to say the studio can hold safely transported work until firing-ready |
| Pickup truth | model, email, and browser assertions | page claims live status or tells an unconfirmed artist to travel |
| Content density | copy audit plus desktop/mobile screenshots | heading, badge, sentence, or ticket row repeats the same route without adding meaning |
| Kilnfire-free completion | DOM test and production link audit | receipt contains a Kilnfire CTA or URL |
| Reliable form | handler test, one live formatted-email submission, Firestore/mail proof | live form is rate-locked, duplicates either audience mail, or claims a booking |
| One-action completion | component and browser assertions | a delivery-choice fork remains, submission opens print, or a retry creates another ticket or mail pair |
| Permanent ID | compact-format and legacy-fallback unit tests, exact-replay test, Firestore document proof, screen/email/print assertions | new ID is receipt-length, ambiguous, changes on retry, or any final artifact omits it |
| Photo-free estimate | source/server scan plus screen/email/print assertions | the estimator or issued ticket asks the artist for a photo |
| Billing policy | Stage 04 plus screen/copy/print/email assertions | any dropoff artifact omits when payment occurs or who bears the firing charge after studio-caused versus artist-side loss |
| Atomic ledger | transaction fixture for ticket, support request, studio mail, and artist mail | any audience mail/support job exists without the ticket, or the two mail jobs disagree about the ticket ID |
| One-page print | worst-case Chromium PDF page-count assertion, print-media layout measurement, and rendered visual check | document has a second page, clips/wraps outside the sheet, relies on background color, or prints site chrome |
| Honest print status | stubbed `window.print` test and visible status assertion | UI claims printing succeeded or a physical sheet exists |
| Two-audience handoff | server HTML/text and stored-document assertions | staff copy omits expected-dropoff/tray context or artist copy omits plan, kiln risk, transport, or policy summary |
| Release | build, browser suite, desktop production visual check, clean console | client/server contract differs or production bundle is stale |

## Outcome-to-artifact consequences

- Changing a visible label requires matching server canonical labels and email
  tests so the artist and studio receive the same language.
- Changing a reachable choice requires matching reducer, selection schema,
  tuple-count test, and browser coverage.
- Removing the clay-body pane requires a v3 selection with `workId: null`, a
  conditional screen/email summary, and Back-state coverage. Mapping Low to
  earthenware or Mid to stoneware behind the scenes is forbidden.
- Adding the space estimator requires `spaceId` in the v3 schema, reducer, price
  calculation, screen/print/email summary, ticket ledger, tuple-count test, and
  browser coverage. A graphic-only choice that does not change price fails.
- Width and height guidance must remain inside the clearly non-interactive
  three-view strip; the actual shelf-count choices stay plain native radios. A
  divider, image picker, or decorative choice glyph that creates a second
  selector fails.
- Adding `triple` requires client and server schemas, canonical labels, price
  matrices, stored tickets, screen/print/copy/email artifacts, and tuple counts
  to agree before the new client is promoted.
- Adding the Stage 04 billing policy requires the same canonical copy on the
  guidance pane and every dropoff artifact; it must remain absent from unrelated
  pickup/readiness tickets.
- Removing photo requests requires client guidance, server canonical artifacts,
  screen/print/copy/email output, and tests to agree.
- Adding pickup creates a new `collection` selection while leaving the legacy
  `pickup` ID mapped to unfired-work readiness for v1 compatibility.
- Removing duplicate route copy requires the same conditional row rule in the
  browser receipt and server-rendered HTML/text email.
- Removing Kilnfire from completion requires removing `handoffUrl` from the
  model and updating `SUBMISSION_BRIDGE.md`; it does not authorize a repo-wide
  Kilnfire cancellation.
- Reusing the readiness media requires updating its alt text and caption to the
  new pre-firing meaning.
- A successful live test must be followed by clearing only the Pathfinder test
  rate bucket so verification cannot lock out the owner again.
- Adding a print layout requires the same ticket data to appear on screen, in
  the print-only DOM, and in the Playwright worst-case fixture. A clean-looking
  screen receipt is not print proof.
- Final submission always creates the ticket, support request, studio mail, and
  artist mail in one transaction. Optional print/copy actions use the returned
  ID without another network request. Sending must never claim printing occurred,
  and cancelling print must not create a second ticket.
- The permanent ID must come from the server before printing or email success is
  shown. The route artifact ID (`MF-DROPOFF-MID`, for example) is not unique and
  must never be used for billing.
- Firestore is the ticket source of truth. Any future PostgreSQL sync or Stripe
  billing write must carry the same `ticketId` and may retry without changing it.
- Compact IDs apply only when the dated idempotency prefix is present; legacy
  callers keep the old deterministic format instead of being remapped.

## Abort criteria

Stop promotion if any of these occur:

- The deployed server stops accepting a previously valid v1/v2 tuple or accepts
  an old earthenware tuple above low fire.
- The final action creates more than one ticket, support request, studio mail,
  or artist mail for an exact replay.
- Double-click causes two phase transitions or submits/prints a final ticket.
- The opening screen contains anything other than dropoff, pickup, and other.
- A dropoff asks the artist to classify ware or infers a ware type from heat.
- Step 4 shows a standard price without a selected space graphic, or gives
  unknown space a guessed price.
- The sizing reference contains a selection/form control or reads as a split
  option; inspect-only example buttons are allowed, but they must not change the
  estimate. The list lacks separate 1, 2, 3, and 4+ rows; the 4+ row omits the per-client
  base cap; or a cap is labeled as a minimum.
- Work over 10 inches can be priced as one half shelf, stackable bisque gets no
  capacity explanation, or Advancer glaze resistance is mistranslated into
  permission for ware to hang beyond the shelf.
- Pickup guidance implies live status or that work is ready without confirmation.
- Standard guidance or the final ticket repeats an identical range/route value.
- Tooltip help cannot be reached or dismissed by keyboard.
- The readiness copy asks the artist to diagnose dryness or omits that safely
  transported work can be held by the studio until it is ready to fire.
- Deployment would overwrite unrelated dirty-worktree changes or reintroduce a
  Pathfinder Kilnfire handoff.
- Print output spans more than one PDF page, hides overflow, includes controls or
  site chrome, or omits the artist name.
- Print reaches the dialog without a server-issued ticket ID or claims the paper
  printed successfully. Submission opens print automatically or creates another
  network request when the optional print action is used.
- The final check asks the artist to choose print/email/both, carries a separate
  consent checkbox for the transactional ticket, or hides the primary action
  below the 1265 x 720 laptop viewport.
- Email delivery succeeds without the staff copy saying that a dropoff is
  expected and its ticket should be added to the tray, or without the artist
  copy carrying the plan, kiln risk, transport, and human policy summary.
- Any current ticket asks for a photo, print-only scolds the artist about email,
  or Stage 04/screen/print/copy/email disagree about the billing policy.
- PostgreSQL availability, a home-host tunnel, or Stripe availability can block
  public ticket issuance.

The half-shelf metaphor is visual and the human feedback named this exact pane.
The focused local review surface is
`codex-work/homepage-design-20260708/firing-services-candidate/half-shelf-audit-20260711/half-shelf-review-pane.html`.
It compares the current production and revised runtime states, captures
approve/deny/feedback plus notes, exports a fallback review artifact and
next-agent prompt, and routes feedback to a narrower estimator pane if needed.

## Planning patch guard

- **Protected artifact:** `website/firing-pathfinder/FIRING_RANGE_RULES.md`, the
  dedicated print sheet in `website/firing-pathfinder/src/App.jsx`, and the
  versioned selection/ticket-ledger contract in
  `functions/src/firingPathfinderRequest.ts`.
- **Vulnerability closed:** the approved flow still spent an entire pane asking
  artists for a clay classification the studio does not need during intake,
  showed price before volume, and had neither a proven physical handoff nor a
  permanent billing identity.
- **New failing condition:** tests fail if a dropoff exposes or invents a
  clay-body answer; if the visual estimate omits `spaceId` or a granular rule;
  if Step 5 regains a delivery-choice fork; if either audience mail is missing;
  if any final artifact lacks the ticket ID; if print exceeds one page; or if
  the studio mail misses the tray route.
- **Burden-of-proof delta:** a browser button and attractive screen card are
  insufficient. Reducer, v1/v2/v3+space schema, price matrix, screen ticket,
  dedicated print DOM, worst-case PDF, Firestore ledger, HTML/text email,
  generated bundles, and production behavior must agree.
- **Immediate non-governance artifact:** the range-plus-visual-space React
  intake, earned Step 4 estimate, Firestore ticket, one-page optional physical
  ticket, and paired studio/artist Firebase mail handoff.
- **Historical lock closed 2026-07-11 (delivery fork superseded 2026-07-13):**
  the v3 function deployed before the v3 client; the
  maximum-content Letter PDF rendered as one unclipped page; all 24 v3 tuples
  and all three delivery modes passed locally and against the production bundle;
  Print ticket `MF-F817-3718-CC15` exists with no support or mail documents; Both
  ticket `MF-4A4F-5563-3AF7` is `expected_dropoff` and its HTML mail reached
  `delivery.state=SUCCESS` in one attempt; the exact Pathfinder QA rate bucket
  was deleted and confirmed absent.
- **Width and ticket refinement closed 2026-07-11:** the estimator now shows the
  uncropped overhead guide comparison, an explicit width rule, four library-icon
  choices, and the selected low/mid two-guide minimum. Current artifacts ask for
  no photos. New dated requests issue `MF-MMDD-XXXX`; live Print QA returned
  `MF-0711-RXY3`, queued no email, and returned the same ID on exact replay. The
  final screen, print DOM, copy output, and dropoff email carry the after-firing
  estimate reminder. The exact QA rate bucket was deleted and confirmed absent.
- **Parity evidence required:** frozen v1/v2 tuple tests, 24 v3 tuple tests,
  price matrix, source/generated clay-check scan, byte-identical public trees,
  local and production browser suites, Firestore ledger readback, print-PDF
  page count/render, and live mail proof.
- **Half-shelf humanization lock closed 2026-07-11:** the protected runtime is
  `website/firing-pathfinder/src/App.jsx` plus the versioned selection contract
  in `functions/src/firingPathfinderRequest.ts`. The old split rectangular
  illustration, collapsed `3+` lane, artist dryness judgment, and playful-only
  billing reminder are now blocked. Promotion fails unless the reference is
  non-interactive, five shelf-count radios are distinct, `triple` passes the
  server contract, Stage 04 and all dropoff artifacts share the billing policy,
  readiness uses safe travel plus studio hold, the focused before/after review
  pane exists, and desktop/mobile/browser/print proofs pass. The immediate hard
  artifact is the working Step 03 -> Step 04 -> one-page-ticket flow, not another
  planning note. The function deployed before the client; both public trees are
  byte-identical; local and production browser suites passed 12 of 12; the live
  reference contains zero controls and the estimator contains five radios; and
  the maximum-content Letter ticket rendered as one unclipped page. The focused
  four-image review pane is ready for approve, feedback, or deny decisions.
- **Current parity target:** frozen v1/v2 tests, 24 v3 tuples, 73 total server
  tuples, five frontend space rows, generated public-tree parity, one-page print
  PDF, and live production visual/DOM/console verification.
- **Step 03 pictorial revision lock superseded 2026-07-13:** the user selected all
  three generated directions. They ship together as
  `kiln-space-fit-test.webp`, `kiln-space-sizing-board.webp`, and
  `kiln-space-kiln-cutaway.webp`, optimized to 1200 x 675. The protected behavior
  is one non-selecting explanatory sequence followed by five plain radio cards;
  the old abstract shelf-count glyphs do not return. The 2026-07-13 comprehension
  slice allows each image to open an inspect-only detail dialog. Opening or
  closing an example must never select shelf count, advance the flow, or create a
  billable event. Promotion fails if any image does not decode, the strip contains
  a selection/form control, mobile cannot reach all three examples, the page
  horizontally overflows, or Steps 03-05 regain document scroll at the 1265 x
  720 laptop target.

## Step 03 inspectability and no-bill comprehension slice — 2026-07-13

### Prior-art receipt

| Surface checked | Candidate and maturity | Fit decision | Pitfall that changed the plan |
| --- | --- | --- | --- |
| Studio Brain memory and current repo | Approved three-image sequence, current React/CSS cards, existing Phosphor icon package; production-proven | Reuse the images, layout, radio model, and icon library | The old "no controls" guard confused a non-selecting explainer with an inspect-only control; it is narrowed above instead of adding a second estimator |
| Live production capture | `codex-work/pathfinder-step03-audit/01-before.png`; current deployed state | Use as the before-state | Tiny overlaid captions and a focusable-but-inert strip make the approved art impossible to inspect; price chips appear before any local no-bill reassurance |
| [MDN dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) and [`showModal()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal) | Official, broadly available native platform behavior | Adapt a native modal dialog; add no dependency or custom focus-trap framework | Use `showModal()`, an explicit close button, Escape, a labelled title, and no `tabindex` on the dialog; return focus to the opener after close |
| [WAI-ARIA APG modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Official accessibility pattern | Learn from its focus, labelling, and close-control rules | Keep every required control inside the dialog, give it a visible title, and do not let keyboard focus escape while it is open |

Queries checked on 2026-07-13: repo search for `dialog`, `showModal`,
`aria-modal`, `lightbox`, and `modal`; official web search for the HTML dialog
element and WAI modal-dialog keyboard/focus guidance. No existing local dialog
component was found. New code is justified only as a small native-dialog adapter
around the three already-approved image assets.

### Experience storyboard and interface contract

1. Step 03 opens with the three existing images, a visible invitation to open an
   example, and the plain statement `No bill is created here`. The
   estimate is only a heads-up for the studio team, who will check and adjust it.
2. Activating an example opens its full 1200 x 675 image with one plain-language
   rule and one closest-estimate cue. Estimator state does not change.
3. Close or Escape returns focus to the same example. The five radio choices are
   still the only controls that can change `spaceId`; double-click on a radio may
   still advance.
4. `I’m not sure` explicitly routes the fit decision to the studio without blame.
   Price chips say `Heads-up`, while the section states `No bill is created here`.
5. If an image fails, the title, explanation, and estimate cue remain readable in
   the dialog. On mobile the dialog stacks image above copy and stays dismissible.

Touched objects are exact: the three WebP assets (reuse), three example trigger
buttons (adapt from the current figures), one native `dialog` (create), the five
`spaceChoices` descriptions and price-hint labels (adapt), and the existing unit
and Playwright checks (propagate). There is no backend, ticket-schema, email,
Firestore, or billing mutation in this slice.

### Proof and rejection contract

- Pass: all three triggers open the matching full image and humanized explanation;
  close and Escape work; focus returns; radios remain five; opening a dialog leaves
  every radio unchecked and keeps Step 03 active.
- Pass: visible copy says `No bill is created here` and identifies the
  estimate as a studio heads-up that staff will check and adjust.
- Pass: 1265 x 720 has no document scroll with the dialog closed; 390 px has no
  horizontal page overflow; the open dialog fits both viewports.
- Reject: thumbnails still look inert, the dialog resembles another set of
  choices, the price chips read like an immediate charge, copy blames or tests the
  artist, an example changes estimate state, or focus is lost after close.
- Evidence: before/open/closed desktop captures, direct 1265 x 720 viewport
  bounds, 55 frontend tests, 18 focused function tests, local and production
  Chrome inspection, production DOM/console checks, generated-tree parity,
  remote hash parity, and the updated `design-qa.md`.

## Step 03 persistence and Step 05 single-action slice — 2026-07-13

### Root cause and prior-art decision

The Step 03 assets were not missing from the network or React state. Production
inspection found three decoded 1200 x 675 WebPs with HTTP 200 responses. The
69-pixel cards placed 76–91 pixels of caption/gradient over each image, so the
text layer visually buried the art. The fix reuses the approved assets and native
dialog, separates each thumbnail from its label, and keeps the full explanation
in the inspect view. No cache workaround or image-state framework is justified.

Step 05 reuses the existing Zod validation, honeypot, per-IP limiter,
idempotency key, Firestore transaction, and Firebase Trigger Email collection.
The official extension contract supports separate HTML/text mail documents for
trusted server-written recipients:
<https://firebase.google.com/docs/extensions/official/firestore-send-email>.
CAPTCHA is deferred until abuse evidence shows the current controls are
insufficient; adding friction to every artist is not the default security move.

### Workflow, objects, and state transitions

1. Step 03 renders three 74-pixel horizontal cards. Each has an uncovered image,
   a short label, and an `Open` cue. The longer sizing rule remains in the modal.
2. Back to Step 02 and forward to Step 03 remounts all three eager image assets.
   Each pass must finish with three decoded, non-zero natural-width images.
3. Step 05 shows one summary and one form. `idle -> submitting -> success/error`
   is the only submission state path; no delivery-mode UI state exists.
4. `Let's fire it` sends nickname/name, email, note, the v3 selection, one dated
   idempotency key, `deliveryMode: email` for backward schema compatibility, and
   `consentToContact: true` for the transactional message contract.
5. The server transaction writes the ticket, support request, studio mail, and
   artist mail. Exact replay returns the same ticket before creating new mail.
6. Success exposes optional print and copy utilities. Error preserves the
   prepared form. Neither path redirects to Kilnfire.

### Proof-of-work and acceptance contract

- At 1265 x 720, closed Step 03 and pre-submit Step 05 have no document scroll;
  all three examples and the primary submit action are visible without scrolling.
- Opening the width/height example shows the matching 1200 x 675 image and rule;
  it does not select a shelf count or create a billable event.
- Six Back/Next browser cycles and the component regression test keep the same
  three image sources mounted and decoded.
- Step 05 contains zero delivery radios and zero consent checkbox controls; name
  or nickname and email are required, note is optional, and one submit is guarded
  in flight.
- Function tests must prove separate recipients, escaped HTML, complete artist
  packet sections, one transaction, and no duplicate mail on exact replay.
- Reject promotion if an image is hidden behind copy, any example disappears on
  repeat navigation, the submit button falls below the laptop viewport, either
  audience mail is missing, print opens automatically, or CAPTCHA is added
  without a measured abuse case and an accessible fallback.

## Pickup reassurance and separate help path — 2026-07-13

### Prior art, assumptions, and reuse decision

The checked prior art is the current production Pathfinder, its model and
component tests, the canonical server artifact/email builder, the existing
`pickup-shelf.webp` scene, the finished-work ready-notice contract above, and
the separate support-page quick-answer pattern. The existing delivery bridge is
mature and reusable; the old support page's Kilnfire links, photo prompts, and
chat workflow are not copied. No package, workflow engine, status lookup,
private-address database, or new email service is justified.

Known: the pickup entry is reached after a ready notice, the public page has no
live batch lookup, and the current generic guidance component always renders a
currency card. Assumed: the ready notice remains the authority for private
address, access, and timing. Unknown: whether the artist still has that notice.
If the assumption is false, this slice must not invent a ready state or expose a
private address; it falls back to a staff-addressed pickup-details request.

Reuse decisions:

- Reuse the existing `collection` selection, one-submit email bridge,
  idempotency, rate limiting, ticket ledger, contact fields, and pickup image.
- Adapt `Guidance` into three explicit presentation modes: firing estimate,
  pickup reassurance, and help answer. The modes are named behavior, not a new
  component framework.
- Adapt the existing radio mechanics into help-topic cards with the same native
  controls, keyboard path, and optional double-click shortcut, but a visibly
  different card composition and no estimator cues.
- Adapt server summary/email rows so only dropoff artifacts expose price. Keep
  frozen v1/v2 request tuples accepted; current v3 behavior changes only in
  human-facing canonical content.

### Experience storyboard and object behavior

1. **Pickup Step 02 — arrival.** After `Pick up finished work`, the first object
   is a sage reassurance card: `Your work is waiting for you.` It explains that
   the ready note means firing, cooling, checking, and staging are complete. No
   dollar icon, `No new estimate`, live-status warning, or second status check
   appears.
2. **Pickup Step 02 — action boundary.** A second compact card says to use the
   address, access, and timing in the ready note. `I have the pickup details`
   exits to Firing Services without a write. `Email me the pickup details`
   advances to the contact step. Nothing is submitted automatically.
3. **Pickup Step 03 — optional resend.** The page asks for a name or nickname,
   email, and optional identifying note. Its summary says `Pickup details`, not
   price or studio review. Submit creates the existing canonical support/ticket
   record and sends artist/studio HTML email. Success says the pickup-details
   request was emailed; failure preserves the fields.
4. **Other questions Step 02 — topic menu.** Three bordered help cards use a
   plum/sage treatment, visible topic labels, and short outcome copy. They do
   not resemble dropoff's flat radio rows or kiln-space price cards. Single
   click, keyboard, Continue, and double-click remain available.
5. **Other questions Step 03 — answer.** The first object is a plain answer
   panel. A second `If you want us to look` panel names only the details that
   help and offers `Send this question`. There is no currency card, maximum
   estimate, price placeholder, risk verdict, or billing copy—even for unusual
   work.
6. **Other questions Step 04 — optional follow-up.** The contact step uses
   `Your question` and `Who should we reply to?`; its summary omits price and
   firing-estimate rows. The existing transaction and two-audience mail path
   remain the recovery and evidence boundary.

Touched objects are `questionChoices`, `getGuidance`, `getReceipt`, `Guidance`,
the question-phase form, the non-dropoff receipt summary/success copy,
`summaryRows` and current canonical non-dropoff artifacts in the Firebase
function, the shared CSS, and their unit/browser/backend tests. Dropoff pricing,
Step 03 kiln-space estimation, print layout, and legacy selection acceptance
must remain untouched.

### Adversarial review, proof case, and rejection contract

- The result fails if pickup still looks like a price estimate, asks whether the
  already-notified work is ready, guarantees damage-free work, or creates a
  request when the artist already has the details.
- The result fails if `Ask something else` still shows `Price`, `No estimate
  yet`, `Maximum estimate`, a currency icon, or a dropoff-style price summary on
  screen or in either email.
- The result fails if visual distinction removes native radio semantics,
  keyboard use, visible Continue, Back state, double-click, or error recovery.
- The smallest end-to-end proof is: pickup Step 02 can exit with zero network
  calls; its optional resend reaches a contact form and produces canonical
  non-price email content; each of the three help topics reaches a visibly
  distinct answer and non-price contact summary; a standard mid-fire dropoff
  still calculates and submits the same estimate.
- Evidence is frontend model/component tests, focused backend canonical/email
  tests, the production Playwright path, a 1265 x 720 Chrome capture of pickup
  Step 02 and the help-topic answer, clean console/network evidence, generated
  tree parity, remote hash parity, and one labelled live non-dropoff mail test if
  the function changes.
- Abort and roll back if the current selection schema must be broken, private
  access details would have to ship in the public bundle, the optional exit
  writes data, or the backend cannot distinguish dropoff price rows from
  non-dropoff help content.
