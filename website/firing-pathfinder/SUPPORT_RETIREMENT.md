# Support retirement slice

## Existing work checked

- The live Pathfinder quick-answer flow and pickup guidance.
- The standalone `/support-pickup/` page, including its Ember chat and three FAQ answers.
- Main-site navigation, footer, homepage cards, policies copy, blog templates, sitemap, crawler notes, and legacy redirects.

Pathfinder already owns readiness, unusual-work, firing-range, pickup, and studio-question workflows. Reusing it avoids a second support model and a second form.

## Content decision

| Existing support content | Decision | New home |
| --- | --- | --- |
| Can I change my pickup time? | Keep and humanize | Compact quick answer in Pathfinder; reinforce in pickup Step 02 |
| Is my fired work ready? | Keep the rule, remove the duplicate question | Pickup Step 02: the ready email is the go-ahead |
| Can I update a dropoff or deadline? | Keep and humanize | Compact quick answer in Pathfinder |
| Ember chat, local thread state, photo upload, appointment prompts | Retire | None |
| Support navigation and homepage support card | Retire | Pathfinder quick answers in the footer and firing flow |
| Homepage “How the handoff works” workflow | Retire | The firing planner already explains the process in context |
| Homepage studio-routing cards and routing note | Retire | One primary “Plan your firing” action in the hero |
| `/support-pickup/`, `/support/`, `/contact/`, `/faq/` | Redirect | `/firing-services/pathfinder/#faq` |

## Storyboard and behavior

1. A visitor choosing **Ask something else** sees the three existing decision cards plus two short, non-form FAQ answers for pickup timing and ticket changes.
2. Opening any decision-card answer and choosing its completion action returns to the clean FAQ chooser, clears the previous radio selection, disables Continue, and keeps the visitor in Pathfinder.
3. A legacy support URL lands directly at the FAQ chooser through the `#faq` deep link.
4. Main-site pages no longer advertise a separate Support or Ember destination.
5. The homepage has one primary path into the planner, one price snapshot, and no repeated handoff or routing sections.

## State and failure handling

- `#faq` initializes the existing reducer at `entryId: other`, `phase: question`; it does not invent a parallel support state.
- Completing an answer uses the reducer's existing Back transition and clears only the local selected topic.
- Old URLs remain safe through permanent redirects; no public link is allowed to point at the retired directory.
- The retained answers never promise availability: requested pickup changes and ticket updates require staff confirmation.

## Evidence plan

- Unit tests: deep link, retained Q&A copy, clean FAQ return, no navigation.
- Browser tests: desktop no-scroll, mobile no-overflow, keyboard/focus behavior, no Ember/Kilnfire/photo language in the FAQ.
- Static checks: no public support links, sitemap entry, crawler authority entry, or generated-template reference.
- Production: verify redirects, live FAQ deep link, visual layout, and completed-answer return behavior.
