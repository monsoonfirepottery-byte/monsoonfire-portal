# Firing Pathfinder content voice

Date: 2026-07-13

## Proof use case

An artist should be able to answer what they are doing, choose the firing range
they already use, compare their load with a picture, understand the resulting
estimate, and finish a dropoff plan with one short reference. The page should feel like a
clear studio service, not an intake database. The system still creates a ticket,
but artists see a dropoff plan and a short reference only when they need it.
Pickup starts from the ready notice instead of asking the artist to plan again.
Other questions start with a useful answer instead of borrowing the estimator.

## Voice contract

- Speak to capable artists in a neutral studio voice: use `you` and `we` without
  coddling, diagnosing feelings, or narrating obvious interface behavior.
- Lead with the artist's next action, not an internal route name.
- Ask only what changes the answer. Clay-body classification is not an intake
  step; the studio verifies material at handoff.
- Use Low, Mid, and High/custom as primary labels. Cone numbers belong only in
  accessible hover/focus help.
- Prefer `firing range`, `kiln space`, `estimated price`, `dropoff plan`, and
  `reference` over system or workflow vocabulary. Standard dropoff guidance does
  not use a `what to have handy` block.
- Reassure without becoming cute. `I'm not sure` is a valid answer and never
  becomes an invented price.
- State a firing range once per pane. Every neighboring line must add price,
  fit, safety, or action information.
- Keep `permanent ticket ID` as backend language. In artist-facing UI, show
  `Reference MF-MMDD-XXXX` only after the plan is saved. Never announce that no
  ticket exists yet or ask the artist to understand issuance mechanics.
- Keep these boundaries visible: staff confirms fit and loading before firing;
  the final charge is totaled after firing; artists judge whether work can
  travel safely and the studio decides when it is ready to fire; print opens a
  dialog; emailed dropoffs are expected but not yet accepted for firing.
- Standard dropoff and pickup can be self-serve. Say plainly that no conversation
  is required; directions/access still follow confirmation because this is a
  private home studio.
- Treat pickup as the last step, not a new estimate: reassure first, let the
  artist leave with `I have what I need`, and reveal the resend form only when
  they ask for it.
- Treat `Ask something else` as quick help, not another firing submenu. Use
  topic cards, answer the common question immediately, and offer a studio note
  only as the follow-up. Do not show price or estimate rows on that path.
- Do not ask for photos in the estimate or ticket. Use firing range, tallest and
  widest measurements, surface/shape notes, and the artist's shelf-guide choice.
- Use the same compact billing policy in Stage 04 and every dropoff plan:
  `This is an estimate. You pay after the firing for the space your work used.
  If something goes wrong because of us, there’s no firing charge. If the issue
  comes from the clay, glaze, or construction, the firing is still charged.`

## State storyboard

1. **Start:** only Drop off work, Pick up finished work, and Ask something else.
2. **Range:** Low, Mid, High/custom, or I'm not sure. The hint says to use the
   range listed for the clay body; there is no follow-up clay classifier.
3. **Space:** one continuous pictorial teaching scene must show the D-shaped
   half-shelf footprint and the 10-inch height consequence without a split,
   divider, or selectable-looking comparison. Five explicit radio rows remain
   1, 2, 3, 4+, or unsure.
4. **Guidance:** the price appears only after range and space earn it. Standard
   low/mid guidance contains only the estimate, safe-travel/clean-bottom rule,
   compact billing rule, self-serve note, and next action. Detail lists remain
   for custom or uncertain work only.
5. **Dropoff plan:** Print a dropoff page, Email the studio, or Email + print.
   The page explains that directions/dropoff instructions come next and that a
   ready email will tell the artist when to pick up.
6. **Success:** the backend issues one permanent ID, while the UI says `You’re
   all set`, shows `Reference MF-MMDD-XXXX` once, and keeps directions, dropoff,
   and pickup as the prominent next steps.
