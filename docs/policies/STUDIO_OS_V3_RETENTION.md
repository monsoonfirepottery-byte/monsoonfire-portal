# Studio OS v3 Retention + Portability Policy (Technical)

## Retention Matrix
| Artifact | Store | Default Window | Purge Path |
| --- | --- | --- | --- |
| Studio snapshots | Local Postgres (`studio_state_snapshots`) | 180 days | retention prune job |
| Studio diffs | Local Postgres (`studio_state_diffs`) | 180 days | retention prune job |
| Audit events | Local Postgres (`audit_events`) | 180 days | retention prune job |
| Capability proposals | Local Postgres (`capability_proposals`) | 180 days | retention prune job |

Cloud-authoritative business records (Firestore/Stripe) are not deleted by this retention flow.

## Portability + Export
- Staff-only endpoint: `GET /api/capabilities/audit/export?limit=<n>`
- CLI path: `npm --prefix studio-brain run export:audit -- --limit=1000 --out=reports`
- Export bundle contains:
  - event rows
  - manifest (`payloadHash`, per-row hashes, optional HMAC signature)

Optional signature key:
- `STUDIO_BRAIN_EXPORT_SIGNING_KEY` enables HMAC SHA-256 manifest signing.

## Audit Events
- `studio_ops.audit_export_generated`
- `studio_ops.retention_prune_executed`

## Safety Constraints
- Export and purge operations are staff-restricted and audited.
- Export payload excludes runtime secrets and auth tokens.
- Retention exceptions should be logged with a reason code in event metadata.
