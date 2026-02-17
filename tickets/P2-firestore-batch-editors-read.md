Status: Completed

# P2 - Firestore rules: editors read access to batch doc

- Repo: firestore.rules
- Area: Security / Collaboration semantics
- Evidence:
  - `canReadBatch(batchId)` allows editors via `batches/{batchId}.editors`
  - but `match /batches/{batchId}` read is only staff or owner
- Recommendation:
  - Decide intent:
    - If editors are real collaborators, allow editors to read `batches/{batchId}` doc too.
    - If editors are only used for staff workflows, document and keep current restriction.
- Decision recorded:
  - Keep current restriction (batch doc read = staff or owner).
  - Rationale: `editors` is currently populated with the owner/staff (no additional collaborators) and the web UI does not use an editors-based collaboration model yet.
  - Follow-up: if/when we add true collaboration, revisit batch doc reads and add explicit tests for editor access.
- Effort: S
- Risk: Med
- What to test: editor user can or cannot see batch metadata as intended; no privilege escalation to write.
