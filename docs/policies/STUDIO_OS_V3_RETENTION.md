# Studio OS v3 Retention + Portability Policy (Technical)

## Retention Matrix
| Artifact | Store | Default Window | Purge Path |
| --- | --- | --- | --- |
| Studio snapshots | Local Postgres (`studio_state_snapshots`) | 180 days | retention prune job |
| Studio diffs | Local Postgres (`studio_state_diffs`) | 180 days | retention prune job |
| Audit events | Local Postgres (`audit_events`) | 180 days | retention prune job |
| Capability proposals | Local Postgres (`capability_proposals`) | 180 days | retention prune job |
| Operational posture metadata (`heartbeat`, `status`, `backup freshness`, `restore drill`) | Repo `output/` artifacts | 180 days | artifact contract + cleanup policy |
| Sensitive operational evidence (`incident bundles`, `auth probe output`, `audit export files`) | Repo `output/` artifacts | 30 days | artifact contract + cleanup policy unless active incident/legal hold |

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
- Shared posture artifacts must carry provenance metadata: `mode`, `envSource`, `generatedAt`, `host`, `generator`, `dataClassification`, and `redactionState`.
- Shared incident artifacts must not include raw bearer tokens, admin tokens, unredacted env dumps, raw request bodies, or raw `git diffPreview`.
- Actor/report/intake identifiers should be hashed in shared artifacts; full identifiers stay in restricted audit storage only.
