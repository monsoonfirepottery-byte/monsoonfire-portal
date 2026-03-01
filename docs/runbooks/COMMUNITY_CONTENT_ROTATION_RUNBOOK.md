# Community Content Rotation Runbook

## Purpose
Provide a safe, repeatable process for rotating Community page content without introducing layout regressions or confusing member copy.

## Scope
This runbook covers copy/content updates that affect Community page cards, quote module, video rows, and report-sidebar chiplets.

## Ownership
- Primary: Member Experience + Operations
- Verification: QA Automation owner on call
- Escalation: Portal Frontend owner if canary fails

## Copy Limits (Hard)
Use these limits before publishing. If a field exceeds the limit, shorten copy before merge.

| Surface | Field | Hard limit |
| --- | --- | --- |
| `COMMUNITY_VALUES` | `title` | 28 chars |
| `COMMUNITY_VALUES` | `detail` | 110 chars |
| `WORKFLOW_PROOFS` | `title` | 38 chars |
| `WORKFLOW_PROOFS` | `valueStatement` | 120 chars |
| `WORKFLOW_PROOFS` | `testimonial` | 140 chars |
| `WORKFLOW_PROOFS` | `example` | 160 chars |
| `WORKFLOW_PROOFS` | `impact` | 64 chars |
| `COMMUNITY_EVENTS` | `title` | 24 chars |
| `COMMUNITY_EVENTS` | `detail` | 100 chars |
| `COMMUNITY_EVENTS` | `outcome` | 100 chars |
| `MEMBER_QUOTES` | `quote` | 110 chars |
| `MEMBER_QUOTES` | `author` | 30 chars |
| `SUGGESTED_VIDEOS` | `title` | 64 chars |
| `SUGGESTED_VIDEOS` | `reason` | 110 chars |

## Safe Formatting Rules
- Use plain text only in content fields. Do not include markdown or HTML tags.
- Avoid manual line breaks (`\n`) in titles, details, outcomes, quotes, and video reasons.
- Avoid unbroken tokens longer than 32 characters (common overflow source).
- Keep punctuation simple; avoid repeated symbols (`!!!`, `???`, `~~~~`).
- Put external URLs only in `SUGGESTED_VIDEOS[].url`.
- Keep event/video titles in title case and under 6 words when possible.

## Rotation Procedure
1. Create a branch and ticket reference for the content rotation.
2. Snapshot current content in the ticket before editing (copy current arrays or payload values).
3. Apply content edits in Community content source.
4. Validate copy against hard limits in this runbook.
5. Run required canaries (below).
6. Attach screenshot/report artifacts to the ticket.
7. Merge only after all required checks pass.

## Required Canary Verification
Run both commands after content changes:

```bash
npm run portal:canary:community-layout
npm run portal:canary:auth -- --functional-only
```

Pass criteria:
- `portal:canary:community-layout` reports no sidebar-width drift and no overflow issues.
- `portal:canary:auth -- --functional-only` stays green on Community/Workshops/Lending journeys.
- Artifacts are present in:
  - `output/qa/portal-community-layout-canary/`
  - `output/qa/portal-authenticated-canary/`

## Rollback
1. Revert the content change commit immediately (`git revert <sha>`).
2. Re-run:

```bash
npm run portal:canary:community-layout
npm run portal:canary:auth -- --functional-only
```

3. Confirm rollback artifacts are green.
4. Update the ticket with:
   - failing canary signature
   - reverted commit SHA
   - follow-up fix owner

## Release Evidence Checklist
- [ ] Copy limits validated
- [ ] Community layout canary passed
- [ ] Authenticated functional canary passed
- [ ] Artifacts linked in ticket
- [ ] Rollback plan recorded (or rollback executed)
