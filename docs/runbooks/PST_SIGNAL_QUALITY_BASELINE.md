# PST Signal Quality Baseline

Current active baseline:
- Run id: `pst-signal-quality-run-2026-03-06-finalcandidate`
- Baseline config: [config/pst-signal-quality-baseline.json](../../config/pst-signal-quality-baseline.json)

Why this run matters:
- It is the first PST signal-quality run that passed the full production gate.
- It preserves the current balance of:
  - analyzer memory under threshold
  - identity and relationship recovery
  - document-truthfulness guardrails
  - drift hygiene checks

Main artifacts:
- Production gate: `output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/signal-quality/production-readiness.json`
- Signal report: `output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/signal-quality/report.json`
- Review pack: `output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/signal-quality/review-pack.md`
- Pipeline log: `output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/pipeline.log`

Run the pipeline:
```bash
npm run open-memory:pst:signal-quality:run -- \
  --input ./imports/pst/runs/pst-run-2026-03-03-conflicted-210gb/mailbox-units.jsonl \
  --output-root ./output/memory/pst-signal-quality-run-<new-run-id> \
  --baseline-report ./output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/signal-quality/report.json \
  --clean-output-root true
```

Compare a future run to the baseline:
```bash
node ./scripts/pst-signal-quality-diff.mjs \
  --target ./output/memory/pst-signal-quality-run-<new-run-id>/signal-quality/report.json
```

Prune older evidence after a successful new run:
```bash
npm run open-memory:pst:evidence:prune -- \
  --mode manifest-only \
  --root ./output/memory \
  --keep-full pst-signal-quality-run-<new-run-id> \
  --dry-run

npm run open-memory:pst:evidence:prune:apply -- \
  --mode manifest-only \
  --root ./output/memory \
  --keep-full pst-signal-quality-run-<new-run-id>
```

Interpretation rules:
- Treat the baseline as the current operational reference, not as an untouchable truth.
- A future run should beat or match it on:
  - `production-readiness.json`
  - analyzer RSS
  - relationship and identity promoted counts
  - drift hygiene metrics
- The biggest known remaining quality gap is semantic cross-context document recovery. Single-thread document recurrences are still episodic by design.
