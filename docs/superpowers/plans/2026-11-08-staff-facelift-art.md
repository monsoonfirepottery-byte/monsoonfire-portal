# Staff facelift: artwork handoff

The six backgrounds were created with the built-in image generator, then exported as 1440 × 480 WebP files (at most 60,000 bytes each). Copy `web/public/staff-facelift/` intact into the implementation branch. Each URL is `/staff-facelift/<filename>`.

| File | Subject | Foreground motion to implement |
| --- | --- | --- |
| `contacts.webp` | Address book, envelope and stoneware pen rest | Briefly reveal the selected contact; keep Email in the first action position. |
| `policies.webp` | Brass key and unmarked clay seal | Reveal Request → Identity → Rule → Outcome once. Label it as a guide. |
| `system-health.webp` | Meter, connector and copper circuit | Highlight real check results as they arrive. |
| `automations.webp` | Two bowls on workshop rollers | Reveal the reported run states; never animate implied progress. |
| `usage.webp` | Studio ledger and tally counters | Animate bars once from zero width to their actual values; labels stay visible. |
| `studio-brain.webp` | Workshop dispatch board and ceramic pins | Briefly highlight a real pending review or handoff. |

Keep artwork decorative. At wide content widths use right-center positioning with a charcoal scrim behind the left-aligned copy. At narrow widths put the illustration in a short separate ribbon or suppress the decorative layer if it would collide with copy. Use the content container, rather than the viewport, for this decision. Give the container a solid fallback, keep text and controls in the document, and disable nonessential motion with `prefers-reduced-motion`. Do not animate the whole background or put text or live states in a bitmap.

## Prompt set

Common prompt: “Generate a single landscape banner background for a working ceramics studio staff application. Premium quiet editorial illustration, tactile matte gouache with subtle stoneware grain, charcoal ink ground, clay and warm amber, restrained teal accents, soft directional lamplight. Place the entire recognizable still life in the rightmost 42 percent and within the central vertical half, with generous right edge margin; leave the left 55 percent nearly uniform dark charcoal for overlay of real live text. Wide landscape, designed to crop to a shallow 3:1 ribbon. No lettering, numbers, symbols that look like writing, watermarks, badges, UI controls, borders, or people.”

The six subject prompts appended to it:

- Contacts: an open blank address book, one folded envelope and a handmade teal stoneware pen rest.
- Policies: an antique brass key beside an unmarked clay seal and a small stack of blank paper.
- System health: a kiln technician's simple analog meter with no numerals, an insulated connector and copper wiring arranged as a restrained circuit.
- Automations: a short ceramic workshop roller track carrying two small unglazed bowls through successive stations.
- Usage: a blank studio ledger with wooden tally counters grouped beside it and a ceramic pencil rest.
- Studio Brain: a wooden workshop dispatch board with blank clipped slips and three small colored ceramic pins.
