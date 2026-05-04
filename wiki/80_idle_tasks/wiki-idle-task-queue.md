---
schema: wiki-page.v1
id: wiki:idle-task:queue
title: Wiki Idle Task Queue
kind: idle_task
status: SYNTHESIZED
confidence: 1
owner: platform
source_refs: []
last_verified: null
valid_until: null
last_changed_by: script:wiki-postgres
agent_allowed_use: planning_context
supersedes: []
superseded_by: []
related_pages: []
export_hash: 9ad56d6ae2ae27280a4b2744fbac7e6d2c56fef6c7fd69dab1aa9a2527eaaf32
---

# Wiki Idle Task Queue

| Task | Status | Priority | Read Only | Output | Signals |
|---|---|---:|---:|---|---|
| Triage wiki claims requiring human approval | ready | 0.7 | true | `output/wiki/extract-check.json` | claims=21 |
| Refresh Studio Brain wiki context pack | ready | 0.65 | true | `output/wiki/context-check.json` | verified=1, warnings=11, total_warning_items=265, unverified=265, active_contradictions=0 |
| Review wiki claim extraction coverage | ready | 0.6 | true | `output/wiki/extract-check.json` | claims=266, human_approval=21, operational_truth=1 |
| Refresh wiki source index and chunk inventory | ready | 0.55 | true | `output/wiki/source-index-check.json` | sources=1618, chunks=11076 |
| Review wiki contradiction scan | ready | 0.52 | true | `output/wiki/contradictions-scan.json` | contradictions=0, hard=0, critical=0, blocked=0 |
| Verify deterministic wiki exports | ready | 0.5 | true | `output/wiki/export-drift.json` | drift=0, missing=0, match=3 |
| Audit wiki startup-pack eligibility | ready | 0.48 | true | `output/wiki/startup-pack-audit.json` | eligible=true, risk=contained, verified=1, warnings=265, human_approval=21 |
| Review wiki DB query probe plan | ready | 0.42 | true | `output/wiki/db-probe.json` | queries=5 |
