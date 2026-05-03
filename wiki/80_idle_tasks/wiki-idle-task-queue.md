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
export_hash: 53274a1eaf2c16f0adcfd06ca29e19bb601f810b75bcb24b8c8d702968c558e5
---

# Wiki Idle Task Queue

| Task | Status | Priority | Read Only | Output | Signals |
|---|---|---:|---:|---|---|
| Review wiki contradiction: membership-required-vs-decommission | blocked | 0.9 | true | `wiki/50_contradictions/membership-required-vs-decommission.md` | severity=hard, status=blocked |
| Refresh Studio Brain wiki context pack | ready | 0.65 | true | `output/wiki/context-check.json` | verified=2, warnings=13, total_warning_items=273, unverified=272, active_contradictions=1 |
| Refresh wiki source index and chunk inventory | ready | 0.55 | true | `output/wiki/source-index-check.json` | sources=1646, chunks=11182 |
