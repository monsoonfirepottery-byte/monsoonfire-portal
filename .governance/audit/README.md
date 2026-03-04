# Audit Chain Storage

This directory is reserved for append-only governance audit events.

- Suggested local chain file: `audit-events.jsonl`
- Each row should include:
  - `previous_hash`
  - `tamper_hash`
  - immutable event payload

Hash chaining recommendation:

`tamper_hash = sha256(previous_hash + canonical_json_payload)`

In CI, publish audit chain fragments as workflow artifacts and mirror into memory with provenance pointers.

