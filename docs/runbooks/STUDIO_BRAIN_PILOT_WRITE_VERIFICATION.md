# Studio Brain Pilot Write Verification Runbook

Purpose: capture repeatable evidence for the v3 pilot write path (`firestore.ops_note.append`) across Studio Brain and Cloud Functions.

## Preconditions
- `studio-brain` running with:
  - `STUDIO_BRAIN_ENABLE_WRITE_EXECUTION=true`
  - `STUDIO_BRAIN_FUNCTIONS_BASE_URL` pointed at emulator or staging functions
  - `STUDIO_BRAIN_ADMIN_TOKEN` configured
- Functions deployed/emulated with:
  - `executeStudioBrainPilotAction`
  - `rollbackStudioBrainPilotAction`
- Staff Firebase ID token available for `Authorization: Bearer <idToken>`

## Verification Flow
1. Create proposal:
```bash
curl -sS -X POST "$STUDIO_BRAIN_BASE_URL/api/capabilities/proposals" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $STUDIO_BRAIN_ID_TOKEN" \
  -H "x-studio-brain-admin-token: $STUDIO_BRAIN_ADMIN_TOKEN" \
  -d '{
    "actorType":"staff",
    "actorId":"<STAFF_UID>",
    "ownerUid":"<OWNER_UID>",
    "tenantId":"monsoonfire-main",
    "capabilityId":"firestore.ops_note.append",
    "rationale":"Pilot verification run for ops note append.",
    "previewSummary":"Pilot note append verification",
    "requestInput":{
      "actionType":"ops_note_append",
      "ownerUid":"<OWNER_UID>",
      "resourceCollection":"batches",
      "resourceId":"<BATCH_ID>",
      "note":"Pilot verification note"
    },
    "expectedEffects":["Staff-visible pilot ops note is created."],
    "requestedBy":"<STAFF_UID>"
  }'
```
2. Approve proposal:
```bash
curl -sS -X POST "$STUDIO_BRAIN_BASE_URL/api/capabilities/proposals/<PROPOSAL_ID>/approve" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $STUDIO_BRAIN_ID_TOKEN" \
  -H "x-studio-brain-admin-token: $STUDIO_BRAIN_ADMIN_TOKEN" \
  -d '{"approvedBy":"<STAFF_UID>","rationale":"Approved for bounded pilot verification."}'
```
3. Dry-run:
```bash
curl -sS "$STUDIO_BRAIN_BASE_URL/api/capabilities/proposals/<PROPOSAL_ID>/dry-run" \
  -H "authorization: Bearer $STUDIO_BRAIN_ID_TOKEN" \
  -H "x-studio-brain-admin-token: $STUDIO_BRAIN_ADMIN_TOKEN"
```
4. Execute:
```bash
curl -sS -X POST "$STUDIO_BRAIN_BASE_URL/api/capabilities/proposals/<PROPOSAL_ID>/execute" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $STUDIO_BRAIN_ID_TOKEN" \
  -H "x-studio-brain-admin-token: $STUDIO_BRAIN_ADMIN_TOKEN" \
  -d '{
    "actorType":"staff",
    "actorId":"<STAFF_UID>",
    "ownerUid":"<OWNER_UID>",
    "tenantId":"monsoonfire-main",
    "idempotencyKey":"pilot-verify-<RUN_ID>",
    "output":{"executedFrom":"runbook"}
  }'
```
5. Rollback:
```bash
curl -sS -X POST "$STUDIO_BRAIN_BASE_URL/api/capabilities/proposals/<PROPOSAL_ID>/rollback" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $STUDIO_BRAIN_ID_TOKEN" \
  -H "x-studio-brain-admin-token: $STUDIO_BRAIN_ADMIN_TOKEN" \
  -d '{"idempotencyKey":"pilot-verify-<RUN_ID>","reason":"Rollback verification for pilot write runbook."}'
```

## Required Evidence Capture
- Proposal lifecycle payloads:
  - create response
  - approve response
  - dry-run response
  - execute response
  - rollback response
- Studio Brain audit evidence:
  - `GET /api/capabilities/audit?actionPrefix=capability.firestore.ops_note.append`
  - `GET /api/ops/audit?actionPrefix=studio_ops.pilot_write`
- Firestore evidence (emulator/staging):
  - `studioBrainPilotActions/<proposalId>__<key>` row
  - `studioBrainPilotOpsNotes/<noteId>` row with rollback metadata after rollback

## Exit Criteria
- Execute returns `ok: true` and includes a resource pointer.
- Repeat execute with same idempotency key does not create a second write.
- Rollback returns `ok: true` and sets rollback markers on both action + note documents.
- Audit rows include actor UID, proposal ID, idempotency key, and resource pointer.
