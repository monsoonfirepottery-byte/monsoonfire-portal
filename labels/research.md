# Modular Crate Label System Research

Research date: `2026-04-12`

## Search terms used

- `clip-on bin label holder STL`
- `crate label holder 3d print`
- `gridfinity label system`
- `modular label clip stl`

## Sources consulted

- [Aigner Wire Rack Label Holders white paper](https://www.aignerlabelholder.com/media/white-papers/ALH_WireRac_WhitePaper.pdf)
  - Useful for industrial holder taxonomy: snap-on clips, insert channels, angled faces, barcode-ready windows, and color strip conventions.
- [GFLabel](https://github.com/ndevenish/gflabel)
  - Useful for parametric labeling patterns: embossed, debossed, or embedded label treatments plus icon-friendly, width-aware layouts.
- [Fabric Bin Label Holder on MakerWorld](https://makerworld.com/en/models/640201-fabric-bin-label-holder)
  - Useful for clip-on storage behavior and the idea of a lightweight holder that accepts changeable labeling instead of permanent emboss only.
- [Gridfinity standard bins with label + parametric file](https://3dgo.app/models/makerworld/1023119)
  - Useful for the “built-in recessed label face” pattern and the no-support, print-friendly bias common in practical storage systems.

## Patterns extracted

### Attachment methods that kept repeating

- Spring or saddle clips for thin bin lips are the most common reusable attachment.
- Slide-in frame systems show up whenever label content changes often.
- Over-lip hanging tags avoid clip fatigue and are the quickest swap path.

### Label strategies that looked worth reusing

- Permanent raised text is best for station names or durable status labels.
- Replaceable inserts make sense when the holder stays on the bin longer than the wording.
- Recessed sticker zones protect QR or printed inserts from abrasion.

### Durability takeaways

- Clip roots and lips are the failure point on small FDM holders; PETG is safer than PLA for repeated flex.
- Recessed QR pockets are worth the extra geometry because proud sticker corners get chewed up fast.
- Faces wider than roughly `75-100 mm` read well from distance without becoming awkward to clip or hang.

### Dimension baseline used for the retry

- Overall face width: `84-102 mm`
- Overall face height: `60-70 mm`
- Functional face thickness: `4-5.6 mm`
- QR zone target: `30-34 mm`
- Crate wall assumption: `3-5 mm`, tuned to about `4.2-4.6 mm`

## How the research shaped the four variants

- Variant A leans on the common spring-clip plate pattern, but adds a QR recess and larger word-first hierarchy.
- Variant B borrows from storage-frame insert systems by separating a neutral frame from a status-colored cartridge.
- Variant C comes from the “hang first, flex never” pattern used in quick-swap tags and shelf markers.
- Variant D pushes toward industrial rack-holder behavior with a heavier face, deeper QR protection, and more obvious clip mass.

## Non-copying rule

The retry intentionally reused attachment and readability patterns, not exact source geometry. Dimensions, face proportions, badge placement, and QR treatment were all re-authored for the pottery-studio crate workflow instead of cloned from a marketplace model.

## Tooling research after the failed Blender mesh export

The earlier STL attempt failed because it treated Blender objects like scene assets instead of guaranteed solids. The better-constrained path is a CAD kernel first, tessellation second.

### Sources consulted for the tooling pivot

- [CadQuery import/export docs](https://cadquery.readthedocs.io/en/latest/importexport.html)
  - Useful for direct STL and STEP export from a modeled solid.
- [build123d import/export docs](https://build123d.readthedocs.io/en/latest/import_export.html)
  - Useful for explicit STL export from Open Cascade based parts.
- [build123d builder concepts](https://build123d.readthedocs.io/en/latest/key_concepts_builder.html)
  - Useful for the additive/subtractive `BuildPart` workflow that mirrors real solid modeling.
- [CADReasoner](https://arxiv.org/abs/2603.29847)
  - Useful because it explicitly emits runnable CadQuery programs, which is a strong signal that current CAD-focused agents are converging on CadQuery as a practical shape-construction medium.
- [CAD-Coder](https://arxiv.org/abs/2505.14646)
  - Useful as another recent example of code-first CAD generation.

### Decision from that research

- Use `CadQuery` as the primary construction language for printable geometry.
- Keep `build123d` installed as a secondary option for more explicit builder-mode solids.
- Use `trimesh` and `manifold3d` to validate exported meshes before trusting them.
- Limit Blender to rendering, import checks, or presentation after the CAD solids are already valid.
