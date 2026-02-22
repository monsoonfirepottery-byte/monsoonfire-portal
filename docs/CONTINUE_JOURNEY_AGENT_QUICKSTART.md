# Continue Journey — Agent Quickstart

Status: Public reference
Date: 2026-02-22
Owner: Platform + Portal

## Purpose

Give agents and orchestration flows a concise, authoritative path for continuing a batch journey without guessing payload shape.

## Canonical Contract

Authoritative source: `docs/API_CONTRACTS.md`

`continueJourney` requires this JSON body:

```json
{
  "uid": "<firebase uid>",
  "fromBatchId": "<existing batch id>"
}
```

## Required HTTP Details

- Method: `POST`
- Endpoint: `${BASE_URL}/continueJourney`
- Header: `Authorization: Bearer <idToken>`
- Content-Type: `application/json`

`BASE_URL` examples:
- Production: `https://us-central1-monsoonfire-portal.cloudfunctions.net`
- Emulator: `http://127.0.0.1:5001/monsoonfire-portal/us-central1`

## Expected Response Shape

Success envelope (optional fields are expected):

```json
{
  "ok": true,
  "batchId": "optional",
  "newBatchId": "optional",
  "existingBatchId": "optional",
  "rootId": "optional",
  "fromBatchId": "optional",
  "message": "optional"
}
```

## Workflow Notes

1. Read active batch state first.
2. Submit `continueJourney` with `{ uid, fromBatchId }`.
3. Prefer `newBatchId` or `batchId` from response when present.
4. Refresh active/history/timeline views using returned IDs.

## Safety Notes

- Never send `x-admin-token` from public/production agent flows.
- Never include secrets or real bearer tokens in logs, prompts, or tickets.
- Do not write Firestore `undefined`; omit optional fields or use `null`.
