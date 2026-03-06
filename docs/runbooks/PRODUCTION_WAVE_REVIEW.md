# Production Wave Review Workflow

Current production reference wave:
- [production-wave-2026-03-06f](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f)

Primary artifacts:
- [wave-summary.json](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/wave-summary.json)
- [ingest-catalog.json](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/ingest-catalog.json)
- [cross-source-review.json](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/cross-source-review.json)
- [cross-source-review.md](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/cross-source-review.md)
- [production-review.json](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/production-review.json)
- [production-review.md](/home/wuff/monsoonfire-portal/output/memory/production-wave-2026-03-06f/production-review.md)

Why this matters:
- The wave is complete across all current vectors.
- PST remains the quality baseline.
- Mail is fully completed at `87/87`.
- Twitter is operationally healthy.
- Docs now run from a larger curated manifest.
- Cross-source review is now the default operator entrypoint.

Generate or refresh the review pack:
```bash
npm run open-memory:production:review -- \
  --wave-root ./output/memory/production-wave-2026-03-06f
```

Generate or refresh cross-source synthesis:
```bash
npm run open-memory:cross-source:review -- \
  --wave-root ./output/memory/production-wave-2026-03-06f
```

Quick summary query:
```bash
npm run open-memory:production:query -- \
  --wave-root ./output/memory/production-wave-2026-03-06f \
  --mode summary
```

Cross-source query:
```bash
npm run open-memory:production:query -- \
  --wave-root ./output/memory/production-wave-2026-03-06f \
  --mode cross-source
```

List runs:
```bash
npm run open-memory:production:query -- \
  --wave-root ./output/memory/production-wave-2026-03-06f \
  --mode runs \
  --limit 20
```

Show one source family:
```bash
npm run open-memory:production:query -- \
  --wave-root ./output/memory/production-wave-2026-03-06f \
  --mode source \
  --source mail \
  --limit 12
```

Interpretation rules:
- Treat cross-source review as the default operator entrypoint.
- Use the production review pack when you want source-by-source strengths, weak spots, and density slices.
- Use the catalog when you need exact run paths.
- Use PST artifacts when you need the strongest quality baseline.
- Treat cross-source review as synthesis only, not a merged corpus store.
