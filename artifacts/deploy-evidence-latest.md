# Deploy Evidence Pack

- Generated: 2026-03-12T03:00:20.644Z
- Target: namecheap-portal
- Status: failed
- Base URL: https://portal.monsoonfire.com
- Commit: 943d865e36453ce33a79ad5ffdb492a7cc20bd75
- Branch: codex/lending-v1-shippable

## Artifact Status

| Artifact | Required | Status | Path |
| --- | --- | --- | --- |
| Deploy preflight | no | pass | output/qa/deploy-preflight.json |
| Cutover verify | yes | pass | output/qa/post-deploy-cutover-verify.json |
| Post-deploy promotion gate | yes | pass | output/qa/post-deploy-promotion-gate.json |
| Post-deploy authenticated canary | no | pass | output/qa/post-deploy-authenticated-canary.json |
| Post-deploy virtual staff regression | no | pass | output/qa/post-deploy-virtual-staff-regression.json |
| Post-deploy Firestore index guard | no | pass | output/qa/post-deploy-index-guard.json |
| Auto rollback report | no | unk | output/qa/post-deploy-rollback.json |
| Post-rollback verify | no | fail | output/qa/post-deploy-rollback-verify.json |

## Attention

- Failed: Post-rollback verify

## Notes

- This report is generated from local deploy artifacts and should be attached to release evidence.
- Use alongside CI artifacts for full production promotion traceability.