7. **Readiness:** `Can it travel safely?` is the practical check. If it can be
   packed and make the trip without flexing, denting, or breaking, bring it in;
   the studio can hold it until it is actually ready to fire.
8. **Pickup:** the ready note is the go-ahead. Say that the work is fired,
   cooled, and set aside; point back to the private access details in that note;
   make resend optional and keep all price/estimate rows out of the screen and
   email.
9. **Quick help:** show three visually distinct topic cards: safe travel,
   unusual work, and firing range. The next pane gives the answer first, keeps
   `Ask the studio` secondary, and contains no estimator module.
10. **Recovery:** errors preserve answers. Back, Change something, Start over,
   Copy plan, and explicit print retry remain plain and honest.

## Capacity language

- `1 half shelf`: from above, every piece and the grouped load stay inside one
  semicircle; every piece is 10 inches tall or less.
- `2 half shelves`: the piece or grouped load crosses one semicircle from above,
  needs two footprints, or anything is over 10 inches. Show $40 low or $70 mid.
- `3 half shelves`: an exact third capacity step. Low shows $60; mid shows $105.
- `4 or more half shelves`: show the per-client base cap of $80 low or $120 mid.
- A private firing request adds $20; a same-night rush adds $20 only if fulfilled.
  Custom firing is quoted separately. These are the pending release rates.
- `I'm not sure`: ask for tallest and widest measurements; show no price.
- Stackable bisque may share vertical space when staff can do it safely. Glazed
  work stays separate.
- Advancer shelves offer some protection from small glaze runs and sticking.
  They do not permit overhang; bottoms remain clean and staff decides placement.

## Rejection criteria

- The first pane asks about ware or clay instead of the task.
- A clay-body check, inferred material, or low/mid compatibility correction
  appears in the v3 intake.
- A price appears before the artist chooses a space picture.
- Tall work is priced as one half shelf or uncertainty is given a guessed price.
- Cone is a primary label.
- Mid fire is repeated in a heading, verdict, sentence, and ticket row.
- `checklist` appears where the durable artifact is a ticket.
- Standard low/mid guidance shows a `what to have handy` or `details to have
  handy` list instead of the self-serve handoff.
- Artist-facing UI says `permanent ID`, `ticket issued`, or `no permanent ticket`
  before or after saving the dropoff plan.
- Print claims success, Email opens print, or Both implies paper printed.
- The ID looks temporary or is omitted from paper/email.
- A new ticket ID looks like a receipt serial instead of `MF-MMDD-XXXX`.
- The sizing reference looks clickable, uses rectangles as the shelf unit,
  collapses 3 and 4+, hides the selected-range hints, or labels a per-client cap
  as a minimum.
- Any current estimate or issued ticket asks for a photo.
- Print-only copy explains that no email was sent instead of simply telling the
  artist to leave the printout with the work.
- Stage 04 or a dropoff artifact omits who pays after a successful,
  studio-caused-loss, or artist-side-loss firing outcome.
- Step 04 or the pre-submit Step 05 dropoff view creates a vertical page scrollbar
  at the 1265 x 720 desktop proof viewport.
- Pickup implies live status; readiness asks the artist to diagnose dryness or
  omits the studio hold-until-ready promise.
- Pickup shows a price, asks the artist to reconfirm readiness, or makes resend
  the only way out.
- `Ask something else` reuses the standard choice rows, journey timeline, or
  estimate card instead of the quick-help cards and three-step answer path.
- Copy wraps poorly at 390px or the one-page print clips.

## Evidence

- 56 component/model/submission tests.
- 11 focused Playwright tests with mobile, reduced-motion, accessibility, and
  no-horizontal-overflow checks.
- 19 focused server tests covering 73 v1/v2/v3 tuples, audience-specific mail,
  pickup reminders, support questions, idempotency, and transaction fixtures.
- One-page worst-case Letter PDF with visual inspection.
- Production visual, Firestore, and live-mail proof before closing the slice.
